import { createHmac } from 'node:crypto';
import type { SharedSession } from '../service/shared-devices.js';
import { KTeamError, record } from '../errors.js';
import { parseJson } from '../protocol/json.js';
import { supportsRoomWorkspaceProtocol } from '../core-protocol/room-workspace-protocol.js';

const sharedVersion = 1;
const sharedBase = ['shared-session-authority-v1', 'shared-room-scope-v1'];
const sharedReceipts = 'exact-operation-receipt-v1';
const sharedHistory = 'room-history-snapshot-v1';
const sharedCapabilities = [...sharedBase, sharedReceipts, sharedHistory];

export type SharedRoomAction = 'list' | 'create' | 'members' | 'message' | 'receipt' | 'history';

export interface UpstreamOptions {
  brokerUrl: string; kswarmUrl: string; brokerToken?: string; kswarmToken?: string; sharedRoomAuthorityKey?: string;
}

export function loopbackUrl(input: string): string {
  const url = new URL(input);
  if (url.protocol !== 'http:' || !['127.0.0.1','[::1]'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new KTeamError('upstream_must_be_loopback');
  }
  return url.origin;
}


/** Semantic adapters over the existing owners; never opens their DBs or starts their schedulers. */
export class Upstreams {
  private brokerUrl: string;
  private kswarmUrl: string;
  private rejectionLogs=new Map<string,number>();
  constructor(private options: UpstreamOptions) {
    this.brokerUrl = loopbackUrl(options.brokerUrl);
    this.kswarmUrl = loopbackUrl(options.kswarmUrl);
  }
  private async request(component: 'broker' | 'kswarm', route: string, method = 'GET', body?: unknown, readOnly = method === 'GET', sharedHeaders?: Record<string, string>): Promise<Record<string, unknown>> {
    const token = sharedHeaders ? undefined : component === 'broker' ? this.options.brokerToken : this.options.kswarmToken;
    if ((component === 'broker' || method !== 'GET') && !token && !sharedHeaders) throw new KTeamError(component + '_credential_required', 503);
    let response: Response;
    try {
      const signal=AbortSignal.timeout(10_000);
      const fetchOnce=()=>fetch((component === 'broker' ? this.brokerUrl : this.kswarmUrl) + route, {
        method, redirect: 'error', signal,
        headers: { ...sharedHeaders, ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(token ? { [component === 'broker' ? 'x-intent-broker-room-token' : 'x-kswarm-mutation-token']: token } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      try{response=await fetchOnce();}catch(error){
        const code=(error as {cause?:{code?:string}})?.cause?.code;
        // Read-only requests may meet a stale keep-alive socket after sleep/restart.
        // Mutation receipts stay unknown; only GET and the pure execution-check
        // observation can retry a stale socket. Redirects remain forbidden.
        if(!readOnly||!['ECONNRESET','ECONNREFUSED','UND_ERR_SOCKET'].includes(code??'')||signal.aborted)throw error;
        response=await fetchOnce();
      }
    } catch {
      // A timeout after POST is an unknown result: caller must reuse the same request ID.
      throw new KTeamError(readOnly ? component + '_unavailable' : 'upstream_operation_unknown', 503);
    }
    // History supports 100 texts of 32 KiB each; JSON escaping may expand each byte.
    const maxResponseBytes = sharedHeaders && route.endsWith('/history') ? 24 * 1024 * 1024 : 2 * 1024 * 1024;
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = []; let size = 0;
    if (!reader) throw new KTeamError(readOnly ? 'upstream_response_invalid' : 'upstream_operation_unknown', 502);
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > maxResponseBytes) {
          await reader.cancel();
          throw new KTeamError(!sharedHeaders || readOnly ? 'upstream_response_too_large' : 'upstream_operation_unknown', 502);
        }
        chunks.push(chunk.value);
      }
      let result: Record<string, unknown>;
      try { result = record(parseJson(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)), maxResponseBytes)); }
      catch { throw new KTeamError(readOnly ? 'upstream_response_invalid' : 'upstream_operation_unknown', 502); }
      if (!response.ok || result.ok === false) {
        // Broker duplicate is an original receipt, not permission to run anything again.
        if (result.code === 'room_message_duplicate' && result.message) return { ...result, ok: true, reused: true };
        const nested=result.error&&typeof result.error==='object'&&!Array.isArray(result.error)
          ? (result.error as Record<string,unknown>).code : result.error;
        const supplied=typeof result.code==='string'?result.code:nested;
        const code=typeof supplied==='string'&&/^[a-z][a-z0-9_-]{0,79}$/.test(supplied)?supplied:'upstream_rejected';
        if(code==='upstream_rejected'){
          // Record only fixed diagnostics. Request URLs and upstream payloads can contain private data.
          const key=component+':'+method+':'+response.status;
          const now=Date.now();
          if(now-(this.rejectionLogs.get(key)??0)>=60000){
            if(this.rejectionLogs.size>=24)this.rejectionLogs.clear();
            this.rejectionLogs.set(key,now);
            console.warn('[KTeam upstream] '+JSON.stringify({component,method,status:response.status}));
          }
        }
        if(code==='upstream_rejected'&&!readOnly&&response.status>=500)throw new KTeamError('upstream_operation_unknown',503);
        throw new KTeamError(code,response.status>=400?response.status:409);
      }
      return result;
    } catch (error) {
      if (error instanceof KTeamError) throw error;
      throw new KTeamError(readOnly ? 'upstream_response_invalid' : 'upstream_operation_unknown', 502);
    } finally { reader.releaseLock(); }
  }
  async probe() {
    const [broker, kswarm] = await Promise.allSettled([
      this.request('broker', '/rooms/workspace-protocol'), this.request('kswarm', '/health'),
    ]);
    const summarize = (result: PromiseSettledResult<Record<string, unknown>>) => result.status === 'fulfilled'
      ? { available: true, workspaceProtocol: supportsRoomWorkspaceProtocol(result.value),botPrivateMessages:Array.isArray(result.value.capabilities)&&result.value.capabilities.includes('bot-private-messages'),externalAgentMessages:Array.isArray(result.value.capabilities)&&result.value.capabilities.includes('external-agent-messages'),conversationContext:Array.isArray(result.value.capabilities)&&result.value.capabilities.includes('conversation-context'),messageRevisionCAS:Array.isArray(result.value.capabilities)&&result.value.capabilities.includes('message-revision-cas') }
      : { available: false, workspaceProtocol: false, externalAgentMessages:false,botPrivateMessages:false,messageRevisionCAS:false,reason: result.reason instanceof KTeamError ? result.reason.code : 'upstream_unavailable' };
    const b = summarize(broker), k = summarize(kswarm);
    return { broker: b, kswarm: k, ready: b.workspaceProtocol && b.botPrivateMessages && b.messageRevisionCAS && b.conversationContext && k.workspaceProtocol };
  }
  async requireReady(): Promise<void> {
    const status = await this.probe();
    if (!status.ready) throw new KTeamError(status.broker.workspaceProtocol&&(!status.broker.conversationContext||!status.broker.botPrivateMessages)?'conversation_service_upgrade_required':'upstream_protocol_unavailable', 503, status);
  }
  private sharedHeaders(session: SharedSession) {
    const key = this.options.sharedRoomAuthorityKey;
    if (!key || !/^[a-f0-9]{64}$/.test(key) || key === this.options.brokerToken || key === this.options.kswarmToken) {
      throw new KTeamError('shared_room_authority_unavailable', 503);
    }
    const { workspaceId, principalId, deviceId, deviceGeneration, coordinatorGeneration } = session;
    const issuedAt = Date.now();
    const payload = Buffer.from(JSON.stringify({ workspaceId, principalId, deviceId, deviceGeneration,
      recoveryGeneration: coordinatorGeneration, issuedAt, expiresAt: issuedAt + 10_000 })).toString('base64url');
    const signature = createHmac('sha256', Buffer.from(key, 'hex')).update('shared-room-session.v1.' + payload).digest('base64url');
    return {
      'x-intent-broker-shared-assertion': payload + '.' + signature,
      'x-intent-broker-shared-version': String(sharedVersion),
      'x-intent-broker-shared-recovery-generation': String(coordinatorGeneration),
      'x-intent-broker-shared-device-generation': String(deviceGeneration),
    };
  }

  async sharedGroupsStatus(session: SharedSession) {
    let capabilities: unknown[] = [];
    let reason = 'shared_group_protocol_unavailable';
    try {
      const protocol = await this.request('broker', '/rooms/shared/protocol', 'GET', undefined, true, this.sharedHeaders(session));
      if (protocol.version === sharedVersion && Array.isArray(protocol.capabilities)) capabilities = protocol.capabilities;
    } catch (error) {
      if (error instanceof KTeamError && error.code !== 'not_found') reason = error.code;
    }
    const missing = sharedCapabilities.filter(capability => !capabilities.includes(capability));
    const list = sharedBase.every(capability => capabilities.includes(capability));
    const writes = list && capabilities.includes(sharedReceipts);
    return { available: list, reason: missing.length ? reason : null, missing, list, create: writes,
      chat: writes, members: writes, receipts: writes, history: list && capabilities.includes(sharedHistory),
      dispatch: false, execution: false };
  }

  async sharedRoom(session: SharedSession, assertCurrent: () => void, action: SharedRoomAction,
    roomId: string | undefined, input?: Record<string, unknown>) {
    const status = await this.sharedGroupsStatus(session);
    assertCurrent();
    const enabled = { list: status.list, create: status.create, members: status.members, message: status.chat,
      receipt: status.receipts, history: status.history };
    if (!enabled[action]) throw new KTeamError(status.reason ?? 'shared_group_protocol_unavailable', 503, status);
    const base = '/rooms/shared/rooms';
    const scope = roomId === undefined ? base : base + '/' + encodeURIComponent(roomId);
    const route = action === 'list' || action === 'create' ? base : scope + '/' + action;
    const readOnly = action === 'list' || action === 'receipt' || action === 'history';
    return this.request('broker', route, action === 'list' ? 'GET' : 'POST', input, readOnly, this.sharedHeaders(session));
  }

  conversationData(roomId:string){return this.request('broker',`/rooms/${encodeURIComponent(roomId)}/workspace/conversation`);}
  conversationMessage(roomId:string,messageId:string){return this.request('broker',`/rooms/${encodeURIComponent(roomId)}/workspace/message?messageId=${encodeURIComponent(messageId)}`);}
  searchConversation(roomId:string,query:string,before?:number){return this.request('broker',`/rooms/${encodeURIComponent(roomId)}/workspace/search?query=${encodeURIComponent(query)}${before?'&before='+before:''}`);}
  async updateConversation(roomId:string,input:Record<string,unknown>,agent=false){
    if(input.operation!=='shared.replace')return this.request('broker',`/rooms/${encodeURIComponent(roomId)}/workspace/${agent?'agent-conversation':'conversation'}`,'POST',input);
    const normalized=await normalizeSharedSources(input.sourceMessageIds,id=>this.conversationMessage(roomId,id));
    const result=await this.request('broker',`/rooms/${encodeURIComponent(roomId)}/workspace/${agent?'agent-conversation':'conversation'}`,'POST',{...input,sourceMessageIds:normalized.ids});
    return {...result,...(normalized.warnings.length?{sourceWarnings:normalized.warnings}:{})};
  }
  listBots() { return this.request('kswarm', '/agents'); }
  updateBot(botId:string,input:Record<string,unknown>){return this.request('kswarm',`/agents/${encodeURIComponent(botId)}`,'PUT',input);}
  createBot(input:Record<string,unknown>){return this.request('kswarm','/agents','POST',input);}
  aimp(roomId:string,command:string,input?:Record<string,unknown>){
    if(!['session','status','tasks','configure','event','agent-event','begin-execution','execution-check','effect','heartbeat','chat','verify-delivery'].includes(command))throw new KTeamError('aimp_command_invalid');
    // checkExecution is a pure observation even though the broker accepts POST.
    return this.request('broker',`/rooms/${encodeURIComponent(roomId)}/aimp/${command}`,input?'POST':'GET',input, !input || command==='execution-check');
  }
  async aimpEffects(roomId:string,taskRef:string){const status=await this.aimp(roomId,'status');if(!(status.capabilities as string[]|undefined)?.includes('effect-observation-v1'))throw new KTeamError('effect_observation_unavailable',503);return this.request('broker',`/rooms/${encodeURIComponent(roomId)}/aimp/effects?taskRef=${encodeURIComponent(taskRef)}`);}
  async requireExternalMessages(){const result=await this.probe();if(!result.ready||!result.broker.externalAgentMessages)throw new KTeamError('agent_service_upgrade_required',503);}
  deleteTeam(roomId:string,expectedRoomRevision:number){return this.request('broker',`/rooms/${encodeURIComponent(roomId)}/delete`,'POST',{expectedRoomRevision});}
  updateMembers(roomId:string,input:Record<string,unknown>){return this.request('broker',`/rooms/${encodeURIComponent(roomId)}/members`,'PUT',input);}
  updateTeam(roomId:string,input:Record<string,unknown>){return this.request('broker',`/rooms/${encodeURIComponent(roomId)}/metadata`,'PUT',input);}
  externalReply(roomId:string,input:Record<string,unknown>){return this.request('broker',`/rooms/${encodeURIComponent(roomId)}/agent-messages`,'POST',input);}
  registerNativeParticipant(input:Record<string,unknown>){return this.request('broker','/participants/register','POST',input);}
  listRuntimes() { return this.request('kswarm', '/runtimes'); }
  listProjects() { return this.request('kswarm', '/projects'); }
  listTeams() { return this.request('broker', '/rooms'); }
  getTeam(roomId: string) { return this.request('broker', '/rooms/' + encodeURIComponent(roomId)); }
  membership(roomId:string){return this.request('broker',`/rooms/${encodeURIComponent(roomId)}/membership`);}
  createTeam(input: Record<string, unknown>) { return this.request('broker', '/rooms', 'POST', input); }
  messages(roomId: string, after: number, limit: number,before?:number,tail=false) {
    return this.request('broker', `/rooms/${encodeURIComponent(roomId)}/messages?afterSequence=${after}&limit=${limit}${before!==undefined?'&beforeSequence='+before:''}${tail?'&direction=backward':''}`);
  }
  masterMessagingProtocol(){return this.request('broker','/rooms/workspace-protocol');}
  sendOwnerAgentRelay(roomId:string,input:Record<string,unknown>){return this.request('broker',`/rooms/${encodeURIComponent(roomId)}/owner-agent-messages`,'POST',input);}
  sendBotPrivate(roomId:string,input:Record<string,unknown>){return this.request('broker',`/rooms/${encodeURIComponent(roomId)}/bot-messages`,'POST',input);}
  sendMessage(roomId: string, input: Record<string, unknown>) {
    return this.request('broker', `/rooms/${encodeURIComponent(roomId)}/messages`, 'POST', input);
  }
}

