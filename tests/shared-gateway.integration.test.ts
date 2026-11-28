import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir,networkInterfaces} from 'node:os';
import {createHash,generateKeyPairSync,randomUUID,sign,X509Certificate} from 'node:crypto';
import https from 'node:https';
import {createServer} from 'node:net';
import {certificateDigest,createSharedTLS} from '../src/service/shared-tls.js';
import {TeamStore} from '../src/service/team-store.js';
import {SharedDevices,sharedPairStatement,privateSharedEndpoint,verifySharedIdentity} from '../src/service/shared-devices.js';
import {SharedGateway} from '../src/service/shared-gateway.js';
import {Upstreams} from '../src/adapters/upstream.js';
import {realUpstreams} from './helpers/real-upstreams.js';

test('真实私网 HTTPS 配对：双客户端、证书与公钥信任、丢响应和协调端重启', {timeout:30_000},async()=>{
 const root=mkdtempSync(join(tmpdir(),'kteam-shared-https-'));
 let store:TeamStore|undefined,listener:Awaited<ReturnType<SharedGateway['listen']>>|undefined;
 try{
  const host=Object.values(networkInterfaces()).flat().find(i=>i?.family==='IPv4'&&!i.internal&&(()=>{try{privateSharedEndpoint('https://'+i.address);return true;}catch{return false;}})())?.address;
  assert.ok(host,'真实私网 HTTPS 探针需要 RFC 1918 或 RFC 6598 网络接口');
  // The certificate and its private key live only in this test's private directory.
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(root,'key.pem'),'-out',join(root,'cert.pem'),'-days','1','-subj','/CN=KTeam isolated test','-addext','subjectAltName=IP:'+host],{stdio:'ignore',timeout:10_000});
  const certificate=readFileSync(join(root,'cert.pem'),'utf8'),privateKey=readFileSync(join(root,'key.pem'),'utf8');
  store=new TeamStore(root);let devices=new SharedDevices(store);
  const identity=devices.identity();
  // A dedicated ephemeral port is selected by the OS; configure the trusted endpoint before accepting clients.
  const reservation=https.createServer({cert:certificate,key:privateKey});
  await new Promise<void>((resolve,reject)=>{reservation.once('error',reject);reservation.listen(0,host,resolve);});
  const address=reservation.address();assert.ok(address&&typeof address!=='string');
  await new Promise<void>((resolve,reject)=>reservation.close(e=>e?reject(e):resolve()));
  const trust={endpoint:'https://'+host+':'+address.port,coordinatorId:identity.coordinatorId,publicKey:identity.publicKey,certificateSha256:createHash('sha256').update(new X509Certificate(certificate).raw).digest('hex')};
  devices.configureTrust(trust);
  const adapter=new Upstreams({brokerUrl:'http://127.0.0.1:1',kswarmUrl:'http://127.0.0.1:1'});
  listener=await new SharedGateway(devices,adapter).listen({certificate,privateKey});
  const request=(path:string,body:unknown)=>new Promise<any>((resolve,reject)=>{
   const req=https.request(trust.endpoint+path,{method:'POST',ca:certificate,headers:{'content-type':'application/json','x-kteam-shared-api':'1','x-kteam-shared-schema':'1'},timeout:5_000},res=>{
    const chunks:Buffer[]=[];res.on('data',c=>chunks.push(c));res.on('end',()=>{try{assert.equal(res.statusCode,200);resolve(JSON.parse(Buffer.concat(chunks).toString()));}catch(e){reject(e);}});
   });req.on('error',reject);req.on('timeout',()=>req.destroy(Error('shared_test_timeout')));req.end(JSON.stringify(body));
  });
  verifySharedIdentity(trust,await request('/shared/v1/identity',{challenge:'fresh'}),'fresh');
  for(let n=0;n<2;n++){
   const k=generateKeyPairSync('ed25519'),publicKey=k.publicKey.export({format:'pem',type:'spki'}).toString(),invite=devices.invite();
   const input={inviteId:invite.inviteId,secret:invite.secret,coordinatorId:invite.coordinatorId,publicKey,signature:sign(null,Buffer.from(sharedPairStatement(invite.inviteId,invite.challenge,invite.coordinatorId,publicKey)),k.privateKey).toString('base64url')};
   assert.equal((await request('/shared/v1/pair',input)).paired,false);devices.approve(invite.inviteId,publicKey);
   const original=await request('/shared/v1/pair',input);
   await listener.close();listener=undefined;store.close();store=new TeamStore(root);devices=new SharedDevices(store);
   listener=await new SharedGateway(devices,adapter).listen({certificate,privateKey});
   assert.deepEqual(await request('/shared/v1/pair',input),original);
  }
  assert.equal(devices.view().devices.length,2);
 }finally{await listener?.close();store?.close();rmSync(root,{recursive:true,force:true});}
});

