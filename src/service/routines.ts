import {createHash} from 'node:crypto';
import {KTeamError,fields,record,text} from '../errors.js';
import type {Upstreams} from '../adapters/upstream.js';
import type {TeamStore} from './team-store.js';
import {profile} from './bot-profile.js';
import {routineSchedule,routineTimeZone,nextRoutineAt,validTime,type RoutineSchedule} from '../protocol/routine-schedule.js';

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const activeStates=['queued','held','routing','running','waiting','stopping','paused'];
const reviewStates=['unknown','blocked','stopped'];
export class Routines {
 constructor(private upstream:Upstreams,private store:TeamStore,private now=Date.now,private changed:(id:string)=>void=()=>{}){}
 private async scope(roomId:string,botId?:string){
  const settings=this.store.settings(roomId);if(!settings||settings.kind==='peer'||settings.delivery==='external-agent')throw new KTeamError('routine_scope_denied',403);
  const membership=await this.upstream.membership(roomId),members=membership.members as any[];
  if((membership.room as any)?.status!=='active'||!members.some(member=>member.status==='active'&&member.subject?.kind==='user'&&member.subject.userId==='user.local'))throw new KTeamError('routine_scope_denied',403);
  if(!botId)return {settings,membership};
  const bot=((await this.upstream.listBots()).agents as any[]).find(bot=>bot.id===botId&&!bot.archivedAt),binding=this.store.binding(botId);
  if(!bot||!members.some(member=>member.status==='active'&&member.subject?.logicalAgentId===botId)||binding?.kind!=='xiaok-hosted'||this.store.state('source-changing:'+botId))throw new KTeamError('routine_bot_unavailable',403);
  return {settings,membership,bot,binding,captured:{settingsRevision:settings.revision,roomRevision:(membership.room as any).revision,profileRevision:profile(bot).revision,bindingRevision:binding.revision,bindingModelId:binding.modelId,bindingFingerprint:binding.fingerprint}};
 }
 private projection(row:any){return {id:row.id,roomId:row.roomId,botId:row.botId,name:row.name,prompt:row.prompt,schedule:row.schedule,timeZone:row.timeZone,maxRuns:row.maxRuns,endAt:row.endAt??null,overlap:'skip',enabled:row.enabled,revision:row.revision,nextAt:row.nextAt??null,runCount:row.runCount,reason:row.reason??null,lastError:row.lastError??null,retryAt:row.retryAt??null,deleted:!!row.deletedAt};}
 private runs(id:string){return this.store.operationsWithPrefix('routine-run:'+id+':');}
 async list(roomId:string){
  await this.scope(roomId);
  return {ok:true,items:this.store.operationsWithPrefix('routine:').filter(row=>row.roomId===roomId&&!row.deletedAt).slice(0,100).map(row=>({...this.projection(row),needsReview:this.runs(row.id).some(run=>{const job=run.jobId?this.store.job(run.jobId):null;return job&&reviewStates.includes(job.state)&&!(row.reviewedJobIds??[]).includes(job.id);}),runs:this.runs(row.id).slice(0,20).map(run=>{const job=run.jobId?this.store.job(run.jobId):null;return {id:run.id,scheduledAt:run.scheduledAt,jobId:job?.id??null,state:job?.state??run.outcome,reason:job?.reason??run.reason??null,resultMessageIds:(job?.results??[]).map((result:any)=>result.messageId)};})}))};
 }
 async save(value:unknown){
  const input=record(value);fields(input,['id','roomId','botId','expectedRevision','requestId','name','prompt','schedule','timeZone','maxRuns','endAt','enabled','overlap']);
  const roomId=text(input.roomId,'room_id'),botId=text(input.botId,'bot_id'),requestId=text(input.requestId,'request_id',128),name=text(input.name,'routine_name',80).trim(),prompt=text(input.prompt,'routine_prompt',8192).trim(),schedule=routineSchedule(input.schedule),timeZone=routineTimeZone(input.timeZone),now=this.now();
  if(typeof input.enabled!=='boolean'||input.overlap!=='skip'||!Number.isSafeInteger(input.maxRuns)||Number(input.maxRuns)<1||Number(input.maxRuns)>365||!Number.isSafeInteger(input.expectedRevision)||Number(input.expectedRevision)<0)throw new KTeamError('routine_input_invalid');
  const endAt=input.endAt===null||input.endAt===undefined?undefined:input.endAt;if(endAt!==undefined&&!validTime(endAt))throw new KTeamError('routine_time_invalid');
  const nextAt=nextRoutineAt(schedule,timeZone,now,Number(endAt)||undefined);
  const id=input.id===undefined?'routine:'+hash([roomId,requestId]).slice(0,32):text(input.id,'routine_id');if(!/^routine:[a-f0-9]{32}$/.test(id))throw new KTeamError('routine_not_found',404);
  const captured=await this.scope(roomId,botId);if(input.enabled&&(captured.settings.paused||captured.settings.quiet))throw new KTeamError('routine_room_paused',409);
  const intent=hash({roomId,botId,name,prompt,schedule,timeZone,maxRuns:input.maxRuns,endAt: endAt??null,enabled:input.enabled,overlap:'skip'});
  let reused=false;
  const saved=this.store.transaction(()=>{
   const current=this.store.operation(id);
   if(current?.roomId&&current.roomId!==roomId)throw new KTeamError('routine_scope_denied',403);
   if(current?.lastRequestId===requestId){if(current.intent!==intent)throw new KTeamError('routine_request_conflict',409);reused=true;return current;}
   if(input.enabled&&(!nextAt||endAt!==undefined&&Number(endAt)<=now))throw new KTeamError('routine_time_invalid');
   if(input.enabled&&(current?.runCount??0)>=Number(input.maxRuns))throw new KTeamError('routine_limit_reached',409);
   if((current?.revision??0)!==input.expectedRevision||current?.deletedAt)throw new KTeamError('routine_changed',409);
   if(!current&&this.store.operationsWithPrefix('routine:').filter(row=>row.roomId===roomId&&!row.deletedAt).length>=100)throw new KTeamError('routine_limit_reached',409);
   if(this.store.settings(roomId)?.revision!==captured.settings.revision||this.store.binding(botId)?.revision!==captured.binding?.revision||this.store.state('source-changing:'+botId))throw new KTeamError('routine_scope_changed',409);
   return this.store.saveOperation({id,roomId,botId,name,prompt,schedule,timeZone,maxRuns:input.maxRuns,endAt,enabled:input.enabled,nextAt:input.enabled?nextAt:null,runCount:current?.runCount??0,configVersion:(current?.configVersion??0)+1,captured:captured.captured,reviewedJobIds:[...new Set([...(current?.reviewedJobIds??[]),...this.runs(id).flatMap(run=>{const job=run.jobId?this.store.job(run.jobId):null;return job&&reviewStates.includes(job.state)?[job.id]:[];})])],lastRequestId:requestId,intent,createdAt:current?.createdAt??now,updatedAt:now,reason:input.enabled?null:'user_paused'},Number(input.expectedRevision));
  });
  if(!reused)this.changed(saved.id);return {ok:true,reused,routine:this.projection(saved)};
 }
 async remove(value:unknown){
  const input=record(value);fields(input,['roomId','id','expectedRevision']);const roomId=text(input.roomId,'room_id'),id=text(input.id,'routine_id');await this.scope(roomId);
  const saved=this.store.transaction(()=>{const current=this.store.operation(id);if(!id.startsWith('routine:')||!current||current.roomId!==roomId)throw new KTeamError('routine_not_found',404);if(current.deletedAt)return current;if(current.revision!==input.expectedRevision)throw new KTeamError('routine_changed',409);return this.store.saveOperation({...current,enabled:false,nextAt:null,deletedAt:this.now(),reason:'user_removed',configVersion:current.configVersion+1},current.revision);});this.changed(id);return {ok:true,routine:this.projection(saved)};
 }
 async pause(value:unknown){
  const input=record(value);fields(input,['roomId','id','expectedRevision']);const roomId=text(input.roomId,'room_id'),id=text(input.id,'routine_id');await this.scope(roomId);
  let reused=false;const saved=this.store.transaction(()=>{const current=this.store.operation(id);if(!id.startsWith('routine:')||!current||current.roomId!==roomId||current.deletedAt)throw new KTeamError('routine_not_found',404);if(!current.enabled){reused=true;return current;}if(current.revision!==input.expectedRevision)throw new KTeamError('routine_changed',409);return this.store.saveOperation({...current,enabled:false,nextAt:null,reason:'user_paused',configVersion:current.configVersion+1},current.revision);});if(!reused)this.changed(id);return {ok:true,reused,routine:this.projection(saved)};
 }
 assertJob(job:any,bot?:any){
  if(job.trigger!=='routine')return;
  const row=this.store.operation(job.routine?.id),binding=this.store.binding(row?.botId),settings=this.store.settings(job.roomId);
  if(!row||!row.enabled||row.deletedAt||row.roomId!==job.roomId||row.botId!==job.routine.botId||row.configVersion!==job.routine.configVersion||!settings||settings.paused||settings.quiet||settings.revision!==row.captured.settingsRevision||binding?.revision!==row.captured.bindingRevision||binding?.modelId!==row.captured.bindingModelId||binding?.fingerprint!==row.captured.bindingFingerprint)throw new KTeamError('routine_scope_changed',409);
  if(bot&&profile(bot).revision!==row.captured.profileRevision)throw new KTeamError('routine_scope_changed',409);
  if(!job.routine.admittedAt&&(this.now()-job.routine.scheduledAt>300000||row.endAt&&this.now()>row.endAt))throw new KTeamError('routine_missed',409);
 }
 async guard(job:any){
  if(job.trigger!=='routine')return;
  this.assertJob(job);const row=this.store.operation(job.routine.id),current=await this.scope(job.roomId,row.botId);
  if(hash(current.captured)!==hash(row.captured))throw new KTeamError('routine_scope_changed',409);
  this.assertJob(job);
 }
 async admit(job:any){
  if(job.trigger!=='routine')return;
  await this.guard(job);job.routine.admittedAt=this.now();this.store.save(job);
 }

