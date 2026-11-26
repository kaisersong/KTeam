import {test} from 'node:test';
import assert from 'node:assert/strict';
import {realUpstreams} from './helpers/real-upstreams.js';

// Capability probe against the pinned, isolated services; no substitute transport.
test('共享群门槛探针：真实服务、事务序号、重复与版本变化', {timeout:30_000}, async()=>{
 const fixture=await realUpstreams();
 try {
  const {upstream,broker}=fixture;
  await upstream.requireReady();
  const created=await upstream.createTeam({title:'共享群协议探针',memberAgentIds:[],clientRequestKey:'probe-room'});
  const roomId=created.room.roomId;
  const input={kind:'text',text:'探针',responsePolicy:'none',contextScope:{kind:'room_only'},idempotencyKey:'probe-message',expectedRoomRevision:1};
  const first=await upstream.sendMessage(roomId,input);
  assert.ok(Number.isSafeInteger(first.message.roomSequence));
  const duplicate=await upstream.sendMessage(roomId,input);
  assert.equal(duplicate.message.messageId,first.message.messageId);
  await upstream.updateTeam(roomId,{title:'共享群协议探针二',description:'',expectedRoomRevision:1});
  await assert.rejects(upstream.sendMessage(roomId,input),/room_revision_conflict/);
  const ctx={sessionId:'probe',requestSource:'user',actor:{kind:'user',userId:'probe.shared'},allowedLogicalAgentIds:[],issuedAt:new Date().toISOString()};
  const shared=broker.room.createRoom({title:'非本机主体',memberAgentIds:[],clientRequestKey:'shared-principal'},ctx);
  assert.equal(shared.ok,true);
  assert.equal(broker.room.sendRoomMessage({roomId:shared.room.roomId,...input},ctx).ok,true);
  const page=await upstream.messages(roomId,0,1);
  assert.equal(page.messages[0].roomSequence,first.message.roomSequence);
 } finally {await fixture.close();}
});

import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('共享群 Broker 存储探针：非本机主体、快照分页、重开与越权',async()=>{
 const {createBrokerService}=await import('intent-broker/src/broker/service.js' as string);
 const root=mkdtempSync(join(tmpdir(),'kteam-shared-storage-probe-'));
 let broker:any;
 try {
  broker=createBrokerService({dbPath:join(root,'broker.sqlite'),aimpEnabled:true});
  const ctx={sessionId:'probe',requestSource:'user',actor:{kind:'user',userId:'shared-principal'},allowedLogicalAgentIds:[],issuedAt:new Date().toISOString()};
  const created=broker.room.createRoom({title:'共享存储探针',memberAgentIds:[],clientRequestKey:'create'},ctx);
  assert.equal(created.ok,true);const roomId=created.room.roomId;
  const send=(key:string)=>broker.room.sendRoomMessage({roomId,kind:'text',text:key,responsePolicy:'none',contextScope:{kind:'room_only'},idempotencyKey:key,expectedRoomRevision:1},ctx);
  const a=send('a'),b=send('b');assert.equal(a.ok,true);assert.equal(b.ok,true);
  assert.ok(b.message.roomSequence>a.message.roomSequence);
  assert.equal(send('a').message.messageId,a.message.messageId);
  const upper=b.message.roomSequence;
  const first=broker.room.listRoomMessages({roomId,afterSequence:0,beforeSequence:upper+1,limit:1},ctx);
  assert.equal(first.messages.length,1);send('c');
  const second=broker.room.listRoomMessages({roomId,afterSequence:first.messages[0].roomSequence,beforeSequence:upper+1,limit:1},ctx);
  assert.equal(second.messages[0].messageId,b.message.messageId);
  assert.equal(broker.room.listRoomMessages({roomId,limit:1},{...ctx,actor:{kind:'user',userId:'outsider'}}).code,'room_membership_required');
  broker.close();broker=createBrokerService({dbPath:join(root,'broker.sqlite'),aimpEnabled:true});
  assert.equal(send('a').message.messageId,a.message.messageId);
  assert.equal(broker.room.updateRoomMetadata({roomId,title:'新标题',description:'',expectedRoomRevision:1},ctx).ok,true);
  assert.equal(send('a').code,'room_revision_conflict');
 } finally {broker?.close();rmSync(root,{recursive:true,force:true});}
});
