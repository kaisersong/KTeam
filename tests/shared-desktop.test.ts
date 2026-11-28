import assert from 'node:assert/strict';
import {createPrivateKey,createHash,generateKeyPairSync,randomBytes,X509Certificate} from 'node:crypto';
import {readFileSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {privateTempDir} from './helpers/private-temp.js';
import {Upstreams} from '../src/adapters/upstream.js';
import {KTeamError} from '../src/errors.js';
import {hostUpstreamOptions,prepareSharedAuthority,readServicePlan,sharedAuthorityEnv} from '../src/runtime/managed-services.js';
import {sharedCacheMs} from '../src/protocol/shared-desktop.js';
import {SharedDesktopClient,sharedPendingMs} from '../src/service/shared-client.js';
import {SharedDevices} from '../src/service/shared-devices.js';
import {SharedGateway} from '../src/service/shared-gateway.js';
import {assertSharedCertificate,certificateDigest,createSharedTLS} from '../src/service/shared-tls.js';
import {TeamStore} from '../src/service/team-store.js';

test('托管服务迁移同一把独立密钥，保留已有端口和令牌',()=>{
 const root=privateTempDir(join(tmpdir(),'kteam-shared-plan-'));
 try{
  const path=join(root,'config.json'),brokerToken=randomBytes(32).toString('hex'),kswarmToken=randomBytes(32).toString('hex');
  const original={version:1,broker:{cwd:root,env:{PORT:'41111',INTENT_BROKER_DESKTOP_TOKEN:brokerToken}},
   kswarm:{cwd:root,env:{KSWARM_PORT:'41112',KSWARM_DESKTOP_MUTATION_TOKEN:kswarmToken}}};
  writeFileSync(path,JSON.stringify(original),{mode:0o600,flag:'wx'});
  const authority=prepareSharedAuthority(path);
  assert.match(authority,/^[a-f0-9]{64}$/);
  assert.ok(authority!==brokerToken&&authority!==kswarmToken);
  const migrated=readServicePlan(path);
  assert.deepEqual(migrated,{...original,broker:{...original.broker,env:{...original.broker.env,[sharedAuthorityEnv]:authority}}});
  const first=readFileSync(path,'utf8');
  assert.equal(prepareSharedAuthority(path),authority);
  assert.equal(readFileSync(path,'utf8'),first);
  if(process.platform!=='win32')assert.equal(statSync(path).mode&0o777,0o600);
  assert.equal(hostUpstreamOptions({version:1,brokerUrl:'http://127.0.0.1:41111',kswarmUrl:'http://127.0.0.1:41112',
   managedServiceConfig:path}).sharedRoomAuthorityKey,authority);
  migrated.broker.env[sharedAuthorityEnv]=brokerToken;
  writeFileSync(path,JSON.stringify(migrated));
  assert.throws(()=>prepareSharedAuthority(path),{code:'shared_room_authority_unavailable'});
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('私网证书的密钥、IP SAN、指纹和有效期校验',()=>{
 for(const endpoint of ['https://192.168.8.2:8443','https://[fd12:3456::abcd]:8443']){
  const now=Date.UTC(2026,10,27),material=createSharedTLS(endpoint,now),certificate=new X509Certificate(material.certificate);
  const trust={endpoint,coordinatorId:'fixture',publicKey:'fixture',certificateSha256:certificateDigest(certificate)};
  assert.equal(certificate.checkPrivateKey(createPrivateKey(material.privateKey)),true);
  assertSharedCertificate(certificate,trust,now);
  for(const other of [{...trust,endpoint:'https://192.168.8.3:8443'},{...trust,certificateSha256:'0'.repeat(64)}])
   assert.throws(()=>assertSharedCertificate(certificate,other,now),{code:'shared_certificate_mismatch'});
  assert.throws(()=>assertSharedCertificate(certificate,trust,now+366*86400_000),{code:'shared_certificate_mismatch'});
 }
 assert.throws(()=>createSharedTLS('https://127.0.0.1'),{code:'shared_private_https_required'});
});

test('真实设备签名和本地存储：草稿、七天保留、回执原键、重新配对后仅查询',async()=>{
 const root=privateTempDir(join(tmpdir(),'kteam-shared-desktop-state-'));
 let store=new TeamStore(root);
 let time=Date.now();
 const now=()=>time;
 let devices=new SharedDevices(store,now);
 const endpoint='https://192.168.8.2:8443',material=createSharedTLS(endpoint);
 const {coordinatorId,publicKey}=devices.identity();
 devices.configureTrust({endpoint,coordinatorId,publicKey,certificateSha256:certificateDigest(new X509Certificate(material.certificate))});
 let unavailable=true;
 const attempts:{path:string;body:any}[]=[];
 const reopen=()=>{
  const transport=async(_trust:unknown,method:string,path:string,raw:string,proof?:string)=>{
   if(unavailable)throw new KTeamError('shared_coordinator_unreachable',503);
   if(path==='/shared/v1/identity'||path==='/shared/v1/pair'){
    const gateway=new SharedGateway(devices,new Upstreams({brokerUrl:'http://127.0.0.1:1',kswarmUrl:'http://127.0.0.1:1'}));
    return gateway.call(method,path,raw,{'x-kteam-shared-api':'1','x-kteam-shared-schema':'1'});
   }
   const session=devices.authenticate(JSON.parse(proof!),method,path,raw);
   assert.equal(session.requestSource,'user');
   if(path==='/shared/v1/status')return {chat:true};
   const body=JSON.parse(raw);
   attempts.push({path,body});
   if(path.endsWith('/messages'))throw new KTeamError('upstream_operation_unknown',503);
   throw new KTeamError('shared_operation_pending_verification',409);
  };
  return new SharedDesktopClient(store,now,transport);
 };
 let local=reopen();
 const roomId='room-fixture';
 try{
  assert.throws(()=>devices.enrollLocal(generateKeyPairSync('rsa',{modulusLength:2048}).publicKey.export({type:'spki',format:'pem'}).toString()),{code:'shared_public_key_invalid'});
  await local.run({action:'pair-local'},devices);
  await local.run({action:'save-draft',roomId,text:'保留这段文本'});
  await assert.rejects(local.run({action:'message',roomId,expectedRoomRevision:1}),{code:'shared_coordinator_unreachable'});
  assert.equal(attempts.length,0);
  assert.deepEqual((await local.run({action:'state'})).draftRooms,[roomId]);
  assert.deepEqual((await local.run({action:'state'})).pending,[]);
  assert.deepEqual(await local.run({action:'draft',roomId}),{draft:{text:'保留这段文本'}});
  local.close();store.close();store=new TeamStore(root);devices=new SharedDevices(store,now);local=reopen();
  assert.deepEqual(await local.run({action:'draft',roomId}),{draft:{text:'保留这段文本'}});

  unavailable=false;
  await assert.rejects(local.run({action:'message',roomId,expectedRoomRevision:1}),{code:'upstream_operation_unknown'});
  const pending=(await local.run({action:'state'})).pending[0];
  assert.match(pending.requestId,/^[a-f0-9-]{36}$/);
  assert.equal(pending.coordinatorGeneration,1);
  assert.equal(pending.scope,roomId);
  assert.equal(pending.digest,createHash('sha256').update(JSON.stringify({expectedRoomRevision:1,text:'保留这段文本'})).digest('hex'));
  assert.equal(pending.firstSentAt,time);
  assert.equal(attempts[0]!.body.requestId,pending.requestId);
  await assert.rejects(local.run({action:'save-draft',roomId,text:'编辑不了的旧请求'}),{code:'shared_draft_pending'});

  local.close();store.close();store=new TeamStore(root);devices=new SharedDevices(store,now);local=reopen();
  assert.equal((await local.run({action:'state'})).pending[0].requestId,pending.requestId);
  devices.rotateCoordinatorKey();
  await assert.rejects(local.run({action:'receipt',requestId:pending.requestId}),{code:'shared_device_unauthorized'});
  await local.run({action:'pair-local'},devices);
  assert.equal((await local.run({action:'state'})).connection.generation,2);
  await assert.rejects(local.run({action:'message',roomId,expectedRoomRevision:1}),{code:'shared_operation_pending_verification'});
  assert.equal(attempts.filter(attempt=>attempt.path.endsWith('/messages')).length,1);
  assert.deepEqual(attempts.at(-1)!.body,{operation:'message',requestId:pending.requestId});
  time+=sharedPendingMs-1;
  assert.equal((await local.run({action:'state'})).pending.length,1);
  time++;
  assert.deepEqual((await local.run({action:'state'})).pending,[]);
  await assert.rejects(local.run({action:'receipt',requestId:pending.requestId}),{code:'shared_pending_missing'});
  await assert.rejects(local.run({action:'message',roomId,expectedRoomRevision:1}),{code:'shared_draft_pending'});
  await local.run({action:'discard-expired-draft',roomId});
  assert.deepEqual(await local.run({action:'draft',roomId}),{draft:null});
 }finally{local.close();store.close();rmSync(root,{recursive:true,force:true});}
});

test('内存视图使用序号分页和追赶，过期、登出和撤销清除缓存',async()=>{
 const root=privateTempDir(join(tmpdir(),'kteam-shared-cache-'));
 const store=new TeamStore(root);
 let time=Date.now(),offline=false;
 const devices=new SharedDevices(store);
 const endpoint='https://192.168.8.2:8443',identity=devices.identity();
 devices.configureTrust({endpoint,coordinatorId:identity.coordinatorId,publicKey:identity.publicKey,
  certificateSha256:certificateDigest(new X509Certificate(createSharedTLS(endpoint).certificate))});
 const room={roomId:'room-fixture',title:'缓存探针',revision:1},members=[{status:'active',subject:{kind:'user'}}];
 const inputs:unknown[]=[];
 const makeMessage=(roomSequence:number)=>({roomSequence,createdAt:new Date(time).toISOString(),text:'消息 '+roomSequence});
 const local=new SharedDesktopClient(store,()=>time,async(_trust,method,path,raw,proof)=>{
  if(offline)throw new KTeamError('shared_coordinator_unreachable',503);
  devices.authenticate(JSON.parse(proof!),method,path,raw);
  if(path==='/shared/v1/rooms')return {rooms:[room]};
  const input=JSON.parse(raw);inputs.push(input);
  if(input.cursor)return {room,members,messages:[makeMessage(7)],earliestAvailableSequence:4,
   truncated:false,roomSequenceUpperBound:7,nextCursor:null};
  if(input.afterSequence===7)return {room,members,messages:[makeMessage(9)],earliestAvailableSequence:4,
   truncated:false,roomSequenceUpperBound:9,nextCursor:null};
  if(input.afterSequence===9)throw new KTeamError('shared_history_rebuild_required',409);
  return {room,members,messages:[makeMessage(4)],earliestAvailableSequence:4,truncated:true,roomSequenceUpperBound:7,nextCursor:'signed-window'};
 });
 const history=()=>local.run({action:'history',roomId:room.roomId});
 try{
  await local.run({action:'pair-local'},devices);
  const first=(await history()).history;
  assert.deepEqual(first.members,members);
  assert.equal(first.cachedAt,time);
  assert.equal(first.watermark,0);
  assert.equal(first.missingThrough,3);
  assert.equal((await history()).history.watermark,7);
  assert.equal((await history()).history.watermark,9);
  assert.deepEqual(inputs,[{afterSequence:0,limit:20},{cursor:'signed-window',limit:20},{afterSequence:7,limit:20}]);
  const rebuilt=(await history()).history;
  assert.deepEqual(rebuilt.messages.map((message:{roomSequence:number})=>message.roomSequence),[4]);
  assert.deepEqual(inputs.slice(-2),[{afterSequence:9,limit:20},{afterSequence:0,limit:20}]);
  await local.run({action:'rooms'});
  offline=true;time+=sharedCacheMs-1;
  assert.deepEqual(await history(),{offline:true,history:rebuilt});
  assert.equal((await local.run({action:'rooms'})).cachedAt,rebuilt.cachedAt);
  time++;
  assert.deepEqual(await history(),{offline:true,history:undefined});
  assert.deepEqual((await local.run({action:'rooms'})).rooms,[]);
  offline=false;
  assert.equal((await history()).history.messages.length,1);
  assert.deepEqual(inputs.at(-1),{afterSequence:0,limit:20});
  const deviceId=(await local.run({action:'state'})).connection.deviceId;
  devices.revoke(deviceId);
  await assert.rejects(history(),{code:'shared_device_unauthorized'});
  await assert.rejects(local.run({action:'rooms'}),{code:'shared_pairing_required'});
  await local.run({action:'pair-local'},devices);
  assert.equal((await history()).history.messages.length,1);
  await local.run({action:'logout'});
  assert.equal((await local.run({action:'state'})).connection,null);
  await assert.rejects(history(),{code:'shared_pairing_required'});
  await local.run({action:'pair-local'},devices);
  offline=true;
  assert.deepEqual(await history(),{offline:true,history:undefined});
 }finally{local.close();store.close();rmSync(root,{recursive:true,force:true});}
});

test('未配置权威密钥时，真实签名会话也不能开启共享聊天',async()=>{
 const root=privateTempDir(join(tmpdir(),'kteam-shared-disabled-'));
 const store=new TeamStore(root);
 try{
  const devices=new SharedDevices(store),identity=devices.identity();
  const endpoint='https://192.168.8.2:8443';
  devices.configureTrust({endpoint,coordinatorId:identity.coordinatorId,publicKey:identity.publicKey,certificateSha256:'0'.repeat(64)});
  const gateway=new SharedGateway(devices,new Upstreams({brokerUrl:'http://127.0.0.1:1',kswarmUrl:'http://127.0.0.1:1'}));
  const desktop=new SharedDesktopClient(store,Date.now,(_trust,method,path,body,proof)=>gateway.call(method,path,body,{
   'x-kteam-shared-api':'1','x-kteam-shared-schema':'1','x-kteam-shared-proof':proof
  }));
  await desktop.run({action:'pair-local'},devices);
  const status=await desktop.run({action:'status'});
  assert.equal(status.reason,'shared_room_authority_unavailable');
  assert.equal(status.chat,false);assert.equal(status.dispatch,false);assert.equal(status.execution,false);
  await assert.rejects(desktop.run({action:'create',title:'权限不足'}),{code:'shared_room_authority_unavailable'});
  desktop.close();
 }finally{store.close();rmSync(root,{recursive:true,force:true});}
});
