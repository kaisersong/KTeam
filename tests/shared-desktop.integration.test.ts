import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdirSync,rmSync} from 'node:fs';
import {createServer as createReservation} from 'node:net';
import {networkInterfaces,tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import {KTeamError} from '../src/errors.js';
import {Upstreams} from '../src/adapters/upstream.js';
import {sharedCacheMs} from '../src/protocol/shared-desktop.js';
import {hostRequest} from '../src/service/client.js';
import {initConfig} from '../src/service/config.js';
import {startHost} from '../src/service/server.js';
import {SharedDesktopClient} from '../src/service/shared-client.js';
import {privateSharedEndpoint} from '../src/service/shared-devices.js';
import {TeamStore} from '../src/service/team-store.js';
import {createDesktopAPI} from '../desktop/semantic-api.js';
import {privateTempDir} from './helpers/private-temp.js';

test('桌面宿主与真实私网 HTTPS、Broker：配对、聊天、断线缓存、补读及撤销', {timeout:90_000},async()=>{
 const root=privateTempDir(join(tmpdir(),'kteam-shared-desktop-'));
 let host:Awaited<ReturnType<typeof startHost>>|undefined;
 let closeBroker:(()=>Promise<void>)|undefined;
 let remoteStore:TeamStore|undefined;
 let remote:SharedDesktopClient|undefined;
 const formerConfig=process.env.KTEAM_MODEL_CONFIG_DIR;
 process.env.KTEAM_MODEL_CONFIG_DIR=join(root,'runtime');
 try{
  const address=Object.values(networkInterfaces()).flat().find(entry=>{
   if(entry?.family!=='IPv4'||entry.internal)return false;
   try{privateSharedEndpoint('https://'+entry.address);return true;}catch{return false;}
  })?.address;
  assert.ok(address,'真实私网 HTTPS 探针需要 RFC1918 网络接口');
  const reservation=createReservation();
  await new Promise<void>((resolve,reject)=>{reservation.once('error',reject);reservation.listen(0,address,resolve);});
  const port=reservation.address();
  assert.ok(port&&typeof port!=='string');
  await new Promise<void>((resolve,reject)=>reservation.close(error=>error?reject(error):resolve()));
  const endpoint='https://'+address+':'+port.port;

  const brokerToken=randomBytes(32).toString('hex'),sharedRoomAuthorityKey=randomBytes(32).toString('hex');
  const {createBrokerService}=await import('intent-broker/src/broker/service.js' as string);
  const {createServer}=await import('intent-broker/src/http/server.js' as string);
  const brokerPath=join(root,'broker.sqlite');
  const broker=createBrokerService({dbPath:brokerPath,aimpEnabled:true});
  const brokerServer=createServer({broker,roomService:broker.room,roomDesktopToken:brokerToken,sharedRoomAuthorityKey});
  try{
   await new Promise<void>((resolve,reject)=>{
    brokerServer.raw().once('error',reject);
    brokerServer.listen(0,'127.0.0.1').then(resolve,reject);
   });
  }catch(error){broker.close();throw error;}
  closeBroker=async()=>{
   brokerServer.raw().closeAllConnections();
   try{await brokerServer.close();}finally{broker.close();}
  };
  const upstream={brokerUrl:'http://127.0.0.1:'+brokerServer.address().port,kswarmUrl:'http://127.0.0.1:1',
   brokerToken,sharedRoomAuthorityKey};
  const adapter=new Upstreams(upstream);
  initConfig(root,{version:1,brokerUrl:upstream.brokerUrl,kswarmUrl:upstream.kswarmUrl});
  const launch=()=>startHost({root,upstream,managedSharedListener:true});
  host=await launch();
  const api=createDesktopAPI((route,value)=>hostRequest(root,'kteam-main',route,value));
  const admin=(action:string,input:Record<string,unknown>={})=>api.changeSharedGroupSettings({action,...input});
  const local=(action:string,input:Record<string,unknown>={})=>api.sharedGroupClient({action,...input});
  const companion=(route:string,value?:unknown)=>hostRequest(root,'kteam-companion','/v1/shared-groups/'+route,value);
  await assert.rejects(companion('settings'),{code:'shared_admin_forbidden'});
  await assert.rejects(companion('settings',{action:'enable',endpoint}),{code:'shared_admin_forbidden'});
  await assert.rejects(companion('client',{action:'pair-local'}),{code:'shared_admin_forbidden'});
  assert.equal((await api.sharedGroupSettings()).listening,false);
  await admin('enable',{endpoint});
  const trust=(await api.sharedGroupSettings()).trust;
  await assert.rejects(admin('enable',{endpoint:'https://'+address+':12345'}),{code:'shared_identity_rotation_required'});
  await local('pair-local');

  const remoteRoot=join(root,'remote');
  mkdirSync(remoteRoot,{mode:0o700});
  remoteStore=new TeamStore(remoteRoot);
  let time=Date.now();
  remote=new SharedDesktopClient(remoteStore,()=>time);
  const other=(action:string,input:Record<string,unknown>={})=>remote!.run({action,...input});
  const invitation=await admin('invite');
  const invite={inviteId:invitation.inviteId,secret:invitation.secret,challenge:invitation.challenge};
  await assert.rejects(other('pair',{invite,trust:{...trust,certificateSha256:'0'.repeat(64)}}),{code:'shared_certificate_mismatch'});
  assert.equal((await api.sharedGroupSettings()).requests.find((item:any)=>item.id===invite.inviteId).publicKey,undefined);
  const pendingPair=await other('pair',{invite,trust});
  assert.equal(pendingPair.paired,false);
  await admin('approve',{inviteId:invite.inviteId,publicKey:pendingPair.publicKey});
  // Complete from the persisted device key after a restart of the remote desktop.
  remote.close();remoteStore.close();
  remoteStore=new TeamStore(remoteRoot);remote=new SharedDesktopClient(remoteStore,()=>time);
  assert.equal((await other('pair-check')).paired,true);
  const original=(await other('state')).connection;
  assert.equal((await other('pair',{invite,trust})).paired,true);
  assert.deepEqual((await other('state')).connection,original);

  const status=await other('status');
  assert.equal(status.chat,true);assert.equal(status.members,true);assert.equal(status.requestSource,'user');
  assert.equal(status.dispatch,false);assert.equal(status.execution,false);
  await assert.rejects(other('dispatch'),KTeamError);
  await assert.rejects(other('execute'),{code:'shared_client_action_invalid'});
  await assert.rejects(other('create',{title:'伪造请求来源',requestSource:'agent'}),{code:'unknown_field'});
  await other('create',{title:'远端共享群',memberAgentIds:['agent-remote']});
  await local('create',{title:'本机共享群',memberAgentIds:['agent-local']});
  const list=(await local('rooms')).rooms;
  assert.deepEqual(new Set(list.map((item:any)=>item.title)),new Set(['远端共享群','本机共享群']));
  assert.deepEqual((await adapter.listTeams()).rooms,[]);
  const roomId=list.find((item:any)=>item.title==='远端共享群').roomId;
  await assert.rejects(adapter.getTeam(roomId),{code:'room_not_found'});
  const history=()=>other('history',{roomId});
  const first=(await history()).history;
  assert.equal(first.room.revision,1);
  await local('members',{roomId,expectedRoomRevision:1,addAgentIds:['agent-local']});
  await assert.rejects(other('members',{roomId,expectedRoomRevision:1,removeAgentIds:['agent-remote']}),{code:'room_revision_conflict'});
  assert.deepEqual((await other('state')).pending,[]);
  const send=async(text:string)=>{
   await local('save-draft',{roomId,text});
   await local('message',{roomId,expectedRoomRevision:2});
  };
  for(let sequence=1;sequence<=41;sequence++)await send('文本 '+sequence);
  const page1=(await history()).history;
  assert.equal(page1.room.revision,2);
  assert.deepEqual(page1.members.filter((item:any)=>item.subject.kind==='agent').map((item:any)=>item.subject.logicalAgentId).sort(),['agent-local','agent-remote']);
  assert.equal(page1.messages.length,20);assert.equal(page1.roomSequenceUpperBound,41);
  assert.equal(page1.watermark,0);assert.ok(page1.nextCursor);
  await send('快照之后 42');

  await host.close();host=undefined;
  time+=2000;
  const offline=await history();
  assert.equal(offline.offline,true);assert.deepEqual(offline.history,page1);
  await other('save-draft',{roomId,text:'断线草稿'});
  await assert.rejects(other('message',{roomId,expectedRoomRevision:2}),{code:'shared_coordinator_unreachable'});
  assert.equal((await other('draft',{roomId})).draft.text,'断线草稿');
  assert.equal((await other('state')).pending.length,0);
  host=await launch();
  assert.deepEqual((await api.sharedGroupSettings()).trust,trust);
  assert.equal((await api.sharedGroupSettings()).listening,true);
  const page2=(await history()).history;
  assert.equal(page2.roomSequenceUpperBound,41);assert.equal(page2.messages.length,40);assert.ok(page2.nextCursor);
  const page3=(await history()).history;
  assert.equal(page3.messages.length,41);assert.equal(page3.nextCursor,null);assert.equal(page3.watermark,41);
  const caughtUp=(await history()).history;
  assert.equal(caughtUp.watermark,42);assert.equal(caughtUp.messages.at(-1).text,'快照之后 42');
  assert.equal(caughtUp.cachedAt,time);
  assert.equal((await other('draft',{roomId})).draft.text,'断线草稿');
  await other('message',{roomId,expectedRoomRevision:2});
  assert.equal((await history()).history.watermark,43);
  assert.equal((await other('draft',{roomId})).draft,null);

  let dropNextWrite=true;
  brokerServer.raw().prependListener('request',(req:import('node:http').IncomingMessage,res:import('node:http').ServerResponse)=>{
   if(!dropNextWrite||req.url!=='/rooms/shared/rooms/'+roomId+'/message')return;
   dropNextWrite=false;
   res.end=(..._args:any[])=>{res.destroy();return res;};
  });
  await other('save-draft',{roomId,text:'落盘后丢失回执'});
  await assert.rejects(other('message',{roomId,expectedRoomRevision:2}),{code:'upstream_operation_unknown'});
  assert.equal(dropNextWrite,false);
  const uncertain=(await other('state')).pending[0];
  assert.equal((await other('draft',{roomId})).draft.requestId,uncertain.requestId);
  assert.equal((await other('receipt',{requestId:uncertain.requestId})).confirmed,true);
  assert.deepEqual((await other('state')).pending,[]);
  const reconciled=(await history()).history;
  assert.equal(reconciled.watermark,44);
  assert.equal(reconciled.messages.filter((item:any)=>item.text==='落盘后丢失回执').length,1);
  assert.equal((await other('draft',{roomId})).draft,null);

  // Simulate authoritative retention and a restored room sequence counter.
  const db=new DatabaseSync(brokerPath);
  db.function('solpi_disclosure_write_guard_v1',()=>0);
  try{
   db.exec('BEGIN IMMEDIATE');
   db.prepare('DELETE FROM room_messages WHERE room_id=? AND (room_sequence<4 OR room_sequence>40)').run(roomId);
   db.prepare('UPDATE room_sequences SET last_sequence=40 WHERE room_id=?').run(roomId);
   db.exec('COMMIT');
  }finally{db.close();}
  const rebuilt=(await history()).history;
  assert.equal(rebuilt.earliestAvailableSequence,4);
  assert.equal(rebuilt.missingThrough,3);
  assert.equal(rebuilt.roomSequenceUpperBound,40);
  assert.equal(rebuilt.messages[0].roomSequence,4);
  assert.equal(rebuilt.messages.length,20);

  await admin('disable');
  time+=sharedCacheMs;
  assert.deepEqual(await history(),{offline:true,history:undefined});
  await admin('enable',{endpoint});
  assert.equal((await history()).history.messages[0].roomSequence,4);
  await admin('revoke',{deviceId:original.deviceId});
  await assert.rejects(history(),{code:'shared_device_unauthorized'});
  assert.equal((await other('state')).connection,null);
  await assert.rejects(other('rooms'),{code:'shared_pairing_required'});
  // After revoke the client no longer has an active connection, so a retry with the same invite mints a new device key and conflicts with the consumed invite.
  await assert.rejects(other('pair',{invite,trust}),{code:'shared_pair_conflict'});
  await admin('rotate-coordinator-key');
  const rotated=(await api.sharedGroupSettings()).trust;
  assert.equal(rotated.certificateSha256,trust.certificateSha256);
  assert.notEqual(rotated.coordinatorId,trust.coordinatorId);
  assert.equal((await local('state')).connection,null);
 }finally{
  remote?.close();remoteStore?.close();
  try{await host?.close();}finally{
   try{await closeBroker?.();}finally{
    if(formerConfig===undefined)delete process.env.KTEAM_MODEL_CONFIG_DIR;else process.env.KTEAM_MODEL_CONFIG_DIR=formerConfig;
    rmSync(root,{recursive:true,force:true});
   }
  }
 }
});
