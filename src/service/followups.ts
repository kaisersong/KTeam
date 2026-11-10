import {KTeamError,fields,record,text} from '../errors.js';
import type {Upstreams} from '../adapters/upstream.js';
import type {TeamStore} from './team-store.js';
import {profile} from './bot-profile.js';

export class Followups {
 constructor(private upstream:Upstreams,private store:TeamStore){}

 private async scope(roomId:string){
  if(!this.store.settings(roomId))throw new KTeamError('conversation_not_managed',403);
  const membership=await this.upstream.membership(roomId);
  if((membership.room as any)?.status!=='active'||!(membership.members as any[]).some(member=>member.status==='active'&&member.subject?.kind==='user'&&member.subject.userId==='user.local'))throw new KTeamError('followup_scope_denied',403);
  return membership;
 }

 async list(botId:string){
  if(!this.store.binding(botId)&&!this.store.state('external-bot:'+botId))throw new KTeamError('bot_not_managed',403);
  const bot=((await this.upstream.listBots()).agents as any[]).find(bot=>bot.id===botId&&!bot.archivedAt);
  if(!bot)throw new KTeamError('agent_not_found',404);
  const rows=this.store.operationsWithPrefix('followup:').filter(row=>row.botId===botId).sort((a,b)=>b.dueAt-a.dueAt).slice(0,100);
  const rooms=new Map<string,any>();
  for(const roomId of new Set<string>(rows.map(row=>row.roomId))){
   try{rooms.set(roomId,await this.scope(roomId));}catch(error){if(error instanceof KTeamError&&[403,404].includes(error.status))continue;throw error;}
  }
  const follows=rows.flatMap(row=>{
   const membership=rooms.get(row.roomId);if(!membership)return [];
   const job=this.store.job('job-'+row.id),binding=this.store.binding(botId),settings=this.store.settings(row.roomId);
   const current=!!binding&&binding.revision===row.bindingRevision&&binding.modelId===row.bindingModelId&&binding.fingerprint===row.bindingFingerprint&&profile(bot).revision===row.profileRevision&&profile(bot).followup&&!!settings&&settings.revision===row.settingsRevision&&!settings.paused&&!settings.quiet;
   return [{id:row.id,revision:row.revision,botId,roomId:row.roomId,roomTitle:membership.room?.title??'会话',originMessageId:row.originId,dueAt:row.dueAt,reason:row.reason,cancelReason:row.cancelReason??null,runReason:job?.reason??null,state:job?.state??(row.status==='pending'&&!current?'scope_changed':row.status),canCancel:row.status==='pending'&&!job,jobId:job?.id??null,resultMessageId:job?.results?.find((result:any)=>result.botId===botId)?.messageId??null}];
  });
  return {ok:true,enabled:profile(bot).followup,items:follows};
 }

 async cancel(value:unknown){
  const input=record(value);fields(input,['id','expectedRevision','botId']);
  const id=text(input.id,'followup_id'),botId=text(input.botId,'bot_id');
  if(!Number.isSafeInteger(input.expectedRevision)||Number(input.expectedRevision)<1)throw new KTeamError('followup_changed',409);
  const prior=this.store.operation(id);
  if(!id.startsWith('followup:')||!prior||prior.botId!==botId)throw new KTeamError('followup_not_found',404);
  await this.scope(prior.roomId);
  return this.store.transaction(()=>{
   const current=this.store.operation(id);
   if(current?.status==='cancelled'&&current.cancelReason==='user_cancelled')return {ok:true,reused:true};
   if(!Number.isSafeInteger(input.expectedRevision)||current?.revision!==input.expectedRevision)throw new KTeamError('followup_changed',409);
   if(current.status!=='pending'||this.store.job('job-'+id))throw new KTeamError('followup_already_started',409);
   this.store.saveOperation({...current,status:'cancelled',cancelReason:'user_cancelled',cancelledAt:Date.now()},current.revision);
   return {ok:true,reused:false};
  });
 }
}
