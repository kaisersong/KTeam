import {removeTempRoot} from './helpers/tmp-root.js';
import {privateTempDir as mkdtempSync} from './helpers/private-temp.js';
import {tmpdir} from 'node:os';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fork, type ChildProcess } from 'node:child_process';
import {realpathSync, rmSync, mkdirSync, writeFileSync} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { initConfig } from '../src/service/config.js';
import { startHost } from '../src/service/server.js';
import { hostRequest } from '../src/service/client.js';
import { LOCAL_HUMAN } from '../src/service/collaboration.js';

const project = fileURLToPath(new URL('../../', import.meta.url));
async function importSource(name: string) { return import(name); }
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>(resolve => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 4000);
    child.once('exit', () => { clearTimeout(timer); resolve(); }); child.kill('SIGTERM');
  });
}

test('real KSwarm + intent-broker: same roster, one Room transcript, AIMP retries/conflicts, reopening host recovers history', { timeout: 40_000 }, async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(),'kteam-e2e-')));
  const source = join(project, 'node_modules/kswarm');
  const home = join(root, 'home'); mkdirSync(home, { mode: 0o700 });
  const brokerToken = randomBytes(32).toString('hex'), kswarmToken = randomBytes(32).toString('hex');
  const { createBrokerService } = await importSource('intent-broker/src/broker/service.js');
  const { createServer } = await importSource('intent-broker/src/http/server.js');
  const broker = createBrokerService({ dbPath: join(root, 'broker.sqlite'), aimpEnabled:true });
  const server = createServer({ broker, roomService: broker.room, roomDesktopToken: brokerToken });
  await server.listen(0, '127.0.0.1'); broker.attachWebSocket(server.raw());
  const brokerUrl = 'http://127.0.0.1:' + server.address().port;
  let logs = '';
  const child = fork(join(source, 'src/server/index.js'), [], {
    cwd: root, silent: true, execArgv: ['--preserve-symlinks', '--preserve-symlinks-main', '--import', pathToFileURL(join(project, 'tests/loopback-test-host.mjs')).href],
    env: { ...process.env, HOME: home, USERPROFILE: home, KSWARM_PORT: '0', KSWARM_DATA_ROOT: join(home, '.kswarm'),
      BROKER_URL: brokerUrl, KSWARM_DESKTOP_MUTATION_TOKEN: kswarmToken, KSWARM_RUNTIME_TOKEN: '',
      INTENT_BROKER_KSWARM_TOKEN: '', PATH: dirname(process.execPath) + ':/usr/bin:/bin', ENABLE_HUMAN_ESCALATION: '0' },
  });
  child.stdout!.on('data', chunk => logs += chunk); child.stderr!.on('data', chunk => logs += chunk);
  let host: Awaited<ReturnType<typeof startHost>> | undefined;
  writeFileSync(join(root, 'test-process.json'), JSON.stringify({ pid: child.pid, root }));
  try {
    const port = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('upstream_start_timeout: ' + logs)), 10_000);
      child.on('message', (value: any) => { if (value.type === 'test-listening') { clearTimeout(timer); resolve(value.address.port); } });
      child.once('exit', code => { clearTimeout(timer); reject(new Error('upstream_exit:' + code + ':' + logs)); });
    });
    const kswarmUrl = 'http://127.0.0.1:' + port;
    const upstream = { brokerUrl, kswarmUrl, brokerToken, kswarmToken };
    const state = join(root, 'kteam'); initConfig(state, { version: 1, brokerUrl, kswarmUrl });
    host = await startHost({ root: state, upstream });
    const request = (route: string, value?: unknown) => hostRequest(state, 'kteam-main', route, value);
    assert.equal(((await request('/v1/status')).upstream as any).ready, true);
    const bots = (await request('/v1/bots')).bots as any[];
    assert.ok(bots.some(bot => bot.id === 'xiaok-worker'));
    assert.ok(bots.every(bot => bot.kteamExecution === 'not_verified'));
    assert.ok(bots.every(bot => !Object.hasOwn(bot, 'apiKey') && !Object.hasOwn(bot, 'customEnv')));
    const input = { title: '经营团队', goal: '准备本周经营复盘', memberAgentIds: ['xiaok-po','xiaok-worker'], requestId: 'team-1' };
    const created = await request('/v1/teams', input);
    const roomId = (created.room as any).roomId;
    assert.equal(((await request('/v1/teams', input)).room as any).roomId, roomId);
    await assert.rejects(request('/v1/teams', { ...input, goal: 'different' }), /room_create_request_conflict/);
    assert.equal(((await hostRequest(state, 'kteam-companion', '/v1/teams')).rooms as any[]).filter(room => room.roomId === roomId).length, 1);
    const directory=()=>request('/v1/teams').then(result=>(result.rooms as any[]).find(room=>room.roomId===roomId));
    assert.equal((await directory()).pinnedAt,null);
    const pin=await request(`/v1/teams/${roomId}/sidebar`,{pinned:true});
    assert.ok(typeof pin.pinnedAt==='string');
    assert.equal((await request(`/v1/teams/${roomId}/sidebar`,{pinned:true})).pinnedAt,pin.pinnedAt,'retry keeps pin order');
    await assert.rejects(request(`/v1/teams/${roomId}/sidebar`,{pinned:'false'}),/sidebar_input_invalid/);
    await assert.rejects(request(`/v1/teams/${roomId}/sidebar`,{pinned:true,title:'changed'}),/unknown_field/);
    const envelope = { aimp: '1.0', id: 'msg_' + randomBytes(16).toString('hex'), room_id: roomId, thread_id: 'thread-' + roomId,
      from: LOCAL_HUMAN, to: [], mentions: [], ts: new Date().toISOString(), act: 'chat', source_level: 'principal', body: '运营和技术一起准备复盘。' };
    const first = await request('/v1/messages', envelope);
    const retry = await request('/v1/messages', { ...envelope, ts: '2026-11-09T00:00:00Z' });
    assert.equal(retry.messageId, first.messageId); assert.equal(retry.reused, true);
    await assert.rejects(request('/v1/messages', { ...envelope, body: 'changed' }), /aimp_id_conflict/);
    await assert.rejects(request('/v1/messages', { ...envelope, from: 'agent://kteam.local/xiaok-worker' }), /sender_identity_mismatch/);
    await assert.rejects(request('/v1/messages', { ...envelope, mentions: ['agent://kteam.local/stranger'] }), /recipient_not_member/);
    await assert.rejects(request('/v1/messages', { ...envelope, act: 'accept' }), /aimp_effect_not_enabled/);
    const history = await request(`/v1/teams/${roomId}/messages?limit=1`);
    assert.equal((history.messages as any[]).length, 1);
    assert.equal((history.messages as any[])[0].envelope.body, envelope.body);
    const ctx = { sessionId: 'verification', requestSource: 'user', actor: { kind: 'user', userId: 'user.local' }, allowedLogicalAgentIds: [], issuedAt: new Date().toISOString() };
    const transcript = broker.room.listRoomMessages({ roomId }, ctx);
    assert.equal(transcript.messages.length, 1); assert.equal(transcript.messages[0].responsePolicy, 'none');
    const epoch = host.epoch; await host.close();
    host = await startHost({ root: state, upstream });
    assert.ok(host.epoch > epoch);
    assert.equal((await directory()).pinnedAt,pin.pinnedAt,'pin survives host restart');
    assert.equal((await request(`/v1/teams/${roomId}/sidebar`,{pinned:false})).pinnedAt,null);
    assert.equal((await directory()).pinnedAt,null);
    assert.equal(((await request(`/v1/teams/${roomId}/messages`)).messages as any[]).length, 1);
    assert.equal((await request('/v1/messages', envelope)).messageId, first.messageId);
    assert.equal(broker.room.listRoomMessages({ roomId }, ctx).messages.length, 1);
    const reply = { ...envelope, id: 'msg_' + randomBytes(16).toString('hex'), body: '补充目标：请先整理数据口径。', reply_to: envelope.id };
    await request('/v1/messages', reply);
    const updated = broker.room.listRoomMessages({ roomId }, ctx).messages;
    assert.equal(updated.length, 2);
    assert.equal(updated[1].replyToMessageId, first.messageId, 'AIMP reply ID maps to original broker message ID');
    assert.equal(updated[1].sourceRef.envelope.reply_to, envelope.id);
    for(let n=0;n<105;n++)assert.equal(broker.room.sendRoomMessage({roomId,threadId:'thread-'+roomId,kind:'text',text:'history-'+n,responsePolicy:'none',contextScope:{kind:'room_only'},idempotencyKey:'history-'+n},ctx).ok,true);
    const tail=await request(`/v1/teams/${roomId}/messages?tail=true&limit=100`);
    assert.equal((tail.messages as any[]).length,100);assert.equal((tail.messages as any[]).at(-1).text,'history-104');assert.equal(tail.hasMoreBefore,true);
    const older=await request(`/v1/teams/${roomId}/messages?tail=true&before=${(tail.messages as any[])[0].roomSequence}&limit=100`);
    assert.equal((older.messages as any[]).length,7);assert.equal((older.messages as any[])[0].messageId,first.messageId);
    await stop(child);
    await assert.rejects(request('/v1/messages', { ...reply, id: 'msg_' + randomBytes(16).toString('hex') }), /upstream_protocol_unavailable/);
    assert.equal(broker.room.listRoomMessages({ roomId }, ctx).messages.length, 107, 'missing project owner cannot be bypassed by a live Room owner');
  } finally {
    await host?.close(); await stop(child); broker.close(); await server.close();
    assert.ok(child.exitCode !== null || child.signalCode !== null, 'own upstream process must be reaped');
    removeTempRoot(root);
  }
});
