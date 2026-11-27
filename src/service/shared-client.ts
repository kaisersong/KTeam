import https from 'node:https';
import {createHash,createPublicKey,generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {KTeamError,fields,record,text} from '../errors.js';
import {parseDataJson} from '../protocol/json.js';
import {SHARED_API,SHARED_SCHEMA,sharedPairStatement,sharedRequestStatement,sharedTrust,verifySharedIdentity,
 type SharedCredential,type SharedDevices,type SharedTrust} from './shared-devices.js';
import {connectSharedTLS} from './shared-tls.js';
import type {TeamStore} from './team-store.js';
import {sharedCacheMs} from '../protocol/shared-desktop.js';

const roomsPath='/shared/v1/rooms';
const historyPageSize=20;
const historyWindowBytes=4*1024*1024;
const stateKey='shared-desktop-connection:v1';
export const sharedPendingMs=7*86400_000;
type Operation='create'|'message'|'members';
type KeyPair={publicKey:string;privateKey:string};
type Invite={inviteId:string;secret:string;challenge:string};
type Connection={trust:SharedTrust;credential:SharedCredential;privateKey:string;counter:number};
type Pairing={trust:SharedTrust;invite:Invite;key:KeyPair};
type Pending={requestId:string;operation:Operation;roomId?:string;scope:string;digest:string;firstSentAt:number;coordinatorGeneration:number};
type Draft={text:string;requestId?:string};
type History={
 room:{roomId:string;title:string;revision:number};
 members:{status:string;subject:{kind:string;logicalAgentId?:string}}[];
 messages:{roomSequence:number;createdAt:string;text:string}[];
 earliestAvailableSequence:number|null;truncated:boolean;
 roomSequenceUpperBound:number;nextCursor:string|null;
};
type Cached=History&{cachedAt:number;watermark:number;missingThrough:number;localWindowStart?:number};

const hash=(input:unknown)=>createHash('sha256').update(JSON.stringify(input)).digest('hex');
const signingKeys=():KeyPair=>{
 const key=generateKeyPairSync('ed25519');
 return {publicKey:key.publicKey.export({type:'spki',format:'pem'}).toString(),privateKey:key.privateKey.export({type:'pkcs8',format:'pem'}).toString()};
};
const signature=(statement:string,key:string)=>sign(null,Buffer.from(statement),key).toString('base64url');
const id=(value:unknown)=>{
 if(typeof value!=='string'||!/^[a-zA-Z0-9_.:-]{1,256}$/.test(value)||value==='.'||value==='..')throw new KTeamError('shared_id_invalid');
 return value;
};
function agentIds(value:unknown){
 if(value===undefined)return [];
 if(!Array.isArray(value)||value.length>100)throw new KTeamError('shared_agent_ids_invalid');
 return [...new Set(value.map(id))].sort();
}

function pinnedRequest(trust:SharedTrust,method:string,path:string,body:string,proof?:string):Promise<any>{
 return new Promise((resolve,reject)=>{
  const agent=new https.Agent({maxCachedSessions:0});
  // No HTTP request bytes (including proof and invitation) are queued on an unverified socket.
  agent.createConnection=(_options,callback)=>{
   connectSharedTLS(trust,(error,socket)=>callback!(error,socket!));
   return undefined;
  };
  const cancel=AbortSignal.timeout(12_000);
  const req=https.request(trust.endpoint,{method,path,agent,signal:cancel,headers:{
   'content-type':'application/json','x-kteam-shared-api':SHARED_API,'x-kteam-shared-schema':SHARED_SCHEMA,
   ...(proof?{'x-kteam-shared-proof':proof}:{})
  }},async res=>{
   try{
    const chunks:Buffer[]=[];
    let bytes=0;
    for await(const chunk of res){
     bytes+=chunk.length;
     if(bytes>4*1024*1024)throw new KTeamError('shared_response_too_large',502);
     chunks.push(chunk);
    }
    const value=record(parseDataJson(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)),4*1024*1024));
    if(res.statusCode!==200||value.ok===false)throw new KTeamError(typeof value.code==='string'?value.code:'shared_response_invalid',res.statusCode??502);
    resolve(value);
   }catch(error){reject(error);}
   finally{agent.destroy();}
  });
  req.on('error',error=>{
   agent.destroy();
   reject(error instanceof KTeamError?error:new KTeamError('shared_coordinator_unreachable',503));
  });
  req.end(body||undefined);
 });
}

