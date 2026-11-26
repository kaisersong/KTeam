import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir,networkInterfaces} from 'node:os';
import {createHash,generateKeyPairSync,sign,X509Certificate} from 'node:crypto';
import https from 'node:https';
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
  assert.ok(host,'真实私网 HTTPS 探针需要 RFC1918 网络接口');
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

test('真实 Broker 协议门禁：缺少共享主体/精确回执/历史快照时不能开放聊天', {timeout:30_000},async()=>{
 const f=await realUpstreams();try{
  const before=await f.upstream.listTeams(),status=await f.upstream.sharedGroupsStatus();
  assert.equal(status.available,false);assert.equal(status.chat,false);assert.equal(status.dispatch,false);assert.equal(status.execution,false);
  assert.ok(status.missing.includes('shared-session-authority-v1'));assert.ok(status.missing.includes('exact-operation-receipt-v1'));assert.ok(status.missing.includes('room-history-snapshot-v1'));
  assert.deepEqual(await f.upstream.listTeams(),before);
 }finally{await f.close();}
});
