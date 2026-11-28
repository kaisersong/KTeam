import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir,networkInterfaces} from 'node:os';
import {createHash,generateKeyPairSync,randomBytes,randomUUID,sign,X509Certificate,type KeyObject} from 'node:crypto';
import https from 'node:https';
import {TeamStore} from '../src/service/team-store.js';
import {SharedDevices,sharedPairStatement,privateSharedEndpoint,sharedRequestStatement,verifySharedIdentity,type SharedCredential} from '../src/service/shared-devices.js';
import {SharedGateway} from '../src/service/shared-gateway.js';
import {Upstreams} from '../src/adapters/upstream.js';

test('真实私网 HTTPS：双客户端配对、共享 Room、撤销和协调端重启', {timeout:60_000},async()=>{
 const root=mkdtempSync(join(tmpdir(),'kteam-shared-https-'));
 let store:TeamStore|undefined,listener:Awaited<ReturnType<SharedGateway['listen']>>|undefined;
 let closeBroker:(()=>Promise<void>)|undefined;
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
  const brokerToken=randomBytes(32).toString('hex'),sharedRoomAuthorityKey=randomBytes(32).toString('hex');
  const {createBrokerService}=await import('intent-broker/src/broker/service.js' as string);
  const {createServer}=await import('intent-broker/src/http/server.js' as string);
  const startBroker=async()=>{
   const broker=createBrokerService({dbPath:join(root,'broker.sqlite'),aimpEnabled:true});
   const server=createServer({broker,roomService:broker.room,roomDesktopToken:brokerToken,sharedRoomAuthorityKey});
   try{await server.listen(0,'127.0.0.1');}catch(error){broker.close();throw error;}
   closeBroker=async()=>{server.raw().closeAllConnections();try{await server.close();}finally{broker.close();}};
   return new Upstreams({brokerUrl:'http://127.0.0.1:'+server.address().port,brokerToken,
    kswarmUrl:'http://127.0.0.1:1',sharedRoomAuthorityKey});
  };
  let adapter=await startBroker();
  listener=await new SharedGateway(devices,adapter).listen({certificate,privateKey});
  const request=(path:string,body?:unknown,method='POST',client?:{
   credential:SharedCredential;counter:number;key:KeyObject;
  },expectedStatus=200)=>new Promise<any>((resolve,reject)=>{
   const raw=body===undefined?'':JSON.stringify(body);
   const headers:Record<string,string>={'content-type':'application/json','x-kteam-shared-api':'1','x-kteam-shared-schema':'1'};
   if(client){
    const {credential,key}=client,counter=++client.counter;
    const signature=sign(null,Buffer.from(sharedRequestStatement(credential.token,counter,method,path,raw)),key).toString('base64url');
    headers['x-kteam-shared-proof']=JSON.stringify({credential,counter,signature});
   }
   const req=https.request(trust.endpoint,{path,method,ca:certificate,headers,timeout:10_000},res=>{
    const chunks:Buffer[]=[];res.on('data',c=>chunks.push(c));res.on('end',()=>{try{
     const result=JSON.parse(Buffer.concat(chunks).toString());
     assert.equal(res.statusCode,expectedStatus,path+' '+JSON.stringify(result));resolve(result);
    }catch(e){reject(e);}});
   });req.on('error',reject);req.on('timeout',()=>req.destroy(Error('shared_test_timeout')));req.end(raw);
  });
  verifySharedIdentity(trust,await request('/shared/v1/identity',{challenge:'fresh'}),'fresh');
  const clients=[];
  for(let n=0;n<2;n++){
   const k=generateKeyPairSync('ed25519'),publicKey=k.publicKey.export({format:'pem',type:'spki'}).toString(),invite=devices.invite();
   const input={inviteId:invite.inviteId,secret:invite.secret,coordinatorId:invite.coordinatorId,publicKey,signature:sign(null,Buffer.from(sharedPairStatement(invite.inviteId,invite.challenge,invite.coordinatorId,publicKey)),k.privateKey).toString('base64url')};
   assert.equal((await request('/shared/v1/pair',input)).paired,false);devices.approve(invite.inviteId,publicKey);
   const original=await request('/shared/v1/pair',input);
   await listener.close();listener=undefined;store.close();store=new TeamStore(root);devices=new SharedDevices(store);
   listener=await new SharedGateway(devices,adapter).listen({certificate,privateKey});
   assert.deepEqual(await request('/shared/v1/pair',input),original);
   clients.push({credential:original.credential as SharedCredential,counter:0,key:k.privateKey});
  }
  assert.equal(devices.view().devices.length,2);
  const [a,b]=clients;assert.ok(a&&b);
  const rooms='/shared/v1/rooms',receipt='/shared/v1/receipts';
  const status=await request('/shared/v1/status',undefined,'GET',a);
  assert.deepEqual(status.missing,[]);
  for(const flag of ['list','create','chat','members','receipts','history'])assert.equal(status[flag],true);
  assert.equal(status.dispatch,false);assert.equal(status.execution,false);
  assert.deepEqual((await request(rooms,undefined,'GET',b)).rooms,[]);

  const create={requestId:randomUUID(),title:'共享验证',memberAgentIds:[]};
  assert.equal((await request(rooms,{...create,requestSource:'agent'},'POST',a,400)).code,'unknown_field');
  const created=await request(rooms,create,'POST',a);
  const room=rooms+'/'+created.room.roomId;
  assert.equal(created.members[0].subject.userId,a.credential.principalId);
  assert.deepEqual(await request(receipt,{operation:'create',requestId:create.requestId},'POST',a),created);
  assert.deepEqual(await request(rooms,create,'POST',a),created);
  assert.deepEqual((await request(rooms,undefined,'GET',b)).rooms.map((entry:any)=>entry.roomId),[created.room.roomId]);
  assert.deepEqual((await adapter.listTeams()).rooms,[]);
  await assert.rejects(adapter.getTeam(created.room.roomId),{code:'room_not_found'});
  assert.equal((await request(rooms+'/../history',{},'POST',a,404)).code,'shared_route_not_found');

  const message={requestId:randomUUID(),expectedRoomRevision:created.room.revision,text:'第一条共享文本'};
  const sent=await request(room+'/messages',message,'POST',a);
  assert.deepEqual(sent.message.sender,{kind:'user',userId:a.credential.principalId});
  assert.equal(sent.message.responsePolicy,'none');
  assert.deepEqual(await request(room+'/messages',message,'POST',a),sent);
  assert.equal((await request(room+'/messages',{...message,text:'改正文'},'POST',a,409)).code,'shared_operation_conflict');
  const lookup={operation:'message',requestId:message.requestId};
  assert.equal((await request(room+'/receipts',lookup,'POST',b,409)).code,'shared_operation_pending_verification');
  const membership={requestId:randomUUID(),expectedRoomRevision:created.room.revision,addAgentIds:['logical-agent-fixture']};
  const updated=await request(room+'/members',membership,'POST',b);
  assert.equal(updated.room.revision,created.room.revision+1);
  assert.ok(updated.members.some((member:any)=>member.subject.logicalAgentId==='logical-agent-fixture'&&member.status==='active'));
  assert.deepEqual(await request(room+'/members',membership,'POST',b),updated);
  assert.equal((await request(room+'/members',{...membership,requestId:randomUUID()},'POST',b,409)).code,'room_revision_conflict');
  assert.deepEqual(await request(room+'/receipts',lookup,'POST',a),sent);
  assert.deepEqual(await request(room+'/messages',message,'POST',a),sent);
  const next=async(text:string)=>request(room+'/messages',{requestId:randomUUID(),expectedRoomRevision:updated.room.revision,text},'POST',b);
  const second=await next('第二条'),third=await next('第三条');
  const page1=await request(room+'/history',{limit:1},'POST',a);
  assert.equal(page1.room.revision,updated.room.revision);
  assert.deepEqual(page1.members,updated.members);
  assert.equal(page1.earliestAvailableSequence,sent.message.roomSequence);
  assert.equal(page1.truncated,false);
  assert.equal(page1.roomSequenceUpperBound,third.message.roomSequence);
  assert.deepEqual(page1.messages,[sent.message]);assert.ok(page1.nextCursor);
  const fourth=await next('快照之后');
  assert.equal((await request(room+'/history',{cursor:page1.nextCursor},'POST',b,409)).code,'shared_history_rebuild_required');

  await listener.close();listener=undefined;store.close();store=undefined;
  await closeBroker?.();closeBroker=undefined;
  store=new TeamStore(root);devices=new SharedDevices(store);adapter=await startBroker();
  listener=await new SharedGateway(devices,adapter).listen({certificate,privateKey});
  assert.deepEqual(await request(room+'/receipts',lookup,'POST',a),sent);
  const page2=await request(room+'/history',{cursor:page1.nextCursor,limit:1},'POST',a);
  assert.equal(page2.roomSequenceUpperBound,page1.roomSequenceUpperBound);
  assert.deepEqual(page2.messages,[second.message]);assert.ok(page2.nextCursor);
  const page3=await request(room+'/history',{cursor:page2.nextCursor,limit:1},'POST',a);
  assert.deepEqual(page3.messages,[third.message]);assert.equal(page3.nextCursor,null);
  assert.deepEqual((await request(room+'/history',{afterSequence:page3.roomSequenceUpperBound},'POST',a)).messages,[fourth.message]);

  devices.revoke(a.credential.deviceId);
  for(const [path,body,method] of [
   [rooms,undefined,'GET'],[room+'/history',{},'POST'],[room+'/messages',message,'POST'],
   [room+'/members',membership,'POST'],[room+'/receipts',lookup,'POST'],[receipt,{operation:'create',requestId:create.requestId},'POST'],
  ] as const){
   assert.deepEqual(await request(path,body,method,a,401),{ok:false,code:'shared_device_unauthorized'});
  }
  assert.equal((await request(room+'/history',{},'POST',b)).messages.length,4);
 }finally{await listener?.close();store?.close();await closeBroker?.();rmSync(root,{recursive:true,force:true});}
});
