import {createHash,createPrivateKey,createPublicKey,generateKeyPairSync,randomBytes,randomUUID,sign,verify,timingSafeEqual} from 'node:crypto';
import {isIP} from 'node:net';
import {KTeamError,fields,record,text} from '../errors.js';
import {TeamStore} from './team-store.js';

export const SHARED_API=1;
export const SHARED_SCHEMA=1;
const stateKey='shared-group-devices:v1';
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const secret=()=>randomBytes(32).toString('base64url');
const same=(a:string,b:string)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
export function sharedPublicKey(value:unknown){
 try{const key=createPublicKey(text(value,'device_public_key',2048));if(key.asymmetricKeyType!=='ed25519')throw Error();return key.export({type:'spki',format:'pem'}).toString();}
 catch{throw new KTeamError('shared_public_key_invalid');}
}
/** HTTPS with a literal RFC 1918, RFC 6598 shared IPv4, or IPv6 ULA address. */
export function privateSharedEndpoint(value:unknown){
 let url:URL;try{
  const input=text(value,'shared_endpoint').trim();
  if(!/^https:\/\/[^\s/@?#\\]+\/?$/i.test(input))throw Error();
  url=new URL(input);
 }catch{throw new KTeamError('shared_private_https_required');}
 const host=url.hostname.replace(/^\[|\]$/g,'');
 const parts=host.split('.').map(Number);
 const privateAddress=isIP(host)===4&&(parts[0]===10||parts[0]===192&&parts[1]===168||
  parts[0]===172&&parts[1]!>=16&&parts[1]!<=31||parts[0]===100&&parts[1]!>=64&&parts[1]!<=127)
  ||isIP(host)===6&&/^f[cd][0-9a-f]{2}:/i.test(host);
 if(url.protocol!=='https:'||!privateAddress||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new KTeamError('shared_private_https_required');
 return url.origin;
}
export type SharedTrust={endpoint:string;coordinatorId:string;publicKey:string;certificateSha256:string};
export function sharedTrust(value:unknown):SharedTrust{
 const input=record(value);fields(input,['endpoint','coordinatorId','publicKey','certificateSha256']);
 const publicKey=sharedPublicKey(input.publicKey),coordinatorId=text(input.coordinatorId,'coordinator_id');
 if(coordinatorId!==digest(publicKey)||typeof input.certificateSha256!=='string'||!/^([a-f0-9]{64})$/.test(input.certificateSha256))throw new KTeamError('shared_coordinator_identity_mismatch',403);
 return {endpoint:privateSharedEndpoint(input.endpoint),coordinatorId,publicKey,certificateSha256:input.certificateSha256};
}
type Device={deviceId:string;publicKey:string;generation:number;token:string;revoked:boolean;counter:number};
type Invite={id:string;secretHash:string;challenge:string;expiresAt:number;attempts:number;publicKey?:string;approved?:boolean;receipt?:SharedCredential};
type State={workspaceId:string;principalId:string;generation:number;publicKey:string;privateKey:string;devices:Device[];invites:Invite[];trust?:SharedTrust};
export type SharedCredential={workspaceId:string;principalId:string;deviceId:string;deviceGeneration:number;coordinatorGeneration:number;token:string;coordinatorId:string;publicKey:string;pairingId:string};
export type SharedSession=Omit<SharedCredential,'token'|'publicKey'|'pairingId'> & {requestSource:'user'};
export type SharedProof={credential:SharedCredential;counter:number;signature:string};
/** Domain-separated, exact request bytes. The server supplies identity; body cannot supply authority. */
export function sharedPairStatement(inviteId:string,challenge:string,coordinatorId:string,publicKey:string){return JSON.stringify(['kteam-shared-pair-v1',inviteId,challenge,coordinatorId,publicKey]);}
export function sharedRequestStatement(token:string,counter:number,method:string,path:string,body:string){return JSON.stringify(['kteam-shared-request-v1',digest(token),counter,method,path,digest(body),SHARED_API,SHARED_SCHEMA]);}
export function verifySharedIdentity(trustValue:unknown,response:unknown,challenge:string){
 const trust=sharedTrust(trustValue),r=record(response),identity=record(r.identity);
 if(r.challenge!==challenge||identity.coordinatorId!==trust.coordinatorId||identity.publicKey!==trust.publicKey||identity.api!==SHARED_API||identity.schema!==SHARED_SCHEMA)throw new KTeamError('shared_coordinator_identity_mismatch',403);
 proof(trust.publicKey,JSON.stringify(['kteam-shared-identity-v1',challenge,identity]),r.signature);
 return identity;
}
function proof(publicKey:string,statement:string,signature:unknown){
 try{if(typeof signature!=='string'||!verify(null,Buffer.from(statement),publicKey,Buffer.from(signature,'base64url')))throw Error();}
 catch{throw new KTeamError('shared_signature_invalid',401);}
}

/** Device grants only. Room membership, transcript and tasks remain with their existing owners. */
export class SharedDevices{
 constructor(private store:TeamStore,private now=Date.now){
  store.transaction(()=>{if(store.state(stateKey))return;const key=generateKeyPairSync('ed25519');store.setState(stateKey,{workspaceId:randomUUID(),principalId:randomUUID(),generation:1,publicKey:key.publicKey.export({type:'spki',format:'pem'}).toString(),privateKey:key.privateKey.export({type:'pkcs8',format:'pem'}).toString(),devices:[],invites:[]} satisfies State);});
 }
 private state(){return this.store.state<State>(stateKey)!;}
 private change<T>(fn:(state:State)=>T){return this.store.transaction(()=>{const state=this.state(),result=fn(state);this.store.setState(stateKey,state);return result;});}
 identity(){const s=this.state();return {workspaceId:s.workspaceId,principalId:s.principalId,coordinatorId:digest(s.publicKey),publicKey:s.publicKey,coordinatorGeneration:s.generation,api:SHARED_API,schema:SHARED_SCHEMA,capabilities:['pairing'],chat:false,members:false,dispatch:false,execution:false};}
 view(){const s=this.state();return {...this.identity(),trust:s.trust,devices:s.devices.map(({token,publicKey,counter,...d})=>({...d,publicKey})),requests:s.invites.filter(i=>!i.receipt&&i.expiresAt>this.now()).map(({id,publicKey,expiresAt,approved})=>({id,publicKey,expiresAt,approved}))};}
 /** Called only by the existing local, authenticated administrator entry. */
 configureTrust(value:unknown){const trust=sharedTrust(value);if(trust.coordinatorId!==this.identity().coordinatorId)throw new KTeamError('shared_single_coordinator_required',409);return this.change(s=>{if(s.trust&&JSON.stringify(s.trust)!==JSON.stringify(trust))throw new KTeamError('shared_identity_rotation_required',409);s.trust=trust;return trust;});}
 invite(){return this.change(s=>{if(!s.trust)throw new KTeamError('shared_trust_required',409);s.invites=s.invites.filter(i=>i.receipt||i.expiresAt>this.now());if(s.invites.filter(i=>!i.receipt).length>=3)throw new KTeamError('shared_invite_limit',429);const token=secret(),invite={id:randomUUID(),secretHash:digest(token),challenge:secret(),expiresAt:this.now()+120_000,attempts:0};s.invites.push(invite);return {inviteId:invite.id,secret:token,challenge:invite.challenge,expiresAt:invite.expiresAt,trust:s.trust,...this.identity()};});}
 pair(value:unknown){
  const i=record(value);fields(i,['inviteId','secret','publicKey','signature','coordinatorId']);
  const publicKey=sharedPublicKey(i.publicKey),id=text(i.inviteId,'invite_id'),token=text(i.secret,'invite_secret');
  // Failed guesses commit independently: throwing inside the transaction would roll back the limit.
  const result=this.change(s=>{
   const invite=s.invites.find(v=>v.id===id);
   if(!invite||invite.attempts>=5)return {error:'shared_invite_unavailable'};
   if(!same(invite.secretHash,digest(token))){invite.attempts++;return {error:'shared_invite_unavailable'};}
   if(i.coordinatorId!==digest(s.publicKey))return {error:'shared_coordinator_identity_mismatch'};
   try{proof(publicKey,sharedPairStatement(id,invite.challenge,digest(s.publicKey),publicKey),i.signature);}catch{invite.attempts++;return {error:'shared_signature_invalid'};}
   if(invite.publicKey&&invite.publicKey!==publicKey)return {error:'shared_pair_conflict'};
   if(invite.receipt){const d=s.devices.find(d=>d.deviceId===invite.receipt!.deviceId);if(!d||d.revoked||d.generation!==invite.receipt.deviceGeneration||s.generation!==invite.receipt.coordinatorGeneration)return {error:'shared_pair_retired'};return {value:{paired:true,credential:invite.receipt}};}
   if(invite.expiresAt<=this.now())return {error:'shared_invite_unavailable'};
   invite.publicKey=publicKey;
   if(!invite.approved)return {value:{paired:false}};
   const credential=this.issueDevice(s,publicKey,id);
   invite.receipt=credential;
   return {value:{paired:true,credential}};
  });
  if(result.error)throw new KTeamError(result.error,403);
  return result.value!;
 }
 approve(inviteId:string,confirmedPublicKey:string){return this.change(s=>{const i=s.invites.find(i=>i.id===inviteId);if(!i?.publicKey||i.expiresAt<=this.now()||i.receipt)throw new KTeamError('shared_invite_unavailable',409);if(i.publicKey!==sharedPublicKey(confirmedPublicKey))throw new KTeamError('shared_pair_conflict',409);i.approved=true;return {ok:true};});}
 authenticate(value:SharedProof,method:string,path:string,body:string):SharedSession{
  return this.change(s=>{
   const c=value?.credential;
   if(!c||typeof c!=='object'||typeof c.token!=='string')throw new KTeamError('shared_device_unauthorized',401);
   const d=s.devices.find(d=>d.deviceId===c.deviceId);
   if(!d||d.revoked||c.workspaceId!==s.workspaceId||c.principalId!==s.principalId||c.coordinatorId!==digest(s.publicKey)||c.deviceGeneration!==d.generation||c.coordinatorGeneration!==s.generation||!same(c.token,d.token))throw new KTeamError('shared_device_unauthorized',401);
   if(!Number.isSafeInteger(value.counter)||value.counter<=d.counter)throw new KTeamError('shared_request_replayed',409);
   proof(d.publicKey,sharedRequestStatement(c.token,value.counter,method,path,body),value.signature);
   d.counter=value.counter;
   return {workspaceId:s.workspaceId,principalId:s.principalId,deviceId:d.deviceId,deviceGeneration:d.generation,coordinatorGeneration:s.generation,coordinatorId:digest(s.publicKey),requestSource:'user'};
  });
 }
 assert(session:SharedSession){const s=this.state(),d=s.devices.find(d=>d.deviceId===session.deviceId);if(!d||d.revoked||session.workspaceId!==s.workspaceId||session.principalId!==s.principalId||session.deviceGeneration!==d.generation||session.coordinatorGeneration!==s.generation||session.coordinatorId!==digest(s.publicKey)||session.requestSource!=='user')throw new KTeamError('shared_device_unauthorized',401);}
 revoke(deviceId:string){return this.change(s=>{const d=s.devices.find(d=>d.deviceId===deviceId);if(!d)throw new KTeamError('shared_device_missing',404);if(!d.revoked){d.revoked=true;d.generation++;}return {ok:true};});}
 rotate(session:SharedSession){return this.change(s=>{this.assert(session);const d=s.devices.find(d=>d.deviceId===session.deviceId)!;d.generation++;d.counter=0;d.token=secret();return {workspaceId:s.workspaceId,principalId:s.principalId,deviceId:d.deviceId,deviceGeneration:d.generation,coordinatorGeneration:s.generation,token:d.token,coordinatorId:digest(s.publicKey),publicKey:s.publicKey,pairingId:'rotation'} satisfies SharedCredential;});}
 rotateCoordinatorKey(){return this.change(s=>{const key=generateKeyPairSync('ed25519');s.publicKey=key.publicKey.export({type:'spki',format:'pem'}).toString();s.privateKey=key.privateKey.export({type:'pkcs8',format:'pem'}).toString();s.generation++;s.invites=[];for(const device of s.devices)device.revoked=true;if(s.trust)s.trust={...s.trust,publicKey:s.publicKey,coordinatorId:digest(s.publicKey)};return {trust:s.trust,coordinatorGeneration:s.generation};});}
 private issueDevice(s:State,publicKey:string,pairingId:string):SharedCredential{
  const previous=s.devices.find(device=>device.publicKey===publicKey);
  const device:Device={deviceId:previous?.deviceId??randomUUID(),publicKey,generation:(previous?.generation??0)+1,
   token:secret(),revoked:false,counter:0};
  s.devices=s.devices.filter(entry=>entry.deviceId!==device.deviceId);
  s.devices.push(device);
  return {workspaceId:s.workspaceId,principalId:s.principalId,deviceId:device.deviceId,
   deviceGeneration:device.generation,coordinatorGeneration:s.generation,token:device.token,
   coordinatorId:digest(s.publicKey),publicKey:s.publicKey,pairingId};
 }
 /** The authenticated local administrator explicitly enrolls its own desktop. */
 enrollLocal(value:string){
  const publicKey=sharedPublicKey(value);
  return this.change(s=>{
   if(!s.trust)throw new KTeamError('shared_trust_required',409);
   return {trust:s.trust,credential:this.issueDevice(s,publicKey,'local')};
  });
 }
 /** Signed identity response is checked against an explicitly trusted key, never TOFU. */
 signIdentity(challenge:string){text(challenge,'challenge',256);const identity=this.identity();return {identity,challenge,signature:sign(null,Buffer.from(JSON.stringify(['kteam-shared-identity-v1',challenge,identity])),createPrivateKey(this.state().privateKey)).toString('base64url')};}
}
