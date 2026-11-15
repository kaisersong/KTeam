import {createHash} from 'node:crypto';
import {KTeamError,record,fields,text} from '../errors.js';
import {findOwnerMessage} from './room-reads.js';
import type {BotContactScope} from './private-conversations.js';
import type {Upstreams} from '../adapters/upstream.js';
import type {TeamStore} from './team-store.js';
import type {TeamCoordinator} from './coordination.js';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Master identity is host-owned. Transfer only the explicit message, never private source history. */
export class MasterRelay {
 constructor(private upstream:Upstreams,private store:TeamStore,private coordinator:TeamCoordinator,private dispatch:()=>void,private validateParent?:(job:any)=>Promise<void>){}
 isMaster(botId:string){return this.store.operation('assistant:'+this.store.installationId())?.receipt?.botId===botId;}
 private async source(scope:BotContactScope){
  await scope.assertCurrent();const job=this.store.job(scope.jobId);
  if(this.store.settings(scope.roomId)?.paused||!this.isMaster(scope.botId)||!job||job.masterRelay||job.roomId!==scope.roomId||job.activeBotId!==scope.botId||['blocked','unknown','stopped','stopping','cancelled','held'].includes(job.state))throw new KTeamError('assistant_scope_required',403);
  await this.coordinator.guardConversation(scope.roomId);const snapshot=await this.upstream.membership(scope.roomId);
  if((snapshot.room as any).status!=='active'||!(snapshot.members as any[]).some(member=>member.status==='active'&&member.role==='owner'&&member.subject?.userId==='user.local')||!(snapshot.members as any[]).some(member=>member.status==='active'&&member.subject?.logicalAgentId===scope.botId))throw new KTeamError('assistant_scope_required',403);
 }
 private async target(roomId:string,botId?:string){
  if(this.store.settings(roomId)?.paused)throw new KTeamError('bot_private_target_paused',409);
  await this.coordinator.guardConversation(roomId);const snapshot=await this.upstream.membership(roomId);
  if((snapshot.room as any).status!=='active'||!(snapshot.members as any[]).some(member=>member.status==='active'&&member.role==='owner'&&member.subject?.userId==='user.local')||botId&&!(snapshot.members as any[]).some(member=>member.status==='active'&&member.subject?.logicalAgentId===botId))throw new KTeamError('assistant_team_forbidden',403);
  return snapshot;
 }
 async validate(job:any){
  const relay=job.masterRelay??(job.peer?.masterRelay?job.peer:undefined);if(!relay)return;
  const parent=this.store.job(relay.sourceJobId);if(!parent)throw new KTeamError('assistant_scope_required',403);
  await this.validateParent?.(parent);
  const scope={roomId:relay.sourceRoomId,botId:relay.fromBotId,jobId:parent.id,originId:parent.originId,admission:{},signal:new AbortController().signal,assertCurrent:async()=>{}};
  await this.source(scope);await this.target(job.roomId,relay.toBotId);
 }
 async contact(scope:BotContactScope,value:unknown){
  const input=record(value);fields(input,['botId','message','wait']);const botId=text(input.botId,'bot_id');
  await this.source(scope);if(botId===scope.botId||(scope.path??[]).includes(botId))throw new KTeamError('bot_contact_cycle_denied',409);
  const bot=((await this.upstream.listBots()).agents as any[]).find(bot=>bot.id===botId&&!bot.archivedAt);
  if(!bot||!this.store.binding(botId))throw new KTeamError('agent_not_found',404);
  const direct=await this.coordinator.direct(botId,{requestSource:'user'});
  return this.send(scope,direct.roomId,text(input.message,'message',6000),botId,input.wait!==false);
 }
 async group(scope:BotContactScope,value:unknown){
  const input=record(value);fields(input,['roomId','message','wait']);const roomId=text(input.roomId,'room_id');
  await this.source(scope);if(!['group',undefined].includes(this.store.settings(roomId)?.kind))throw new KTeamError('assistant_team_forbidden',403);
  return this.send(scope,roomId,text(input.message,'message',6000),undefined,input.wait===true);
 }
 private async send(scope:BotContactScope,roomId:string,body:string,botId:string|undefined,wait:boolean){
  if(this.store.settings(scope.roomId)?.kind==='peer'||scope.path&&scope.path.length>1)throw new KTeamError('bot_contact_cycle_denied',409);
  await this.source(scope);const target=await this.target(roomId,botId);
  const protocol=await this.upstream.masterMessagingProtocol();
  if(!(protocol.capabilities as string[]??[]).includes('owner-agent-relay'))throw new KTeamError('assistant_relay_service_upgrade_required',503);
  const id='master-relay:'+hash([scope.jobId,scope.botId,roomId,botId??null,body]);let op=this.store.operation(id);
  if(op?.status==='failed')throw new KTeamError('bot_contact_result_unknown',409);
  if(!op){if(this.store.operationsWithPrefix('master-relay:').filter(row=>row.sourceJobId===scope.jobId).length>=8)throw new KTeamError('bot_contact_budget_exhausted',409);op=this.store.saveOperation({id,status:'preparing',sourceJobId:scope.jobId,sourceRoomId:scope.roomId,roomId,fromBotId:scope.botId,toBotId:botId,bodyHash:hash(body)},0);}
  let message:any;
  if(['sending','unknown','sent'].includes(op.status)){
   message=await findOwnerMessage(this.upstream,roomId,message=>message.sourceRef?.kind==='assistant_relay'&&message.sourceRef.relayId===id&&message.sender?.logicalAgentId===scope.botId&&hash(message.text)===op.bodyHash);
   if(!message)throw new KTeamError('bot_contact_result_unknown',409);
  }else{
   await this.source(scope);await this.target(roomId,botId);op=this.store.saveOperation({...op,status:'sending'},op.revision);
   try{message=(await this.upstream.sendOwnerAgentRelay(roomId,{logicalAgentId:scope.botId,sourceRoomId:scope.roomId,admission:scope.admission,text:body,idempotencyKey:id,expectedRoomRevision:(target.room as any).revision,originMessageId:scope.originId,...(botId?{recipientLogicalAgentId:botId}:{})})).message;}
   catch(error){const current=this.store.operation(id);this.store.saveOperation({...current,status:error instanceof KTeamError&&error.code==='upstream_operation_unknown'?'unknown':'failed'},current.revision);throw error;}
  }
  await this.source(scope);await this.target(roomId,botId);if(!message?.messageId)throw new KTeamError('upstream_response_invalid',502);
  const jobId='job-'+id,relay={sourceRoomId:scope.roomId,sourceJobId:scope.jobId,rootJobId:scope.rootJobId??scope.jobId,fromBotId:scope.botId,toBotId:botId,path:[scope.botId,...(botId?[botId]:[])],masterRelay:true};
  this.store.transaction(()=>{const current=this.store.operation(id);if(current.status==='sent')return;this.store.saveOperation({...current,status:'sent',messageId:message.messageId,jobId},current.revision);if(this.store.settings(roomId))this.store.enqueueFollowup({id:jobId,roomId,originId:message.messageId,trigger:botId?'peer':'assistant-relay',masterRelay:relay,...(botId?{peer:relay}:{})});});this.dispatch();
  if(!this.store.settings(roomId))return JSON.stringify({sent:true,completed:false,roomId,messageId:message.messageId,reason:'target_runtime_unmanaged'});
  if(!wait)return JSON.stringify({sent:true,completed:false,roomId,messageId:message.messageId,jobId});
  for(;;){scope.signal.throwIfAborted();await this.source(scope);const job=this.store.job(jobId);await this.validate(job);
   if(job?.state==='delivered'){const receipt=botId?job.results?.find((result:any)=>result.botId===botId):job.results?.at(-1);if(!receipt)throw new KTeamError('bot_contact_result_missing');const reply=(await this.upstream.conversationMessage(roomId,receipt.messageId)).message as any;if(reply.sender?.logicalAgentId!==receipt.botId||reply.sourceRef?.taskRef!==receipt.taskRef)throw new KTeamError('bot_contact_result_missing');return JSON.stringify({sent:true,completed:true,roomId,messageId:reply.messageId,fromBotId:receipt.botId,text:reply.text});}
   if(job&&['blocked','unknown','stopped','noop','paused'].includes(job.state))return JSON.stringify({sent:true,completed:false,roomId,jobId,state:job.state,reason:job.reason});await new Promise(resolve=>setTimeout(resolve,200));
  }
 }
}
