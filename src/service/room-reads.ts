import {KTeamError} from '../errors.js';
import type {Upstreams} from '../adapters/upstream.js';

/** Read original Broker pages. Byte overflow may shrink a GET; no mutation is retried. */
export async function ownerPage(upstream:Upstreams,roomId:string,input:{after?:number;before?:number;tail?:boolean;limit?:number}={}){
 let limit=Math.max(1,Math.min(100,input.limit??50));
 for(;;){
  try{return await upstream.messages(roomId,input.after??0,limit,input.before,!!input.tail);}
  catch(error){if(!(error instanceof KTeamError)||error.code!=='upstream_response_too_large'||limit===1)throw error;limit=Math.max(1,Math.floor(limit/2));}
 }
}
/** Bounded owner-only lookup. Exhaustion is unknown, never proof that a receipt did not happen. */
export async function* ownerMessages(upstream:Upstreams,roomId:string){
 let before:number|undefined,bytes=0,count=0;const until=Date.now()+8000;
 for(;;){
  if(Date.now()>until||bytes>=12*1024*1024||count>=10000)throw new KTeamError('conversation_history_limit',503);
  const page=await ownerPage(upstream,roomId,{before,tail:true,limit:Math.min(100,10000-count)}),messages=(page.messages as any[]).sort((a,b)=>a.roomSequence-b.roomSequence);
  bytes+=Buffer.byteLength(JSON.stringify(messages));count+=messages.length;
  for(const message of [...messages].reverse())yield message;
  if(!page.hasMoreBefore)return;
  const first=messages[0]?.roomSequence;
  if(!Number.isSafeInteger(first)||first<1||before!==undefined&&first>=before)throw new KTeamError('upstream_response_invalid',502);
  before=first;
 }
}
export async function findOwnerMessage(upstream:Upstreams,roomId:string,predicate:(message:any)=>boolean){
 for await(const message of ownerMessages(upstream,roomId))if(predicate(message))return message;
 return undefined;
}
/** Prompt context is a declared bounded window, never the source for a write receipt or original request. */
export async function recentContext(upstream:Upstreams,roomId:string,limit=60){
 const selected:any[]=[];let before:number|undefined,bytes=0,limited=false,more=false;
 while(selected.length<limit){
  const page=await ownerPage(upstream,roomId,{before,tail:true,limit:Math.min(60,limit-selected.length)}),messages=(page.messages as any[]).sort((a,b)=>a.roomSequence-b.roomSequence);
  for(const message of [...messages].reverse()){
   const text=String(message.text??''),view={messageId:message.messageId,roomId:message.roomId,roomSequence:message.roomSequence,sender:message.sender,text:text.slice(0,6000),replyToMessageId:message.replyToMessageId,createdAt:message.createdAt};
   const size=Buffer.byteLength(JSON.stringify(view));
   if(bytes+size>192*1024)return {messages:selected.reverse(),limited:true,limit,bytes};
   selected.push(view);bytes+=size;if(text.length>6000)limited=true;
  }
  if(!page.hasMoreBefore)return {messages:selected.reverse(),limited,limit,bytes};
  if(!messages.length)throw new KTeamError('upstream_response_invalid',502);
  const first=messages[0].roomSequence;
  if(!Number.isSafeInteger(first)||first<1||before!==undefined&&first>=before)throw new KTeamError('upstream_response_invalid',502);
  before=first;more=true;
 }
 return {messages:selected.reverse(),limited:limited||more,limit,bytes};
}
/** Resolve only original Room messages; a supplied ID is never a file/tool authority. */
export async function originalMessage(upstream:Upstreams,roomId:string,messageId:string){
 try{const message=(await upstream.conversationMessage(roomId,messageId)).message as any;if(!message)throw new KTeamError('upstream_response_invalid',502);return message;}
 catch(error){if(error instanceof KTeamError&&['room_scope_mismatch','room_message_not_found'].includes(error.code))return undefined;throw error;}
}
export async function originalSequences(upstream:Upstreams,roomId:string,sequences:number[]){
 const found:number[]=[];
 for(let index=0;index<sequences.length;index+=8){
  const batch=sequences.slice(index,index+8),pages=await Promise.all(batch.map(sequence=>ownerPage(upstream,roomId,{after:sequence-1,before:sequence+1,limit:1})));
  for(let offset=0;offset<batch.length;offset++)if((pages[offset]!.messages as any[]).some(message=>message.roomSequence===batch[offset]))found.push(batch[offset]!);
 }
 return found;
}