/** Match the Room owner's 20-source contract; never turn a transport failure into missing evidence. */
export async function normalizeSharedSources(value:unknown,read:(id:string)=>Promise<any>){
 const warnings=new Set<string>(),ids:string[]=[],seen=new Set<string>();
 if(value!==undefined&&!Array.isArray(value))warnings.add('source_ids_invalid');
 const candidates=Array.isArray(value)?value:[];if(candidates.length>20)warnings.add('source_ids_limit');
 const found:{id:string;sequence:number}[]=[];
 for(const raw of candidates.slice(0,100)){if(typeof raw!=='string'||!raw.trim()||raw.length>256){warnings.add('source_id_invalid');continue;}const id=raw.trim();if(seen.has(id))continue;seen.add(id);
  try{const {message}=await read(id);if(!message||message.messageId!==id||!Number.isSafeInteger(message.roomSequence))throw new KTeamError('room_scope_mismatch',403);found.push({id,sequence:message.roomSequence});}
  catch(error){if(error instanceof KTeamError&&['room_scope_mismatch','room_message_not_found','message_not_found'].includes(error.code)){warnings.add('source_message_unavailable');continue;}throw error;}
 }
 found.sort((a,b)=>a.sequence-b.sequence||a.id.localeCompare(b.id));ids.push(...found.slice(0,20).map(item=>item.id));return {ids,warnings:[...warnings]};
}
