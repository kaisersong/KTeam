import {createHash} from 'node:crypto';
import {KTeamError,fields,record} from '../errors.js';
import type {Upstreams} from '../adapters/upstream.js';
import type {TeamStore} from './team-store.js';
import {projectMessage} from './collaboration.js';
const key=(rootId:string,roomId:string)=>'exchange-'+createHash('sha256').update(JSON.stringify([rootId,roomId])).digest('hex').slice(0,32);
export interface PeerExchange {id:string;originId:string;rootJobId:string;participantIds:string[];messageCount:number;state:'working'|'complete'|'interrupted'|'unknown';createdAt:string}
type Receipt={messageId:string;senderId:string;kind:'request'|'reply';sourceRoomId:string;originId?:string;exchangeId?:string;recipientId?:string;taskRef?:string;job?:any};
/** Read projection over host receipts and broker-owned messages; no second transcript. */
export class PeerExchanges{
 constructor(private upstream:Upstreams,private store:TeamStore){}
 private async source(roomId:string){const snapshot=await this.upstream.membership(roomId);if(!(snapshot.members as any[]).some(m=>m.status==='active'&&m.subject?.kind==='user'&&m.subject.userId==='user.local'))throw new KTeamError('peer_exchange_forbidden',403);return snapshot;}
 private async target(roomId:string,ids:string[]){const snapshot=await this.source(roomId),active=(snapshot.members as any[]).filter(m=>m.status==='active'),bots=active.filter(m=>m.subject?.kind==='agent').map(m=>m.subject.logicalAgentId).sort();if(this.store.settings(roomId)?.kind!=='peer'||active.length!==3||JSON.stringify(bots)!==JSON.stringify([...ids].sort()))throw new KTeamError('peer_exchange_forbidden',403);return snapshot;}
 private group(sourceRoom:string,contacts:any[]){const groups=new Map<string,{view:PeerExchange;roomId:string;receipts:Map<string,Receipt>}>();
  for(const op of contacts){if(!op.roomId||!op.rootJobId)continue;const root=this.store.job(op.rootJobId);if(root?.roomId!==sourceRoom)continue;const sourceJob=this.store.job(op.sourceJobId);let ancestor=sourceJob;const visited=new Set<string>();while(ancestor?.peer&&!visited.has(ancestor.id)&&visited.size<8){visited.add(ancestor.id);if(ancestor.peer.rootJobId!==root.id){ancestor=undefined;break;}ancestor=this.store.job(ancestor.peer.sourceJobId);}if(!sourceJob||ancestor?.id!==root.id)continue;const id=key(root.id,op.roomId),prior=groups.get(id),ids=[op.fromBotId,op.toBotId];if(ids.some(v=>typeof v!=='string')||new Set(ids).size!==2)continue;
   const entry=prior??{view:{id,originId:root.originId,rootJobId:root.id,participantIds:ids,messageCount:0,state:'complete' as PeerExchange['state'],createdAt:root.createdAt},roomId:op.roomId,receipts:new Map<string,Receipt>()};if(prior&&JSON.stringify([...prior.view.participantIds].sort())!==JSON.stringify([...ids].sort()))throw new KTeamError('peer_exchange_scope_changed',409);
   if(op.messageId)entry.receipts.set(op.messageId,{messageId:op.messageId,senderId:op.fromBotId,sourceRoomId:op.sourceRoomId,kind:'request',originId:sourceJob.originId,exchangeId:op.id,recipientId:op.toBotId});
   const job=op.jobId?this.store.job(op.jobId):undefined;
   if(job?.roomId===op.roomId&&job.originId===op.messageId&&job.peer?.sourceJobId===op.sourceJobId&&job.peer?.rootJobId===op.rootJobId&&job.peer?.fromBotId===op.fromBotId&&job.peer?.toBotId===op.toBotId){for(const result of job.results??[])if(result.botId===op.toBotId&&result.messageId)entry.receipts.set(result.messageId,{messageId:result.messageId,senderId:op.toBotId,sourceRoomId:op.sourceRoomId,kind:'reply',taskRef:result.taskRef,job});}
   if(op.status==='unknown'||job?.state==='unknown')entry.view.state='unknown';else if(entry.view.state!=='unknown'&&['queued','routing','running','stopping','held'].includes(job?.state))entry.view.state='working';else if(entry.view.state==='complete'&&(!job||['blocked','stopped','noop'].includes(job.state)))entry.view.state=['preparing','sending'].includes(op.status)?'working':'interrupted';
   entry.view.messageCount=entry.receipts.size;groups.set(id,entry);
  }return groups;
 }
 async list(sourceRoom:string,value:unknown){const input=record(value);fields(input,['originIds']);if(!Array.isArray(input.originIds)||input.originIds.length>100||input.originIds.some(id=>typeof id!=='string'||id.length>160))throw new KTeamError('peer_exchange_query_invalid');
  const source=await this.source(sourceRoom),groups=this.group(sourceRoom,this.store.peerContacts(sourceRoom,input.originIds as string[])),targets=new Map<string,Promise<any>>();const entries=[...groups.values()];
  const exchanges=await Promise.all(entries.map(async entry=>{let snapshot=targets.get(entry.roomId);if(!snapshot){snapshot=this.target(entry.roomId,entry.view.participantIds);targets.set(entry.roomId,snapshot);}try{await snapshot;return entry.view;}catch(e){if(e instanceof KTeamError&&['peer_exchange_forbidden','room_member_required','room_not_found','room_actor_forbidden','room_membership_required'].includes(e.code))return null;throw e;}}));
  const after=await this.source(sourceRoom);for(const [roomId,promise] of targets){let initial;try{initial=await promise;}catch{continue;}const ids=entries.find(e=>e.roomId===roomId)!.view.participantIds;const latest=await this.target(roomId,ids);if((latest.room as any).revision!==(initial.room as any).revision)throw new KTeamError('peer_exchange_scope_changed',409);}if((after.room as any).revision!==(source.room as any).revision)throw new KTeamError('peer_exchange_scope_changed',409);
  return {ok:true,exchanges:exchanges.filter((e):e is PeerExchange=>!!e).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id))};
 }
 async messages(sourceRoom:string,id:string){if(!/^exchange-[a-f0-9]{32}$/.test(id))throw new KTeamError('peer_exchange_not_found',404);const source=await this.source(sourceRoom);const entry=this.group(sourceRoom,this.store.peerContacts(sourceRoom)).get(id);if(!entry)throw new KTeamError('peer_exchange_not_found',404);const target=await this.target(entry.roomId,entry.view.participantIds);
  if(entry.receipts.size>32)throw new KTeamError('peer_exchange_message_limit',409);
  const messages=await Promise.all([...entry.receipts.values()].map(async receipt=>{const actual=(await this.upstream.conversationMessage(entry.roomId,receipt.messageId)).message as any;
   if(actual?.roomId!==entry.roomId||actual.messageId!==receipt.messageId||actual.sender?.kind!=='agent'||actual.sender.logicalAgentId!==receipt.senderId||(receipt.kind==='request'?(actual.sourceRef?.kind!=='bot_private_message'||actual.sourceRef.originRoomId!==receipt.sourceRoomId||actual.sourceRef.purpose!=='consult'||actual.sourceRef.exchangeId!==receipt.exchangeId||actual.sourceRef.originMessageId!==receipt.originId||actual.sourceRef.recipientLogicalAgentId!==receipt.recipientId):(actual.sourceRef?.kind!=='aimp_reply'||actual.sourceRef.taskRef!==receipt.taskRef)))throw new KTeamError('peer_exchange_message_unavailable',409);
   return {...projectMessage(actual),cards:(receipt.job?.cards??[]).filter((c:any)=>c.botId===receipt.senderId)};
  }));
  const [currentSource,currentTarget]=await Promise.all([this.source(sourceRoom),this.target(entry.roomId,entry.view.participantIds)]);if((currentSource.room as any).revision!==(source.room as any).revision||(currentTarget.room as any).revision!==(target.room as any).revision)throw new KTeamError('peer_exchange_scope_changed',409);
  return {ok:true,exchange:entry.view,messages:messages.sort((a,b)=>Number(a.roomSequence)-Number(b.roomSequence))};
 }
}