test('真实 Broker 协议门禁：没有配置独立共享签发密钥时不能开放聊天', {timeout:30_000},async()=>{
 const f=await realUpstreams();try{
  const before=await f.upstream.listTeams();
  const status=await f.upstream.sharedGroupsStatus({workspaceId:randomUUID(),principalId:randomUUID(),
   deviceId:randomUUID(),deviceGeneration:1,coordinatorGeneration:1,coordinatorId:randomUUID(),requestSource:'user'});
  assert.equal(status.reason,'shared_room_authority_unavailable');assert.equal(status.available,false);assert.equal(status.chat,false);assert.equal(status.dispatch,false);assert.equal(status.execution,false);
  assert.ok(status.missing.includes('shared-session-authority-v1'));assert.ok(status.missing.includes('exact-operation-receipt-v1'));assert.ok(status.missing.includes('room-history-snapshot-v1'));
  assert.deepEqual(await f.upstream.listTeams(),before);
 }finally{await f.close();}
});

test('IPv6 ULA 监听端口冲突可诊断，释放端口后通过真实 TLS 自探', {timeout:15_000},async t=>{
 let interfaces:ReturnType<typeof networkInterfaces>;
 try{interfaces=networkInterfaces();}
 catch(error){
  if((error as NodeJS.ErrnoException).code!=='ERR_SYSTEM_ERROR')throw error;
  return t.skip('当前环境无法枚举网络接口');
 }
 const ula=Object.values(interfaces).flat()
  .find(entry=>entry?.family==='IPv6'&&!entry.internal&&/^f[cd][0-9a-f]{2}:/i.test(entry.address))?.address;
 if(!ula)return t.skip('需要本机配置可绑定并可自连的 IPv6 ULA 接口');
 const root=mkdtempSync(join(tmpdir(),'kteam-shared-ula-'));
 const store=new TeamStore(root);
 const reservation=createServer();
 let listener:Awaited<ReturnType<SharedGateway['listen']>>|undefined;
 try{
  await new Promise<void>((resolve,reject)=>{
   reservation.once('error',reject);
   reservation.listen({port:0,host:ula,ipv6Only:true},resolve);
  });
  const address=reservation.address();
  assert.ok(address&&typeof address!=='string');
  const endpoint=privateSharedEndpoint(`https://[${ula}]:${address.port}`);
  const material=createSharedTLS(endpoint);
  const devices=new SharedDevices(store),identity=devices.identity();
  devices.configureTrust({endpoint,coordinatorId:identity.coordinatorId,publicKey:identity.publicKey,
   certificateSha256:certificateDigest(new X509Certificate(material.certificate))});
  const gateway=new SharedGateway(devices,new Upstreams({brokerUrl:'http://127.0.0.1:1',kswarmUrl:'http://127.0.0.1:1'}));
  await assert.rejects(gateway.listen(material),{code:'shared_listener_unavailable',details:'EADDRINUSE'});
  await new Promise<void>((resolve,reject)=>reservation.close(error=>error?reject(error):resolve()));
  listener=await gateway.listen(material);
 }finally{
  if(reservation.listening)await new Promise<void>(resolve=>reservation.close(()=>resolve()));
  try{await listener?.close();}finally{store.close();rmSync(root,{recursive:true,force:true});}
 }
});
