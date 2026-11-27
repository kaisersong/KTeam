import https from 'node:https';
import {X509Certificate} from 'node:crypto';
import {KTeamError,fields,record,text} from '../errors.js';
import {parseJson} from '../protocol/json.js';
import {Upstreams,type SharedRoomAction} from '../adapters/upstream.js';
import {SharedDevices,SHARED_API,SHARED_SCHEMA,type SharedProof,type SharedSession} from './shared-devices.js';

import {assertSharedCertificate,connectSharedTLS,sharedHost} from './shared-tls.js';

const roomCommands = {
 members: ['requestId','expectedRoomRevision','addAgentIds','removeAgentIds'],
 messages: ['requestId','expectedRoomRevision','text'],
 receipts: ['operation','requestId'],
 history: ['afterSequence','limit','cursor'],
};

/** Dedicated HTTPS surface. No desktop/mobile token or general-purpose upstream proxy is accepted. */
export class SharedGateway{
 constructor(private devices:SharedDevices,private upstream:Upstreams){}
 private mutationTail = Promise.resolve();
 serializeMutation<T>(work:()=>T|Promise<T>):Promise<T>{
  const result=this.mutationTail.then(work);
  this.mutationTail=result.then(()=>undefined,()=>undefined);
  return result;
 }
 async call(method:string,path:string,rawBody:string,headers:Record<string,string|undefined>,onSession?:(session:SharedSession)=>void){
  if(headers['x-kteam-shared-api']!==String(SHARED_API)||headers['x-kteam-shared-schema']!==String(SHARED_SCHEMA))throw new KTeamError('shared_client_upgrade_required',409);
  if(method==='POST'&&path==='/shared/v1/identity'){
   const i=record(parseJson(rawBody));fields(i,['challenge']);return this.devices.signIdentity(text(i.challenge,'challenge'));
  }
  if(method==='POST'&&path==='/shared/v1/pair')return this.devices.pair(parseJson(rawBody));
  let proof:SharedProof;try{proof=record(parseJson(headers['x-kteam-shared-proof']??'')) as SharedProof;if(!proof.credential)throw Error();}catch{throw new KTeamError('shared_device_unauthorized',401);}
  const session=this.devices.authenticate(proof,method,path,rawBody);
  const assertCurrent=()=>this.devices.assert(session);
  if(method==='POST'&&path==='/shared/v1/credential/rotate'){
   fields(record(parseJson(rawBody)),[]);return this.serializeMutation(()=>this.devices.rotate(session));
  }
  onSession?.(session);
  if(method==='GET'&&path==='/shared/v1/status'){
   const status=await this.upstream.sharedGroupsStatus(session);assertCurrent();return {...status,requestSource:session.requestSource};
  }

  const roomRoute=/^\/shared\/v1\/rooms\/([a-zA-Z0-9_.:-]{1,256})\/(members|messages|receipts|history)$/.exec(path);
  let action:SharedRoomAction|undefined,roomId:string|undefined,input:Record<string,unknown>|undefined;
  if(path==='/shared/v1/rooms'&&method==='GET'){
   if(rawBody)throw new KTeamError('shared_unexpected_body');
   action='list';
  }else if(method==='POST'){
   if(path==='/shared/v1/rooms'){
    action='create';input=record(parseJson(rawBody));fields(input,['requestId','title','description','memberAgentIds']);
   }else if(path==='/shared/v1/receipts'){
    action='receipt';input=record(parseJson(rawBody));fields(input,roomCommands.receipts);
    if(input.operation!=='create')throw new KTeamError('room_input_invalid');
   }else if(roomRoute){
    roomId=roomRoute[1];
    if(roomId==='.'||roomId==='..')throw new KTeamError('shared_route_not_found',404);
    const command=roomRoute[2] as keyof typeof roomCommands;
    input=record(parseJson(rawBody));fields(input,roomCommands[command]);
    action=command==='messages'?'message':command==='receipts'?'receipt':command;
    if(action==='receipt'&&input.operation!=='message'&&input.operation!=='members')throw new KTeamError('room_input_invalid');
   }
  }
  if(action){
   const selected=action;
   const run=()=>{
    assertCurrent();
    return this.upstream.sharedRoom(session,assertCurrent,selected,roomId,input);
   };
   const result=await (action==='create'||action==='members'||action==='message'?this.serializeMutation(run):run());
   assertCurrent();
   return result;
  }
  throw new KTeamError('shared_route_not_found',404);
 }
 async listen(options:{certificate:string;privateKey:string}){
  const trust=this.devices.view().trust;
  if(!trust)throw new KTeamError('shared_trust_required',409);
  const endpoint=new URL(trust.endpoint),host=sharedHost(trust.endpoint);
  const certificate=new X509Certificate(options.certificate);
  assertSharedCertificate(certificate,trust);
  const server=https.createServer({cert:options.certificate,key:options.privateKey,minVersion:'TLSv1.3'},async(req,res)=>{
   try{
    if(req.headers.origin)throw new KTeamError('shared_origin_forbidden',403);
    let size=0;const chunks:Buffer[]=[];
    for await(const chunk of req){size+=chunk.length;if(size>64*1024)throw new KTeamError('shared_request_too_large',413);chunks.push(chunk);}
    let raw:string;try{raw=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));}catch{throw new KTeamError('shared_invalid_utf8');}
    const headers:Record<string,string|undefined>={};for(const name of ['x-kteam-shared-api','x-kteam-shared-schema','x-kteam-shared-proof']){const value=req.headers[name];if(typeof value==='string')headers[name]=value;}
    let session:SharedSession|undefined;
    const result=await this.call(req.method??'',req.url??'',raw,headers,authenticated=>{session=authenticated;});
    if(session)this.devices.assert(session);
    res.writeHead(200,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(result));
   }catch(error){const known=error instanceof KTeamError;res.writeHead(known?error.status:500,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({ok:false,code:known?error.code:'shared_internal_error'}));}
  });
  server.requestTimeout=15_000;server.headersTimeout=5_000;server.maxHeadersCount=16;
  const port=Number(endpoint.port)||443;
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
  try{
   await new Promise<void>((resolve,reject)=>connectSharedTLS(trust,(error,socket)=>{
    if(error)reject(error);else{socket!.end();resolve();}
   }));
  }catch(error){server.closeAllConnections();server.close();throw error;}
  return {close:()=>new Promise<void>((resolve,reject)=>{server.closeAllConnections();server.close(error=>error?reject(error):resolve());})};
 }
}
