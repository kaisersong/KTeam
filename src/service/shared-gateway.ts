import https from 'node:https';
import tls from 'node:tls';
import {X509Certificate,createHash} from 'node:crypto';
import {KTeamError,fields,record,text} from '../errors.js';
import {parseJson} from '../protocol/json.js';
import {Upstreams} from '../adapters/upstream.js';
import {SharedDevices,SHARED_API,SHARED_SCHEMA,type SharedProof} from './shared-devices.js';

/** Dedicated HTTPS surface. No desktop/mobile token or general-purpose upstream proxy is accepted. */
export class SharedGateway{
 constructor(private devices:SharedDevices,private upstream:Upstreams){}
 async call(method:string,path:string,rawBody:string,headers:Record<string,string|undefined>){
  if(headers['x-kteam-shared-api']!==String(SHARED_API)||headers['x-kteam-shared-schema']!==String(SHARED_SCHEMA))throw new KTeamError('shared_client_upgrade_required',409);
  if(method==='POST'&&path==='/shared/v1/identity'){
   const i=record(parseJson(rawBody));fields(i,['challenge']);return this.devices.signIdentity(text(i.challenge,'challenge'));
  }
  if(method==='POST'&&path==='/shared/v1/pair')return this.devices.pair(parseJson(rawBody));
  let proof:SharedProof;try{proof=record(parseJson(headers['x-kteam-shared-proof']??'')) as SharedProof;if(!proof.credential)throw Error();}catch{throw new KTeamError('shared_device_unauthorized',401);}
  const session=this.devices.authenticate(proof,method,path,rawBody);
  if(method==='POST'&&path==='/shared/v1/credential/rotate'){
   fields(record(parseJson(rawBody)),[]);return this.devices.rotate(session);
  }
  if(method==='GET'&&path==='/shared/v1/status'){
   const status=await this.upstream.sharedGroupsStatus();this.devices.assert(session);return {...status,requestSource:session.requestSource};
  }
  if(/^\/shared\/v1\/(rooms|receipts|subscriptions|bots)(\/|$)/.test(path)){
   // No fallback to sendHumanMessage, automatic-inputs, or the local roster.
   const status=await this.upstream.sharedGroupsStatus();this.devices.assert(session);
   throw new KTeamError(status.reason,503,status);
  }
  throw new KTeamError('shared_route_not_found',404);
 }
 async listen(options:{certificate:string;privateKey:string}){
  const trust=this.devices.view().trust;
  if(!trust)throw new KTeamError('shared_trust_required',409);
  const endpoint=new URL(trust.endpoint),host=endpoint.hostname.replace(/^\[|\]$/g,'');
  const certificate=new X509Certificate(options.certificate);
  if(createHash('sha256').update(certificate.raw).digest('hex')!==trust.certificateSha256||!certificate.checkIP(host)||Date.parse(certificate.validTo)<=Date.now()||Date.parse(certificate.validFrom)>Date.now())throw new KTeamError('shared_certificate_mismatch',403);
  const server=https.createServer({cert:options.certificate,key:options.privateKey,minVersion:'TLSv1.3'},async(req,res)=>{
   try{
    if(req.headers.origin)throw new KTeamError('shared_origin_forbidden',403);
    let size=0;const chunks:Buffer[]=[];
    for await(const chunk of req){size+=chunk.length;if(size>64*1024)throw new KTeamError('shared_request_too_large',413);chunks.push(chunk);}
    let raw:string;try{raw=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));}catch{throw new KTeamError('shared_invalid_utf8');}
    const headers:Record<string,string|undefined>={};for(const name of ['x-kteam-shared-api','x-kteam-shared-schema','x-kteam-shared-proof']){const value=req.headers[name];if(typeof value==='string')headers[name]=value;}
    const result=await this.call(req.method??'',req.url??'',raw,headers);
    res.writeHead(200,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(result));
   }catch(error){const known=error instanceof KTeamError;res.writeHead(known?error.status:500,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify({ok:false,code:known?error.code:'shared_internal_error'}));}
  });
  server.requestTimeout=15_000;server.headersTimeout=5_000;server.maxHeadersCount=16;
  const port=Number(endpoint.port)||443;
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
  // listening is not sufficient after a restart on the same address; wait until TLS actually accepts.
  await new Promise<void>((resolve,reject)=>{
   const attempt=(n:number)=>{
    const socket=tls.connect({host,port,ca:options.certificate,minVersion:'TLSv1.3',servername:undefined},()=>{socket.end();resolve();});
    socket.once('error',error=>{socket.destroy();if(n>=25)reject(error);else setTimeout(()=>attempt(n+1),10);});
   };
   attempt(0);
  });
  return {close:()=>new Promise<void>((resolve,reject)=>{server.closeAllConnections();server.close(error=>error?reject(error):resolve());})};
 }
}
