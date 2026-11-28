import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {TeamStore} from '../src/service/team-store.js';
import {SharedDevices,privateSharedEndpoint,sharedPairStatement,sharedRequestStatement,verifySharedIdentity,type SharedCredential} from '../src/service/shared-devices.js';
import {SharedGateway} from '../src/service/shared-gateway.js';
import {Upstreams} from '../src/adapters/upstream.js';

function key(){const k=generateKeyPairSync('ed25519');return {privateKey:k.privateKey,publicKey:k.publicKey.export({format:'pem',type:'spki'}).toString()};}
function fixture(){const root=mkdtempSync(join(tmpdir(),'kteam-shared-devices-'));let store=new TeamStore(root),devices=new SharedDevices(store);const identity=devices.identity();const trust={endpoint:'https://192.168.1.5:9443',publicKey:identity.publicKey,coordinatorId:identity.coordinatorId,certificateSha256:'a'.repeat(64)};devices.configureTrust(trust);return {root,trust,get store(){return store;},get devices(){return devices;},reopen(){store.close();store=new TeamStore(root);devices=new SharedDevices(store);},close(){store.close();rmSync(root,{recursive:true,force:true});}};}
function pairInput(invite:ReturnType<SharedDevices['invite']>,k:ReturnType<typeof key>){return {inviteId:invite.inviteId,secret:invite.secret,publicKey:k.publicKey,coordinatorId:invite.coordinatorId,signature:sign(null,Buffer.from(sharedPairStatement(invite.inviteId,invite.challenge,invite.coordinatorId,k.publicKey)),k.privateKey).toString('base64url')};}
function paired(f:ReturnType<typeof fixture>,k=key()){const invite=f.devices.invite(),input=pairInput(invite,k);assert.equal(f.devices.pair(input).paired,false);f.devices.approve(invite.inviteId,k.publicKey);return {k,invite,input,credential:f.devices.pair(input).credential!};}
function authenticate(devices:SharedDevices,c:SharedCredential,k:ReturnType<typeof key>,counter=1,body=''){
 const method='GET',path='/shared/v1/status',signature=sign(null,Buffer.from(sharedRequestStatement(c.token,counter,method,path,body)),k.privateKey).toString('base64url');
 return devices.authenticate({credential:c,counter,signature},method,path,body);
}

test('共享群信任仅接受私网 HTTPS 与完整协调端公钥',()=>{
 for(const input of ['http://192.168.1.2','https://example.com','https://127.0.0.1','https://192.168.1.2.evil.test','https://8.8.8.8','https://100.63.255.255','https://100.128.0.1','https://[2001:db8::1]','https://[::1]','https://[::ffff:192.168.1.2]','https://192.168.1.2/path','https://user@192.168.1.2','https://192.168.1.2/?x=1','https://100.64.0.1/?','https://100.64.0.1/path/..','https://@100.64.0.1'])assert.throws(()=>privateSharedEndpoint(input));
 for(const input of ['https://10.1.2.3','https://172.16.0.1','https://192.168.0.1','https://100.64.0.1','https://100.127.255.255','https://[fc12::1]','https://[fd12::1]'])assert.equal(privateSharedEndpoint(input),new URL(input).origin);
 const f=fixture();try{const response=f.devices.signIdentity('device-challenge');assert.equal(verifySharedIdentity(f.trust,response,'device-challenge').workspaceId,f.devices.identity().workspaceId);assert.throws(()=>verifySharedIdentity(f.trust,response,'replayed-challenge'));assert.throws(()=>verifySharedIdentity({...f.trust,publicKey:key().publicKey},response,'device-challenge'));assert.throws(()=>f.devices.configureTrust({...f.trust,endpoint:'https://10.0.0.2'}),/shared_identity_rotation_required/);}finally{f.close();}
});

test('配对消费、公钥、世代和回执原子持久化；丢响应重启仅返回原凭据',()=>{
 const f=fixture();try{
  const {k,invite,input,credential}=paired(f);
  f.reopen();assert.deepEqual(f.devices.pair(input).credential,credential);assert.equal(f.devices.view().devices.length,1);
  const attacker=key();assert.throws(()=>f.devices.pair(pairInput(invite,attacker)),/shared_pair_conflict/);
  assert.throws(()=>f.devices.pair({...input,publicKey:attacker.publicKey}),/shared_signature_invalid/);
  assert.equal(authenticate(f.devices,credential,k).principalId,credential.principalId);
  assert.throws(()=>authenticate(f.devices,credential,k),/shared_request_replayed/);
  f.reopen();assert.throws(()=>authenticate(f.devices,credential,k),/shared_request_replayed/);
 }finally{f.close();}
});

test('双客户端会话由认证生成；伪造主体、工作区、公钥、签名及正文均拒绝',()=>{
 const f=fixture();try{
  const a=paired(f),b=paired(f);assert.notEqual(a.credential.deviceId,b.credential.deviceId);assert.equal(a.credential.principalId,b.credential.principalId);
  for(const change of [{workspaceId:'other'},{principalId:'admin'},{deviceId:b.credential.deviceId},{deviceGeneration:999},{coordinatorGeneration:999},{token:'mobile-invite-token'}])assert.throws(()=>authenticate(f.devices,{...a.credential,...change},a.k),/shared_device_unauthorized/);
  assert.throws(()=>authenticate(f.devices,a.credential,b.k),/shared_signature_invalid/);
  const signature=sign(null,Buffer.from(sharedRequestStatement(a.credential.token,1,'GET','/shared/v1/status','original')),a.k.privateKey).toString('base64url');
  assert.throws(()=>f.devices.authenticate({credential:a.credential,counter:1,signature},'GET','/shared/v1/status','changed'),/shared_signature_invalid/);
  assert.equal(authenticate(f.devices,a.credential,a.k).requestSource,'user');assert.equal(authenticate(f.devices,b.credential,b.k).requestSource,'user');
 }finally{f.close();}
});

