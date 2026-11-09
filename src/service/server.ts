import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { chmodSync, existsSync, lstatSync, unlinkSync } from 'node:fs';
import { timingSafeEqual, randomUUID } from 'node:crypto';
import { KTeamError, record } from '../errors.js';
import { parseJson } from '../protocol/json.js';
import { AIMP_SPEC, AIMP_WIRE,validateL0,intentHash } from '../protocol/aimp.js';
import { Upstreams, type UpstreamOptions } from '../adapters/upstream.js';
import { CLIENTS, clientToken, ensurePrivateRoot, socketPath, type ClientId } from './config.js';
import { acquireOwner } from './owner.js';
import { CollaborationService,LOCAL_HUMAN } from './collaboration.js';
import { TeamStore } from './team-store.js';
import { TeamAutomation } from './automation.js';
import { TeamCoordinator } from './coordination.js';
import { modelCatalog, modelIdentity } from '../runtime/native.js';
import { createHash } from 'node:crypto';

export const API_VERSION = 1;
export const SCHEMA_VERSION = 1;
function equal(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
async function body(req: IncomingMessage): Promise<unknown> {
  let size = 0; const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 256 * 1024) throw new KTeamError('message_too_large', 413);
    chunks.push(chunk);
  }
  try { return parseJson(new TextDecoder('utf8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch (error) { if (error instanceof KTeamError) throw error; throw new KTeamError('invalid_utf8'); }
}
function send(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(value));
}
function page(value: string | null, fallback: number, max: number): number {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > max) throw new KTeamError('invalid_pagination');
  return Number(value);
}
export async function startHost(options: { root: string; upstream: UpstreamOptions }) {
  ensurePrivateRoot(options.root);
  const path = socketPath(options.root);
  const tokens = CLIENTS.map(id => ({ id, token: clientToken(options.root, id) }));
  if (tokens.some(v => v.token.length < 32) || new Set(tokens.map(v => v.token)).size !== tokens.length) throw new KTeamError('client_credentials_invalid');
  const upstream = new Upstreams(options.upstream);
  const owner = acquireOwner(options.root);
  const collaboration = new CollaborationService(upstream);
  const teamStore = new TeamStore(options.root);
  const coordinator=new TeamCoordinator(upstream,teamStore,owner.epoch);
  const automation = new TeamAutomation(upstream,teamStore,owner.epoch,undefined,coordinator);
  const instanceId = randomUUID();
  const server = http.createServer(async (req, res) => {
    try {
      // Even a local browser with a stolen URL gets no access; there is no CORS surface.
      if (req.headers.origin !== undefined) throw new KTeamError('browser_origin_forbidden', 403);
      const bearer = typeof req.headers.authorization === 'string' ? req.headers.authorization.replace(/^Bearer /, '') : '';
      const client = tokens.find(entry => equal(entry.token, bearer));
      if (!client) throw new KTeamError('authentication_required', 401);
      const url = new URL(req.url ?? '/', 'http://kteam.local');
      const compatible = req.headers['x-kteam-api-version'] === String(API_VERSION)
        && req.headers['x-kteam-schema-version'] === String(SCHEMA_VERSION);
      if (url.pathname === '/v1/handshake' && req.method === 'GET') {
        return send(res, 200, { ok: true, product: 'KTeam', clientId: client.id,
          apiVersion: API_VERSION, schemaVersion: SCHEMA_VERSION, ownerEpoch: owner.epoch, instanceId,
          access: compatible ? 'read_write' : 'read_only',
          aimp: { specification: AIMP_SPEC, wire: AIMP_WIRE, enabledLevels: ['L0'], compatibilityClaim: null,
            executionEnabled: false, localDiscussionPolicy:'experimental',reason:'full_core_l2_profile_not_verified' },
          capabilities: ['existing-agent-roster','broker-owned-teams','aimp-l0-message','bounded-history','bounded-model-discussion','human-delivery-review','conversation-first-coordinator'],
        });
      }
      if (req.method !== 'GET' && !compatible) throw new KTeamError('client_upgrade_required', 409);
      if (url.pathname === '/v1/status' && req.method === 'GET') return send(res, 200, { ok: true, ownerEpoch: owner.epoch, instanceId, upstream: await upstream.probe() });
      if(url.pathname==='/v1/inbox'&&req.method==='GET')return send(res,200,{ok:true,creations:coordinator.pendingCreations(),proposals:coordinator.proposals().filter(p=>!p.operation&&p.expiresAt>Date.now()),jobs:teamStore.jobs().filter(j=>['unknown','blocked'].includes(j.state))});
      if(url.pathname==='/v1/creations/resume'&&req.method==='POST'){const result=await coordinator.resumeCreation(await body(req),{requestSource:'user'});return send(res,200,{...result,roomId:result.roomId??result.room?.roomId});}
      if(url.pathname==='/v1/bootstrap'&&req.method==='POST')return send(res,200,{ok:true,...await coordinator.bootstrap({requestSource:'user'})});
      if(url.pathname==='/v1/direct'&&req.method==='POST'){const input=record(await body(req));if(Object.keys(input).some(k=>k!=='botId')||typeof input.botId!=='string')throw new KTeamError('invalid_input');return send(res,200,{ok:true,...await coordinator.direct(input.botId,{requestSource:'user'})});}
      if(url.pathname==='/v1/proposals/accept'&&req.method==='POST'){const input=record(await body(req));if(typeof input.roomId!=='string'||typeof input.proposalId!=='string'||typeof input.expectedHash!=='string')throw new KTeamError('invalid_input');const result=await coordinator.accept(input as any,{requestSource:'user'});void automation.tick();return send(res,200,{ok:true,...result});}
      if (url.pathname === '/v1/models' && req.method === 'GET') return send(res,200,{ok:true,...await modelCatalog()});
      if (url.pathname === '/v1/bot-create' && req.method === 'POST') {
        return send(res,201,await coordinator.createMember(await body(req),{requestSource:'user'}));
      }
      if (url.pathname === '/v1/bots' && req.method === 'GET') {const result=await collaboration.bots();return send(res,200,{...result,bots:result.bots.map(bot=>({...bot,binding:teamStore.binding(String(bot.id))}))});}
      if (url.pathname === '/v1/runtimes' && req.method === 'GET') return send(res, 200, await collaboration.runtimes());
      if (url.pathname === '/v1/teams') {
        if (req.method === 'GET') {const result=await collaboration.teams();return send(res,200,{...result,rooms:(result.rooms as any[]).filter(room=>teamStore.settings(room.roomId)).map(room=>({...room,kind:teamStore.settings(room.roomId)?.kind??'group'}))});}
        if (req.method === 'POST') {
          return send(res,201,await coordinator.createGroup(await body(req),{requestSource:'user'}));
        }
      }
      if (url.pathname === '/v1/messages' && req.method === 'POST') {
        const input=validateL0(await body(req));
        if(input.from!==LOCAL_HUMAN)throw new KTeamError('sender_identity_mismatch',403);
        await coordinator.guardConversation(input.room_id);
        const managed=!!teamStore.settings(input.room_id);
        const result=await collaboration.send(input,envelope=>{if(managed)teamStore.prepareSubmission(envelope.id,envelope.room_id,intentHash(envelope),envelope);},snapshot=>coordinator.guardConversation(input.room_id,snapshot));
        if(managed) {teamStore.completeSubmission(input.id,String(result.messageId));void automation.tick();}
        return send(res,201,result);
      }
      const teamRoute=/^\/v1\/teams\/([^/]+)\/(settings|work|pause|resume|seen|review|reconcile|proposals)$/.exec(url.pathname);
      if(teamRoute){
        const roomId=decodeURIComponent(teamRoute[1]!),action=teamRoute[2];
        const membership=await upstream.membership(roomId);
        if(req.method==='GET'&&action==='proposals')return send(res,200,{ok:true,proposals:coordinator.proposals(roomId)});
        if(req.method==='GET'&&action==='settings')return send(res,200,{ok:true,settings:teamStore.settings(roomId),seen:teamStore.seen(roomId),members:membership.members});
        if(req.method==='GET'&&action==='work')return send(res,200,{ok:true,jobs:teamStore.jobs(roomId),pendingSubmissions:teamStore.pendingSubmissions(roomId),...await upstream.aimp(roomId,'tasks')});
        if(req.method==='POST'&&action==='reconcile'){await automation.reconcileSubmissions(roomId);return send(res,200,{ok:true,pendingSubmissions:teamStore.pendingSubmissions(roomId)});}
        if(req.method==='POST'&&action==='pause')return send(res,200,await automation.pause(roomId));
        if(req.method==='POST'&&action==='resume'){
          return send(res,200,{ok:true,settings:teamStore.resume(roomId)});
        }
        if(req.method==='POST'&&action==='seen'){
          const input=record(await body(req));if(!Array.isArray(input.sequences)||input.sequences.length>200||input.sequences.some(n=>!Number.isSafeInteger(n)||Number(n)<1))throw new KTeamError('seen_input_invalid');
          const snapshot=await upstream.getTeam(roomId),valid=new Set((snapshot.messages as any[]).map(message=>message.roomSequence));
          if(input.sequences.some(n=>!valid.has(n)))throw new KTeamError('seen_scope_invalid');
          teamStore.markSeen(roomId,input.sequences as number[]);return send(res,200,{ok:true,seen:teamStore.seen(roomId)});
        }
        if(req.method==='POST'&&action==='review'){
          const input=record(await body(req));if(typeof input.taskRef!=='string'||input.decision!=='pass')throw new KTeamError('review_decision_not_supported');
          const tasks=(await upstream.aimp(roomId,'tasks')).tasks as any[],task=tasks.find(task=>task.taskRef===input.taskRef);if(!task)throw new KTeamError('task_not_found');
          const result=await upstream.aimp(roomId,'event',{id:'msg_'+createHash('sha256').update(String(input.taskRef)+String(task.revision)+String(input.decision)).digest('hex').slice(0,32),roomId,threadId:task.threadId,taskRef:task.taskRef,targetEvent:{id:task.headId,hash:task.headHash},act:'review',body:input.decision==='pass'?'用户验收通过。':'用户要求返工。',payload:{kind:'task.review@1',must_understand:true,decision:input.decision,findings:[],trust_root:'human://kteam.local/user.local'}});
          return send(res,200,result);
        }
      }
      const history = /^\/v1\/teams\/([^/]+)\/messages$/.exec(url.pathname);
      if (history && req.method === 'GET') {
        const after = page(url.searchParams.get('after'), 0, Number.MAX_SAFE_INTEGER);
        const limit = page(url.searchParams.get('limit'), 50, 100);
        if (!limit) throw new KTeamError('invalid_pagination');
        const before=url.searchParams.has('before')?page(url.searchParams.get('before'),0,Number.MAX_SAFE_INTEGER):undefined;
        return send(res, 200, await collaboration.messages(decodeURIComponent(history[1]!), after, limit,before,url.searchParams.get('tail')==='true'));
      }
      throw new KTeamError('route_not_found', 404);
    } catch (error) {
      const known = error instanceof KTeamError;
      send(res, known ? error.status : 500, { ok: false, code: known ? error.code : 'internal_error', ...(known && error.details ? { details: error.details } : {}) });
    }
  });
  server.requestTimeout = 20_000;
  server.headersTimeout = 5_000;
  server.maxHeadersCount = 32;
  try {
    // Only the exclusive owner may remove a socket left by its crashed predecessor.
    if (existsSync(path)) {
      if (!lstatSync(path).isSocket()) throw new KTeamError('host_socket_path_occupied');
      unlinkSync(path);
    }
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(path, resolve); });
    chmodSync(path, 0o600);
    automation.start();
  } catch (error) { server.close();teamStore.close(); owner.release(); throw error; }
  let closePromise: Promise<void> | undefined;
  return { epoch: owner.epoch, instanceId, path,
    close() {
      if (!closePromise) closePromise = (async () => {
        await automation.close();
        await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        teamStore.close();
        owner.release();
      })();
      return closePromise;
    },
  };
}

export function versionHeaders() { return { 'x-kteam-api-version': String(API_VERSION), 'x-kteam-schema-version': String(SCHEMA_VERSION) }; }
export type { ClientId };