 async wake(){
  const now=this.now();
  const rows=this.store.operationsWithPrefix('routine:').filter(row=>row.enabled&&!row.deletedAt&&row.nextAt!==null&&row.nextAt<=now&&(!row.retryAt||row.retryAt<=now)).sort((a,b)=>a.nextAt-b.nextAt||a.id.localeCompare(b.id)).slice(0,20);
  const probes=await Promise.allSettled(rows.map(row=>this.scope(row.roomId,row.botId)));
  for(const [index,snapshot] of rows.entries()){
   const probe=probes[index]!;let current:any;
   if(probe.status==='rejected'){const error=probe.reason;
    this.store.transaction(()=>{const row=this.store.operation(snapshot.id);if(row?.revision!==snapshot.revision)return;const denied=error instanceof KTeamError&&[403,404].includes(error.status),failures=(row.readFailures??0)+1;this.store.saveOperation({...row,...(denied?{enabled:false,nextAt:null,reason:'routine_scope_changed'}:{}),lastError:denied?'routine_scope_changed':'routine_source_unavailable',readFailures:failures,retryAt:now+Math.min(300000,5000*2**Math.min(failures-1,6))},row.revision);});continue;
   }
   current=probe.value;
   this.store.transaction(()=>{
    const row=this.store.operation(snapshot.id);if(row?.revision!==snapshot.revision||!row.enabled||row.nextAt!==snapshot.nextAt)return;
    const matches=hash(current.captured)===hash(row.captured)&&!current.settings.paused&&!current.settings.quiet&&this.store.settings(row.roomId)?.revision===current.settings.revision&&this.store.binding(row.botId)?.revision===current.binding?.revision&&!this.store.state('source-changing:'+row.botId);
    if(!matches){this.store.saveOperation({...row,enabled:false,nextAt:null,reason:'routine_scope_changed'},row.revision);return;}
    const prior=this.runs(row.id).find(run=>run.jobId),priorJob=prior?this.store.job(prior.jobId):null;
    if(priorJob&&reviewStates.includes(priorJob.state)&&!(row.reviewedJobIds??[]).includes(priorJob.id)){this.store.saveOperation({...row,enabled:false,nextAt:null,reason:'routine_result_needs_review'},row.revision);return;}
    const scheduledAt=row.nextAt,runId='routine-run:'+row.id+':'+scheduledAt,next=nextRoutineAt(row.schedule as RoutineSchedule,row.timeZone,now,row.endAt);
    const outcome=now-scheduledAt>300000||row.endAt&&now>row.endAt?'missed':priorJob&&activeStates.includes(priorJob.state)?'overlap':'enqueued';
    const runCount=row.runCount+(outcome==='enqueued'?1:0),enabled=row.schedule.kind!=='once'&&next!==null&&runCount<row.maxRuns;
    if(!this.store.operation(runId)){
     const jobId=outcome==='enqueued'?'job-'+hash(runId).slice(0,32):undefined;
     if(jobId)this.store.enqueueFollowup({id:jobId,roomId:row.roomId,originId:runId,trigger:'routine',routine:{id:row.id,botId:row.botId,name:row.name,prompt:row.prompt,scheduledAt,configVersion:row.configVersion}});
     this.store.saveOperation({id:runId,roomId:row.roomId,routineId:row.id,scheduledAt,jobId,outcome},0);
    }
    // A final queued occurrence remains enabled until it is admitted/settled; nextAt ends recurrence.
    this.store.saveOperation({...row,nextAt:enabled?next:null,enabled:true,runCount,reason:enabled?null:'routine_schedule_ended',lastError:null,retryAt:null,readFailures:0},row.revision);
   });
  }
 }
}
