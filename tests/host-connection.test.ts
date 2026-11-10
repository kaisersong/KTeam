import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {hostConnection} from '../desktop/host-connection.js';
import {realUpstreams} from './helpers/real-upstreams.js';
import {startHost} from '../src/service/server.js';
import {initConfig} from '../src/service/config.js';
import {hostRequest} from '../src/service/client.js';

test('real socket reconnects a missing/restarted host once for concurrent readers, without replaying a lost POST', async () => {
 const f = await realUpstreams(), root = join(f.root, 'desktop');
 initConfig(root, {version:1,brokerUrl:f.upstream.options.brokerUrl,kswarmUrl:f.upstream.options.kswarmUrl});
 let host: Awaited<ReturnType<typeof startHost>> | undefined, starts = 0, loseReceipt = false, writes = 0;
 const request = hostConnection({ensureHost: async()=>{starts++;host=await startHost({root,upstream:f.upstream.options});}, request:async(route,value)=>{
  const result=await hostRequest(root,'kteam-main',route,value);
  if(value!==undefined&&route==='/v1/messages'){writes++;if(loseReceipt)throw Object.assign(Error('lost receipt'),{code:'ECONNRESET'});}
  return result;
 }});
 try {
  const statuses=await Promise.all(Array.from({length:12},()=>request('/v1/status')));
  assert(statuses.every(s=>s.upstream.ready));assert.equal(starts,1);
  await host!.close();host=undefined;
  // Manual re-entry is an explicit connection attempt, even within the poll backoff.
  await request('/v1/services/ensure',{});assert.equal(starts,2);
  const created=await request('/v1/teams',{title:'重连验证',goal:'保留一条消息',memberAgentIds:['xiaok-po'],requestId:'reconnect-team'});
  const roomId=created.room.roomId;
  loseReceipt=true;
  await assert.rejects(request('/v1/messages',{aimp:'1.0',id:'msg_'+'a'.repeat(32),room_id:roomId,thread_id:'thread-'+roomId,from:'human://kteam.local/user.local',to:[],mentions:[],ts:new Date().toISOString(),act:'chat',source_level:'principal',body:'只发送一次'}),/lost receipt/);
  assert.equal(writes,1);assert.equal((await request('/v1/teams/'+roomId+'/messages')).messages.length,1);
 } finally {await host?.close();await f.close();}
});

test('unavailable service recovery backs off, deduplicates polls and never retries authentication or business writes',async()=>{
 let time=10000,ensures=0,posts=0;
 const request=hostConnection({now:()=>time,ensureHost:async()=>{},request:async(route,value)=>{
  if(route==='/v1/services/ensure'){ensures++;throw Error('service still unavailable');}
  if(route==='/auth')throw Object.assign(Error('auth'),{code:'client_authentication_required'});
  if(value!==undefined){posts++;throw Object.assign(Error('unknown'),{code:'EPIPE'});}
  return {upstream:{ready:false}};
 }});
 await Promise.all(Array.from({length:8},()=>request('/v1/status')));assert.equal(ensures,1);
 await request('/v1/status');assert.equal(ensures,1);time+=5000;await request('/v1/status');assert.equal(ensures,2);
 await assert.rejects(request('/auth'),/auth/);assert.equal(ensures,2);
 await assert.rejects(request('/write',{}),/unknown/);assert.equal(posts,1);assert.equal(ensures,2);
});