/** Local desktop state. Only drafts, pending operation metadata and device credentials are persisted. */
export class SharedDesktopClient{
 private tail=Promise.resolve();
 private authorizationEpoch=0;
 private history=new Map<string,Cached>();
 private roomList?:{rooms:unknown[];cachedAt:number};
 private expiration?:ReturnType<typeof setTimeout>;
 constructor(private store:TeamStore,private now=Date.now,private request:typeof pinnedRequest=pinnedRequest){}
 private connection(){return this.store.state<Connection>(stateKey);}
 private requireConnection(){
  const connection=this.connection();
  if(!connection)throw new KTeamError('shared_pairing_required',409);
  return connection;
 }
 private scope(connection=this.requireConnection()){
  const {workspaceId,principalId}=connection.credential;
  return 'shared-desktop:'+hash([workspaceId,principalId])+':';
 }
 private draftKey(roomId:string){return this.scope()+'draft:'+roomId;}
 private pendingKey(connection=this.requireConnection()){return this.scope(connection)+'pending';}
 private pending(connection=this.requireConnection()){
  const key=this.pendingKey(connection),previous=this.store.state<Pending[]>(key)??[];
  const current=previous.filter(item=>this.now()-item.firstSentAt<sharedPendingMs);
  if(current.length!==previous.length)this.store.setState(key,current);
  return current;
 }
 prune(){
  for(const entry of this.store.stateEntries('shared-desktop:')){
   if(!entry.key.endsWith(':pending')||!Array.isArray(entry.value))continue;
   const current=(entry.value as Pending[]).filter(item=>this.now()-item.firstSentAt<sharedPendingMs);
   if(current.length!==entry.value.length)this.store.setState(entry.key,current);
  }
 }
 clearHistory(){
  clearTimeout(this.expiration);
  this.history.clear();
  this.roomList=undefined;
 }
 private expire(){
  const cutoff=this.now()-sharedCacheMs;
  for(const [room,snapshot] of this.history)if(snapshot.cachedAt<=cutoff)this.history.delete(room);
  if(this.roomList&&this.roomList.cachedAt<=cutoff)this.roomList=undefined;
  clearTimeout(this.expiration);
  const times=[...this.history.values()].map(value=>value.cachedAt);
  if(this.roomList)times.push(this.roomList.cachedAt);
  if(times.length)this.expiration=setTimeout(()=>this.expire(),Math.max(1,Math.min(...times)+sharedCacheMs-this.now())).unref();
 }
 private install(trust:SharedTrust,credential:SharedCredential,key:KeyPair){
  this.clearHistory();
  this.store.setState(stateKey,{trust,credential,privateKey:key.privateKey,counter:0} satisfies Connection);
 }
 invalidateLocal(trust:SharedTrust|undefined,deviceId?:string){
  const active=this.connection();
  if(active&&trust&&active.trust.endpoint===trust.endpoint&&active.trust.certificateSha256===trust.certificateSha256&&
     (!deviceId||active.credential.deviceId===deviceId)){
   this.authorizationEpoch++;
   this.clearHistory();
   this.store.setState(stateKey,null);
  }
 }
 close(){this.clearHistory();}
 run(value:unknown,local?:SharedDevices){
  const input=record(value);
  if(['state','save-draft','draft'].includes(String(input.action)))return this.command(input,local);
  const result=this.tail.then(()=>this.command(input,local));
  this.tail=result.then(()=>undefined,()=>undefined);
  return result;
 }
 private async command(input:Record<string,unknown>,local?:SharedDevices){
  this.expire();
  const {action}=input;
  const allowed={
   state:[],logout:[],'pair-local':[],pair:['trust','invite'],'pair-check':[],status:[],rooms:[],
   receipt:['requestId'],create:['title','memberAgentIds'],history:['roomId'],draft:['roomId'],
   'save-draft':['roomId','text'],'discard-expired-draft':['roomId'],
   members:['roomId','expectedRoomRevision','addAgentIds','removeAgentIds'],
   message:['roomId','expectedRoomRevision']
  };
  if(typeof action!=='string'||!Object.hasOwn(allowed,action))throw new KTeamError('shared_client_action_invalid',404);
  fields(input,['action',...allowed[action as keyof typeof allowed]]);
  if(action==='state'){
   const active=this.connection();
   const pairing=this.store.state<Pairing>(stateKey+':pair');
   const draftPrefix=active?this.scope(active)+'draft:':undefined;
   const draftRooms=draftPrefix?this.store.stateEntries(draftPrefix)
    .filter(entry=>(entry.value as Draft|null)?.text).map(entry=>entry.key.slice(draftPrefix.length)):[];
   return {connection:active?{trust:active.trust,deviceId:active.credential.deviceId,generation:active.credential.coordinatorGeneration}:null,
    pairing:pairing?{publicKey:pairing.key.publicKey}:null,pending:active?this.pending(active):[],draftRooms};
  }
  if(action==='logout'){
   this.clearHistory();
   this.store.transaction(()=>{this.store.setState(stateKey,null);this.store.setState(stateKey+':pair',null);});
   return {ok:true};
  }
  if(action==='pair-local'){
   if(!local)throw new KTeamError('shared_admin_forbidden',403);
   const active=this.connection();
   const trustNow=local.view().trust;
   if(active&&trustNow&&active.credential.pairingId==='local'&&hash(active.trust)===hash(trustNow))return {paired:true};
   this.store.transaction(()=>{
    const key=signingKeys();
    const {trust,credential}=local.enrollLocal(key.publicKey);
    this.install(trust,credential,key);
   });
   return {paired:true};
  }
  if(action==='pair'||action==='pair-check')return this.pair(input);
  if(action==='status')return this.authorized('GET','/shared/v1/status');
  if(action==='rooms')return this.list();
  if(action==='receipt')return this.receipt(id(input.requestId));
  if(action==='create')return this.submit('create',undefined,input);
  const roomId=id(input.roomId);
  switch(action){
   case 'history':return this.readHistory(roomId);
   case 'draft':return {draft:this.store.state<Draft>(this.draftKey(roomId))};
   case 'save-draft':{
    if(typeof input.text!=='string'||Buffer.byteLength(input.text)>32*1024)throw new KTeamError('shared_draft_invalid');
    const key=this.draftKey(roomId);
    const previous=this.store.state<Draft>(key);
    if(previous?.requestId)throw new KTeamError('shared_draft_pending',409);
    this.store.setState(key,{text:input.text});
    return {ok:true};
   }
   case 'discard-expired-draft':{
    const key=this.draftKey(roomId),draft=this.store.state<Draft>(key);
    if(!draft?.requestId||this.pending().some(item=>item.requestId===draft.requestId))throw new KTeamError('shared_draft_pending',409);
    this.store.setState(key,null);
    return {ok:true};
   }
   case 'members':return this.submit('members',roomId,input);
   case 'message':return this.submit('message',roomId,input);
   default:throw new KTeamError('shared_client_action_invalid');
  }
 }
 private async pair(input:Record<string,unknown>){
  const pairingKey=stateKey+':pair';
  let pairing=this.store.state<Pairing>(pairingKey);
  if(input.action==='pair'){
   const trust=sharedTrust(input.trust),invite=record(input.invite);
   fields(invite,['inviteId','secret','challenge']);
   const material={inviteId:id(invite.inviteId),secret:text(invite.secret,'invite_secret'),challenge:text(invite.challenge,'invite_challenge')};
   if(!pairing||hash([trust,material])!==hash([pairing.trust,pairing.invite])){
    const active=this.connection();
    const sameInvite=active?.credential.pairingId===material.inviteId&&hash(active.trust)===hash(trust);
    const key=sameInvite?{privateKey:active.privateKey,publicKey:createPublicKey(active.privateKey).export({type:'spki',format:'pem'}).toString()}:signingKeys();
    pairing={trust,invite:material,key};
    this.store.setState(pairingKey,pairing);
   }
  }
  if(!pairing)throw new KTeamError('shared_invite_unavailable',403);
  const {trust,key,invite}=pairing;
  const challenge=randomUUID();
  const identity=verifySharedIdentity(trust,await this.request(trust,'POST','/shared/v1/identity',JSON.stringify({challenge})),challenge);
  const result=await this.request(trust,'POST','/shared/v1/pair',JSON.stringify({
   inviteId:invite.inviteId,secret:invite.secret,coordinatorId:trust.coordinatorId,publicKey:key.publicKey,
   signature:signature(sharedPairStatement(invite.inviteId,invite.challenge,trust.coordinatorId,key.publicKey),key.privateKey)
  }));
  if(result.paired===true){
   const credential=record(result.credential) as SharedCredential;
   if(credential.coordinatorId!==trust.coordinatorId||credential.publicKey!==trust.publicKey||
      credential.workspaceId!==identity.workspaceId||credential.principalId!==identity.principalId||
      credential.coordinatorGeneration!==identity.coordinatorGeneration||credential.pairingId!==invite.inviteId||
      typeof credential.token!=='string'||credential.token.length<32||typeof credential.deviceId!=='string'||
      !Number.isSafeInteger(credential.deviceGeneration)||credential.deviceGeneration<1)
    throw new KTeamError('shared_coordinator_identity_mismatch',403);
   this.store.transaction(()=>{
    if(this.connection()?.credential.token!==credential.token)this.install(trust,credential,key);
    this.store.setState(pairingKey,null);
   });
  }
  return {paired:result.paired===true,publicKey:key.publicKey};
 }
 private async authorized(method:string,path:string,input?:unknown){
  const connection=this.requireConnection();
  const body=input===undefined?'':JSON.stringify(input);
  const {credential,privateKey}=connection;
  const counter=connection.counter+1;
  if(!Number.isSafeInteger(counter))throw new KTeamError('shared_request_counter_exhausted',409);
  connection.counter=counter;
  this.store.setState(stateKey,connection);
  const proof=JSON.stringify({credential,counter,signature:signature(sharedRequestStatement(credential.token,counter,method,path,body),privateKey)});
  const epoch=this.authorizationEpoch;
  try{
   const result=await this.request(connection.trust,method,path,body,proof);
   if(epoch!==this.authorizationEpoch)throw new KTeamError('shared_device_unauthorized',401);
   return result;
  }
  catch(error){
   if(error instanceof KTeamError&&['shared_device_unauthorized','shared_certificate_mismatch'].includes(error.code)){
    this.clearHistory();
    if(error.code==='shared_device_unauthorized')this.store.setState(stateKey,null);
   }
   throw error;
  }
 }
 private offline(error:unknown){
  return error instanceof KTeamError&&['shared_coordinator_unreachable','broker_unavailable'].includes(error.code);
 }
 private async list(){
  try{
   const result=await this.authorized('GET',roomsPath);
   const allowed=new Set(result.rooms.map((room:{roomId:string})=>room.roomId));
   for(const roomId of this.history.keys())if(!allowed.has(roomId))this.history.delete(roomId);
   this.roomList={rooms:result.rooms,cachedAt:this.now()};
   this.expire();
   return {...this.roomList,offline:false};
  }catch(error){
   if(!this.offline(error))throw error;
   this.expire();
   return {rooms:this.roomList?.rooms??[],cachedAt:this.roomList?.cachedAt,offline:true};
  }
 }
 private async readHistory(roomId:string,rebuilding=false):Promise<{history?:Cached;offline:boolean}>{
  const cached=this.history.get(roomId);
  const path=roomsPath+'/'+roomId+'/history';
  const after=cached?.watermark??0;
  try{
   const page:History=await this.authorized('POST',path,cached?.nextCursor?{cursor:cached.nextCursor,limit:historyPageSize}:{afterSequence:after,limit:historyPageSize});
   if(cached&&!this.history.has(roomId)&&!rebuilding)return this.readHistory(roomId,true);
   const earliest=page.earliestAvailableSequence??page.roomSequenceUpperBound+1;
   const missingThrough=Math.max(cached?.missingThrough??0,earliest-1);
   const messages=new Map((cached?.messages??[]).filter(message=>message.roomSequence>missingThrough).map(message=>[message.roomSequence,message]));
   for(const message of page.messages)messages.set(message.roomSequence,message);
   const ordered=[...messages.values()].sort((a,b)=>a.roomSequence-b.roomSequence);
   let size=0,index=ordered.length;
   while(index>0){
    size+=Buffer.byteLength(JSON.stringify(ordered[index-1]));
    if(size>historyWindowBytes)break;
    index--;
   }
   const history={...page,messages:ordered.slice(index),cachedAt:this.now(),missingThrough,
    localWindowStart:index>0||cached?.localWindowStart?ordered[index]?.roomSequence:undefined,
    watermark:page.nextCursor?after:page.roomSequenceUpperBound};
   this.history.set(roomId,history);
   this.expire();
   return {history,offline:false};
  }catch(error){
   const code=(error as KTeamError).code;
   if(code==='shared_history_rebuild_required'&&!rebuilding){
    this.history.delete(roomId);
    return this.readHistory(roomId,true);
   }
   if(!this.offline(error)){
    this.history.delete(roomId);
    throw error;
   }
   this.expire();
   return {history:this.history.get(roomId),offline:true};
  }
 }
 private complete(item:Pending){
  this.store.transaction(()=>{
   this.store.setState(this.pendingKey(),this.pending().filter(value=>value.requestId!==item.requestId));
   if(item.operation==='message'&&item.roomId){
    const key=this.draftKey(item.roomId);
    if(this.store.state<Draft>(key)?.requestId===item.requestId)this.store.setState(key,null);
   }
  });
 }
 private async receipt(requestId:string){
  const item=this.pending().find(value=>value.requestId===requestId);
  if(!item)throw new KTeamError('shared_pending_missing',404);
  const path=item.roomId?roomsPath+'/'+item.roomId+'/receipts':'/shared/v1/receipts';
  await this.authorized('POST',path,{operation:item.operation,requestId});
  this.complete(item);
  return {confirmed:true};
 }
 private async submit(operation:Operation,roomId:string|undefined,input:Record<string,unknown>){
  const connection=this.requireConnection();
  const old=this.pending(connection).find(item=>item.operation===operation&&item.roomId===roomId);
  if(old)return this.receipt(old.requestId);
  const revision=input.expectedRoomRevision;
  if(operation!=='create'&&(!Number.isSafeInteger(revision)||Number(revision)<1))throw new KTeamError('shared_room_revision_required');
  let normalized:Record<string,unknown>;
  if(operation==='create')normalized={title:text(input.title,'title').trim(),description:'',memberAgentIds:agentIds(input.memberAgentIds)};
  else if(operation==='members')normalized={expectedRoomRevision:revision,addAgentIds:agentIds(input.addAgentIds),removeAgentIds:agentIds(input.removeAgentIds)};
  else{
   const draft=this.store.state<Draft>(this.draftKey(roomId!));
   if(draft?.requestId)throw new KTeamError('shared_draft_pending',409);
   normalized={expectedRoomRevision:revision,text:text(draft?.text,'message',32*1024)};
  }
  // A failed preflight has sent no write. Keep the editable draft.
  const status=await this.authorized('GET','/shared/v1/status');
  const enabled=operation==='message'?status.chat:status[operation];
  if(!enabled)throw new KTeamError(status.reason??'shared_group_protocol_unavailable',503);
  if(operation==='message'&&this.store.state<Draft>(this.draftKey(roomId!))?.text!==normalized.text)
   throw new KTeamError('shared_draft_changed',409);
  const item:Pending={requestId:randomUUID(),operation,roomId,scope:roomId??connection.credential.workspaceId,
   digest:hash(normalized),firstSentAt:this.now(),coordinatorGeneration:connection.credential.coordinatorGeneration};
  this.store.transaction(()=>{
   this.store.setState(this.pendingKey(),[...this.pending(),item]);
   if(operation==='message')this.store.setState(this.draftKey(roomId!),{text:normalized.text,requestId:item.requestId});
  });
  const path=roomId?roomsPath+'/'+roomId+'/'+(operation==='message'?'messages':'members'):roomsPath;
  try{await this.authorized('POST',path,{...normalized,requestId:item.requestId});}
  catch(error){
   // Only explicit pre-mutation rejections unlock a draft. Ambiguous writes stay query-only.
   if(['room_input_invalid','room_revision_conflict','room_member_limit_exceeded','room_archived','room_actor_forbidden',
    'room_membership_required','room_not_found'].includes((error as KTeamError).code)){
    this.store.transaction(()=>{
     this.store.setState(this.pendingKey(),this.pending().filter(value=>value.requestId!==item.requestId));
     if(operation==='message')this.store.setState(this.draftKey(roomId!),{text:normalized.text});
    });
   }
   throw error;
  }
  this.complete(item);
  return {confirmed:true};
 }
}
