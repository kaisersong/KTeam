import {Upstreams} from '../adapters/upstream.js';
import {KTeamError,fields,record,text} from '../errors.js';
import {TeamStore} from './team-store.js';
import {TeamCoordinator} from './coordination.js';
import {profile} from './bot-profile.js';

/** A projection/control surface over the existing followup owner, not a new queue. */
export class ScheduledWork{
 constructor(private upstream:Upstreams,private store:TeamStore,private coordinator:TeamCoordinator){}
 private async context(roomId:string){
  const settings=this.store.settings(roomId),snapshot=await this.upstream.membership(roomId),active=(snapshot.members as any[]).filter(m=>m.status==='active');
  if(!settings||(snapshot.room as any)?.status!=='active'||!active.some(m=>m.subject?.userId==='user.local'))throw new KTeamError('scheduled_work_forbidden',403);
  await this.coordinator.guardConversation(roomId,snapshot);
  return {group:!['assistant','direct'].includes(settings.kind??'group'),botIds:active.flatMap(m=>m.subject?.logicalAgentId?[m.subject.logicalAgentId]:[])};
 }
 private belongs(item:any,roomId:string,context:{group:boolean;botIds:string[]}){return context.group?item.roomId===roomId&&context.botIds.includes(item.botId):context.botIds.includes(item.botId);}
 private async source(item:any){
  const settings=this.store.settings(item.roomId),snapshot=await this.upstream.membership(item.roomId),active=(snapshot.members as any[]).filter(m=>m.status==='active');
  if(!active.some(m=>m.subject?.userId==='user.local')||(snapshot.room as any)?.status!=='active')throw new KTeamError('scheduled_work_forbidden',403);
  await this.coordinator.guardConversation(item.roomId,snapshot);
  const bots=(await this.upstream.listBots()).agents as any[],bot=bots.find(b=>b.id===item.botId&&!b.archivedAt),binding=this.store.binding(item.botId);
  const latest=((await this.upstream.messages(item.roomId,0,100,undefined,true)).messages as any[]).filter(m=>m.sender?.kind==='user').at(-1);
  const membership=await this.upstream.membership(item.roomId);await this.coordinator.guardConversation(item.roomId,membership);
  if(!(membership.members as any[]).some(m=>m.status==='active'&&m.subject?.userId==='user.local'))throw new KTeamError('scheduled_work_forbidden',403);
  let unavailable:string|undefined;
  if(!settings||settings.paused||settings.quiet)unavailable='会话已暂停或处于安静模式';
  else if(settings.revision!==item.settingsRevision||!bot||!profile(bot).followup||profile(bot).revision!==item.profileRevision||!binding||binding.revision!==item.bindingRevision||binding.modelId!==item.bindingModelId||binding.fingerprint!==item.bindingFingerprint)unavailable='成员或工作范围已变更';
  else if(!(membership.members as any[]).some(m=>m.status==='active'&&m.subject?.logicalAgentId===item.botId))unavailable='成员已离开来源会话';
  else if(latest?.messageId!==item.originId)unavailable='来源对话已有更新';
  else if(Date.now()-item.dueAt>24*3600000)unavailable='安排已过期';
  return {unavailable,botName:bot?.name??'成员',sourceTitle:(snapshot.room as any).title};
 }
 async view(roomId:string){
  const context=await this.context(roomId),schedules=[];
  for(const item of this.store.operationsWithPrefix('followup:').filter(item=>['pending','paused','queued'].includes(item.status)&&this.belongs(item,roomId,context))){
   if(item.status==='queued'&&!['queued','routing','running','stopping'].includes(this.store.job('job-'+item.id)?.state))continue;
   const source=await this.source(item);
   schedules.push({id:item.id,revision:item.revision,botId:item.botId,botName:source.botName,sourceRoomId:item.roomId,sourceTitle:source.sourceTitle,title:item.reason,dueAt:item.dueAt,kind:'once',state:item.status,unavailable:source.unavailable});
  }
  await this.context(roomId);
  return {ok:true,schedules:schedules.sort((a,b)=>a.dueAt-b.dueAt)};
 }
 async change(roomId:string,value:unknown){
  const input=record(value);fields(input,['id','expectedRevision','action']);const id=text(input.id,'schedule_id'),action=String(input.action);
  if(!['pause','resume','cancel'].includes(action)||!Number.isSafeInteger(input.expectedRevision))throw new KTeamError('invalid_input');
  const context=await this.context(roomId),prior=this.store.operation(id);
  if(!id.startsWith('followup:')||!prior||!this.belongs(prior,roomId,context))throw new KTeamError('scheduled_work_forbidden',403);
  const source=await this.source(prior);await this.context(roomId);
  const current=this.store.operation(id);if(!current)throw new KTeamError('scheduled_work_changed',409);
  if(current.lastUserAction?.action===action&&current.lastUserAction?.expectedRevision===input.expectedRevision)return {ok:true,reused:true};
  if(current.revision!==input.expectedRevision)throw new KTeamError('scheduled_work_changed',409);
  if(!['pending','paused'].includes(current.status))throw new KTeamError('scheduled_work_already_started',409);
  if(action==='resume'&&source.unavailable)throw new KTeamError('scheduled_work_scope_changed',409);
  if(action==='pause'&&current.status!=='pending'||action==='resume'&&current.status!=='paused')throw new KTeamError('scheduled_work_changed',409);
  this.store.saveOperation({...current,status:action==='pause'?'paused':action==='resume'?'pending':'cancelled',...(action==='resume'?{dueAt:Math.max(current.dueAt,Date.now()+1000)}:{}),lastUserAction:{action,expectedRevision:input.expectedRevision}},current.revision);
  return {ok:true};
 }
}