test('设备撤销与轮换在重启后持续拒绝旧读写、订阅、回执和旧配对结果',()=>{
 const f=fixture();try{
  const a=paired(f),b=paired(f),session=authenticate(f.devices,a.credential,a.k),rotated=f.devices.rotate(session);
  f.reopen();assert.throws(()=>authenticate(f.devices,a.credential,a.k,2),/shared_device_unauthorized/);assert.throws(()=>f.devices.pair(a.input),/shared_pair_retired/);
  assert.equal(authenticate(f.devices,rotated,a.k).deviceGeneration,2);
  const oldSession=authenticate(f.devices,b.credential,b.k);f.devices.revoke(b.credential.deviceId);f.reopen();assert.throws(()=>f.devices.assert(oldSession),/shared_device_unauthorized/);
  for(const [method,path] of [['GET','rooms'],['POST','rooms'],['GET','subscriptions'],['GET','receipts']]){
   const route='/shared/v1/'+path,signature=sign(null,Buffer.from(sharedRequestStatement(b.credential.token,2,method!,route,'')),b.k.privateKey).toString('base64url');
   assert.throws(()=>f.devices.authenticate({credential:b.credential,counter:2,signature},method!,route,''),/shared_device_unauthorized/);
  }
  f.devices.rotateCoordinatorKey();f.reopen();assert.throws(()=>authenticate(f.devices,rotated,a.k,2),/shared_device_unauthorized/);assert.equal(f.devices.identity().coordinatorGeneration,2);
 }finally{f.close();}
});

test('邀请尝试上限持久化、过期拒绝及事务失败不留下半个配对',()=>{
 const f=fixture();try{
  const invite=f.devices.invite(),k=key(),input=pairInput(invite,k);
  for(let n=0;n<5;n++)assert.throws(()=>f.devices.pair({...input,secret:'wrong'}),/shared_invite_unavailable/);
  f.reopen();assert.throws(()=>f.devices.pair(input),/shared_invite_unavailable/);
  const expired=new SharedDevices(f.store,()=>Date.now()+180_000);assert.throws(()=>expired.pair(pairInput(f.devices.invite(),k)),/shared_invite_unavailable/);
  const next=f.devices.invite(),nextInput=pairInput(next,k);f.devices.pair(nextInput);f.devices.approve(next.inviteId,k.publicKey);
  assert.throws(()=>f.store.transaction(()=>{assert.equal(f.devices.pair(nextInput).paired,true);throw Error('crash-before-commit');}),/crash-before-commit/);
  f.reopen();assert.equal(f.devices.view().devices.length,0);assert.equal(f.devices.pair(nextInput).paired,true);assert.equal(f.devices.view().devices.length,1);
 }finally{f.close();}
});

test('进程内双客户端经独立网关配对；版本握手和认证隔离移动端/本机凭据',async()=>{
 const f=fixture();try{
  // Pairing touches only the real SQLite grant service. No network request or substitute upstream is used.
  const gateway=new SharedGateway(f.devices,new Upstreams({brokerUrl:'http://127.0.0.1:1',kswarmUrl:'http://127.0.0.1:1'}));
  const headers={'x-kteam-shared-api':'1','x-kteam-shared-schema':'1'};
  const response=await gateway.call('POST','/shared/v1/identity',JSON.stringify({challenge:'challenge'}),headers);verifySharedIdentity(f.trust,response,'challenge');
  for(let n=0;n<2;n++){
   const k=key(),invite=f.devices.invite(),input=pairInput(invite,k),body=JSON.stringify(input);
   await assert.rejects(gateway.call('POST','/shared/v1/pair',body,{}),/shared_client_upgrade_required/);
   await assert.rejects(gateway.call('POST','/shared/v1/pair',JSON.stringify({...input,requestSource:'user'}),headers),/unknown_field/);
   assert.equal((await gateway.call('POST','/shared/v1/pair',body,headers) as any).paired,false);
   f.devices.approve(invite.inviteId,k.publicKey);
   const result=await gateway.call('POST','/shared/v1/pair',body,headers) as any;
   assert.equal(result.paired,true);assert.equal(result.credential.workspaceId,f.devices.identity().workspaceId);
   const c=result.credential as SharedCredential,path='/shared/v1/credential/rotate',raw='{}';
   const signature=sign(null,Buffer.from(sharedRequestStatement(c.token,1,'POST',path,raw)),k.privateKey).toString('base64url');
   const rotated=await gateway.call('POST',path,raw,{...headers,'x-kteam-shared-proof':JSON.stringify({credential:c,counter:1,signature})}) as SharedCredential;
   assert.equal(rotated.deviceGeneration,2);
   await assert.rejects(gateway.call('POST',path,raw,{...headers,'x-kteam-shared-proof':JSON.stringify({credential:c,counter:2,signature})}),/shared_device_unauthorized/);
  }
  assert.equal(f.devices.view().devices.length,2);
  await assert.rejects(gateway.call('GET','/shared/v1/rooms','',{...headers,authorization:'Bearer local-desktop-or-mobile-token'}),/shared_device_unauthorized/);
 }finally{f.close();}
});
