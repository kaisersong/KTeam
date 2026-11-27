import {connect,type TLSSocket} from 'node:tls';
import {createHash, generateKeyPairSync, randomBytes, sign, X509Certificate} from 'node:crypto';
import {isIP} from 'node:net';
import {KTeamError} from '../errors.js';
import {privateSharedEndpoint, type SharedTrust} from './shared-devices.js';

export type SharedTLS = {certificate:string;privateKey:string};
export const sharedHost=(endpoint:string)=>new URL(endpoint).hostname.replace(/^\[|\]$/g,'');
export const certificateDigest=(certificate:X509Certificate)=>createHash('sha256').update(certificate.raw).digest('hex');

export function assertSharedCertificate(certificate:X509Certificate|undefined,trust:SharedTrust,now=Date.now()){
 if(!certificate||certificateDigest(certificate)!==trust.certificateSha256||
    !certificate.checkIP(sharedHost(trust.endpoint))||
    Date.parse(certificate.validFrom)>now||Date.parse(certificate.validTo)<=now)
  throw new KTeamError('shared_certificate_mismatch',403);
}

function der(tag:number,...parts:Buffer[]){
 const content=Buffer.concat(parts);
 const bytes=[];
 for(let length=content.length;length>0;length>>>=8)bytes.unshift(length&255);
 const length=content.length<128?[content.length]:[128+bytes.length,...bytes];
 return Buffer.concat([Buffer.from([tag,...length]),content]);
}
const sequence=(...parts:Buffer[])=>der(0x30,...parts);
const oid=(hex:string)=>der(0x06,Buffer.from(hex,'hex'));
const utc=(time:number)=>der(0x17,Buffer.from(new Date(time).toISOString().slice(2,19).replace(/[-T:]/g,'')+'Z'));

function ipBytes(host:string){
 if(isIP(host)===4)return Buffer.from(host.split('.').map(Number));
 // URL canonicalizes IPv6, including IPv4-embedded forms, into hexadecimal words.
 const [prefix,suffix]=host.split('::');
 const left=prefix!.split(':').filter(Boolean),right=suffix?.split(':').filter(Boolean)??[];
 const words=suffix===undefined?left:[...left,...Array<string>(8-left.length-right.length).fill('0'),...right];
 const bytes=Buffer.alloc(16);
 words.forEach((word,index)=>bytes.writeUInt16BE(parseInt(word,16),index*2));
 return bytes;
}

/** A self-signed TLS leaf with an IP SAN, generated using the bundled Node crypto runtime. */
export function createSharedTLS(endpoint:string,now=Date.now()):SharedTLS{
 const host=sharedHost(privateSharedEndpoint(endpoint));
 const {publicKey,privateKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
 const algorithm=sequence(oid('2a8648ce3d040302')); // ecdsa-with-SHA256
 const name=sequence(der(0x31,sequence(oid('550403'),der(0x0c,Buffer.from('KTeam Shared Groups')))));
 const san=sequence(oid('551d11'),der(0x04,sequence(der(0x87,ipBytes(host)))));
 const serial=randomBytes(16);
 serial[0]=(serial[0]!&0x7f)|1;
 const body=sequence(der(0xa0,der(0x02,Buffer.from([2]))),der(0x02,serial),algorithm,name,
  sequence(utc(now-300_000),utc(now+365*86400_000)),name,publicKey.export({type:'spki',format:'der'}),
  der(0xa3,sequence(san)));
 const encoded=sequence(body,algorithm,der(0x03,Buffer.from([0]),sign('sha256',body,privateKey)));
 return {certificate:new X509Certificate(encoded).toString(),privateKey:privateKey.export({type:'pkcs8',format:'pem'}).toString()};
}

/** Application bytes may only be sent after the exact trusted leaf is verified. */
export function connectSharedTLS(trust:SharedTrust,ready:(error:Error|null,socket?:TLSSocket)=>void){
 const endpoint=new URL(trust.endpoint);
 const socket=connect({host:sharedHost(trust.endpoint),port:Number(endpoint.port)||443,
  minVersion:'TLSv1.3',rejectUnauthorized:false});
 const failed=(error:Error)=>{socket.destroy();ready(error);};
 socket.once('error',failed);
 socket.setTimeout(5000,()=>socket.destroy(new KTeamError('shared_coordinator_unreachable',503)));
 socket.once('secureConnect',()=>{
  try{assertSharedCertificate(socket.getPeerX509Certificate(),trust);}
  catch(error){socket.off('error',failed);failed(error as Error);return;}
  socket.off('error',failed);
  socket.setTimeout(0);
  ready(null,socket);
 });
}
