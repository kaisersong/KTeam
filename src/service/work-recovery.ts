import {unexecutedModelToolOutput} from '../protocol/model-tool-output.js';
import {processBirth,sameProcessBirth} from '../runtime/platform-process.js';
import {Routines,routineWork} from './routines.js';
import {harnessWorkspace} from '../runtime/harness.js';
import {profile} from './bot-profile.js';
import {memoryReviewRooms} from '../runtime/harness-storage.js';
import {staleToolBatchApproval} from './stale-tool-batch.js';
import {sharedRuntime} from '../runtime/native.js';
import {harnessLocation,acquireHarnessStorage} from '../runtime/harness-storage.js';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {KTeamError, fields, record, text} from '../errors.js';
import {executionFailure} from '../protocol/execution-failure.js';
import {dependentWork as dependent,latestWorkRoot as latestWork} from '../protocol/work-recovery-view.js';
import type {Upstreams} from '../adapters/upstream.js';
import type {TeamCoordinator} from './coordination.js';
import type {TeamStore} from './team-store.js';

const interrupted = (job: any) => job && !job.codexDispatch && !job.groupResponse&&!job.groupInput&& ['stopped','unknown','blocked'].includes(job.state) && !['peer','followup','assistant-notice','regenerate'].includes(job.trigger);
const active = (job: any) => !dependent(job)&&['queued','held','routing','running','stopping'].includes(job.state);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

interface RecoveryReply {
 botId:string;
 messageId:string;
 taskRef:string;
}

const validRef=(value:unknown):value is string=>typeof value==='string'&&/^[a-zA-Z0-9:_-]{1,160}$/.test(value);

function replyReference(value:any):RecoveryReply|undefined{
 if(validRef(value?.botId)&&validRef(value.messageId)&&validRef(value.taskRef)){
  return {botId:value.botId,messageId:value.messageId,taskRef:value.taskRef};
 }
}

/** Rebuild the model input from the linked work and current Room receipts. */
export async function readRecoveryContext(upstream:Upstreams,store:TeamStore,job:any){
 const prior=validRef(job.recoveryOf)?store.job(job.recoveryOf):undefined;
 if(!prior||prior.roomId!==job.roomId||prior.originId!==job.originId||
    !['blocked','unknown','stopped','delivered'].includes(prior.state)){
  return {sourceState:'unavailable',limited:true};
 }

 const failure=executionFailure(prior);
 const results:unknown[]=Array.isArray(prior.results)?prior.results:[];
 const marker=replyReference(job.recoveryContext?.unexecutedReply);
 const candidates=new Map<string,RecoveryReply>();
 // The explicit repair marker stays within the same verification budget.
 const recent=results.slice(-8);
 if(marker&&!recent.some(value=>replyReference(value)?.messageId===marker.messageId)){
  const original=results.find(value=>replyReference(value)?.messageId===marker.messageId);
  if(original)recent.unshift(original);
 }
 for(const result of recent.slice(0,8)){
  const reference=replyReference(result);
  if(reference)candidates.set(reference.messageId,reference);
 }

 const snapshot=candidates.size?await upstream.aimp(job.roomId,'tasks').catch(()=>undefined):undefined;
 const tasks=Array.isArray(snapshot?.tasks)?snapshot.tasks:[];
 const checks=await Promise.all([...candidates.values()].map(async reference=>{
  const task=tasks.find(value=>value?.taskRef===reference.taskRef);
  const run=prior.id+':'+reference.botId;
  const handoffPrefix=run+':handoff:';
  const runId=task?.runId;
  const resumedRun=typeof runId==='string'&&runId.startsWith(handoffPrefix)&&/^\d+$/.test(runId.slice(handoffPrefix.length));
  if(!task||task.roomId!==job.roomId||!['delivered','accepted'].includes(task.state)||
     task.artifactVerification?.verified!==true||!Array.isArray(task.artifacts)||(runId!==run&&!resumedRun))return;
  const response=await upstream.conversationMessage(job.roomId,reference.messageId).catch(()=>undefined);
  const actual=response?.message as any;
  if(actual?.roomId!==job.roomId||actual.messageId!==reference.messageId||
     actual.sender?.kind!=='agent'||actual.sender.logicalAgentId!==reference.botId||
     actual.sourceRef?.kind!=='aimp_reply'||actual.sourceRef.taskRef!==reference.taskRef||
     typeof actual.text!=='string'||!task.artifacts.some((artifact:any)=>
      artifact?.ref===`message://${job.roomId}/${reference.messageId}`&&artifact.sha256===digest(actual.text)))return;
  return {reference,unexecuted:unexecutedModelToolOutput(actual.text)};
 }));
 const completedReplies:RecoveryReply[]=[];
 let unexecutedReply:RecoveryReply|undefined;
 for(const check of checks){
  if(!check)continue;
  const {reference,unexecuted}=check;
  if(unexecuted){
   if(marker?.messageId===reference.messageId&&marker.botId===reference.botId&&marker.taskRef===reference.taskRef)unexecutedReply=reference;
  }else completedReplies.push(reference);
 }
 return {
  sourceJobId:prior.id,sourceState:prior.state,draftAvailable:!!(prior.answerDraft||prior.partialText),
  reviewGroupStages:job.recoveryContext?.reviewGroupStages===true,
  failure:failure&&{
   code:typeof failure.code==='string'&&/^[a-z0-9_]{1,80}$/.test(failure.code)?failure.code:'execution_failed',
   phase:['routing','preparing','model','tool','delivery'].includes(failure.phase)?failure.phase:'unknown',
  },
  completedReplies,unexecutedReply,
  limited:results.length>completedReplies.length+Number(!!unexecutedReply)||!!marker&&!unexecutedReply,
 };
}

/** Link a user-requested continuation to preserved evidence. Old runs stay immutable. */
export class WorkRecovery {
 constructor(private upstream: Upstreams, private store: TeamStore, private coordinator: TeamCoordinator) {}
 async wakeSafe(){
  await this.wakeRoutingRecovery();
  await this.wakeModelRecovery();
  await this.wakeCheckpointRecovery();
  await this.wakeUnknownBatch();
  // Only stale approval waits / busy recovery chains are eligible. No unknown runs.
  const rooms=new Set(this.store.jobs().map(job=>job.roomId));
  for(const roomId of rooms){
   const job=latestWork(this.store.jobs(roomId));
   if(memoryReviewRooms(this.store.root).includes(roomId))continue;
   if(job?.state!=='blocked'||!['harness_session_busy','handoff_wait_expired','tool_approval_result_unknown'].includes(job.reason)||this.store.settings(roomId)?.paused||this.store.jobs(roomId).some(job=>active(job)||job.state==='waiting')||this.store.operation('work-recovery:'+job.id))continue;
   const approvals=this.store.operationsWithPrefix('tool-approval:').filter(a=>a.roomId===roomId&&a.durable&&a.botId===job.activeBotId);
   for(const approval of approvals){
    if(job.reason==='tool_approval_result_unknown'&&approval.reason!=='runtime_changed_before_execution')continue;
    const binding=this.store.binding(approval.botId);if(!binding||binding.kind!=='xiaok-hosted'||binding.revision!==approval.bindingRevision||binding.fingerprint!==approval.modelFingerprint)continue;
    let bot:any,cwd:string;try{bot=((await this.upstream.listBots()).agents as any[]).find(bot=>bot.id===approval.botId);cwd=harnessWorkspace(profile(bot).workspace);}catch{continue;}
    if(!bot||profile(bot).revision!==approval.profileRevision||cwd!==(approval.sessionCwd??approval.cwd))continue;
    const scope={root:this.store.root,roomId,botId:approval.botId,bindingRevision:binding.revision,profileRevision:approval.profileRevision,fingerprint:binding.fingerprint,cwd};
    let release:(()=>void)|undefined;
    try{
     const {identity,directory}=harnessLocation(scope,cwd);release=acquireHarnessStorage(directory);
     const core=await sharedRuntime(),snapshot=await new core.FileSessionStore(join(directory,'sessions')).load('kteam_'+identity);
     const session=new core.AgentSessionState();if(!snapshot)continue;session.restoreSnapshot(snapshot);
     const batch=session.getToolBatch();if(!staleToolBatchApproval(this.store,batch,scope))continue;
     // An ended approval wait can block the next independent request in the
     // same session. Retire only that checkpoint; the new work keeps its own
     // origin, admission and approvals. Other recovery reasons stay origin-bound.
     if(job.reason!=='harness_session_busy'&&this.store.job(batch.ownerId)?.originId!==job.originId)continue;
     const autoId='auto-stale-batch:'+batch.ownerId+':'+batch.id;if(this.store.operation(autoId))continue;
     // Release before queue dispatch; opening the runtime revalidates all evidence.
     release();release=undefined;
     await this.continue(roomId,{jobId:job.id,requestId:'auto-stale-approval:'+job.id},autoId);break;
    }catch{/* Scope changes, active locks and unknown evidence remain blocked. */}finally{release?.();}
   }
  }
 }
 /** A lost transport observation is recoverable only after the old run is proved inert.
  * Re-enter normal admission with saved receipts, never replay a tool invocation. */
 private async wakeRoutingRecovery(){
  for(const roomId of new Set(this.store.jobs().map(job=>job.roomId))){
   const job=latestWork(this.store.jobs(roomId)),failure=job&&executionFailure(job),team=this.store.settings(roomId);
   if(!job||job.trigger||job.recoveryOf||job.routingRepair?.attempted||!job.groupPlanPending||team?.kind!=='group'||team.mode!=='auto'||team.paused||team.quiet||job.state!=='blocked'||failure?.code!=='group_plan_invalid'||failure.phase!=='routing'||failure.evidence!=='captured'||job.stopResultUnknown||job.task||job.harness||job.executionScope||job.results?.length||(job.toolTrace??[]).some((event:any)=>!event.type||event.type.startsWith('tool_'))||this.store.jobs(roomId).some(active)||this.store.operation('work-recovery:'+job.id)||memoryReviewRooms(this.store.root).includes(roomId))continue;
   const at=Date.parse(job.createdAt);if(!Number.isFinite(at)||Date.now()-at<0||Date.now()-at>86400000)continue;
   try{const tasks=(await this.upstream.aimp(roomId,'tasks')).tasks as any[];if(!this.view(roomId,tasks)?.canContinue)continue;await this.continue(roomId,{jobId:job.id,requestId:'auto-routing-format:'+job.id},'auto-routing-format:'+job.id);}catch{/* Unverified scope and active work remain stopped; no tools are replayed. */}
  }
 }
 private async wakeModelRecovery(){
  for(const roomId of new Set(this.store.jobs().map(job=>job.roomId))){
   const jobs=this.store.jobs(roomId),job=latestWork(jobs),failure=job&&executionFailure(job);
   if(!job||job.state!=='blocked'||failure?.phase!=='model'||job.stopResultUnknown||!job.finishedAt||Date.now()-Date.parse(job.finishedAt)<5000||this.store.settings(roomId)?.paused||jobs.some(job=>active(job)||job.state==='waiting')||this.store.operation('work-recovery:'+job.id)||memoryReviewRooms(this.store.root).includes(roomId))continue;
   const groupReview=failure.code==='model_connection_failed'&&failure.evidence==='captured'
    &&jobs.some(next=>next.state==='queued'&&next.afterJobId===job.id)&&this.interruptedGroupReview(job);
   if(failure.code!=='execution_admission_unverified'&&!groupReview)continue;
   const autoId=groupReview?'auto-group-review:'+digest(JSON.stringify([roomId,job.originId])):'auto-admission:'+job.id;
   if(this.store.operation(autoId))continue;
   // Every started tool needs its own durable finished receipt. A later model
   // event alone does not prove that external effects or child processes ended.
   const trace=job.toolTrace??[];
   const pending=new Map<string,number>();let unknown=false;for(const event of trace){const key=JSON.stringify([event.runId,event.name]);if(event.type==='tool_started')pending.set(key,(pending.get(key)??0)+1);else if(event.type==='tool_finished'){if(event.state!=='completed')unknown=true;pending.set(key,Math.max(0,(pending.get(key)??0)-1));}}
   if(unknown)continue;
   const suspended=[...pending].filter(([,count])=>count>0);
   if(suspended.some(([key,count])=>count!==1||!trace.some((event:any)=>event.type==='run_suspended'&&event.runId===JSON.parse(key)[0])))continue;
   if(this.store.operationsWithPrefix('harness-process:'+job.id+':').some(row=>row.state!=='stopped'||row.stopConfirmed!==true)||this.store.state('harness-fence:'+job.activeBotId))continue;
   const approvals=this.store.operationsWithPrefix('tool-approval:').filter(row=>row.jobId===job.id);
   if(approvals.some(row=>row.durable?!['completed','denied','superseded'].includes(row.status):row.status==='pending'))continue;
   try{
    const binding=this.store.binding(job.activeBotId);if(!binding||binding.revision!==job.task?.bindingRevision)continue;
    if(suspended.length&&!await this.completedSuspendedTools(job,binding,suspended,approvals))continue;
    if(job.executionScope){const captured=job.executionScope.binding;if(captured?.revision!==binding.revision||captured?.fingerprint!==binding.fingerprint)continue;const bot=((await this.upstream.listBots()).agents as any[]).find(bot=>bot.id===job.activeBotId&&!bot.archivedAt);if(!bot||profile(bot).revision!==job.executionScope.profileRevision)continue;}
    const tasks=(await this.upstream.aimp(roomId,'tasks')).tasks as any[];
    const old=tasks.find(task=>task.taskRef===job.task?.taskRef);
    if(!old||old.state!=='halted')continue;
    await this.continue(roomId,{jobId:job.id,requestId:autoId},autoId);
   }catch{/* Retry observations later. Explicit denial never changes this job's eligibility. */}
  }
 }
 /** A network failure during group review can strand every later message.
  * Reopen that review once for the original user turn, with old stage receipts. */
 private interruptedGroupReview(job:any){
  const settings=this.store.settings(job.roomId),plan=job.groupPlan;
  if(settings?.kind!=='group'||settings.mode!=='auto'||settings.quiet||plan?.mode!=='work'||plan.ownerId!==job.activeBotId||!plan.stageOperations?.some(Boolean)||job.results?.length)return false;
  if((job.toolTrace??[]).some((event:any)=>!event.type||event.type.startsWith('tool_')))return false;
  return plan.stageOperations.filter(Boolean).every((id:string)=>{
   const operation=this.store.operation(id);
   return operation?.jobId===job.id&&operation.roomId===job.roomId&&operation.botId===job.activeBotId&&operation.status==='returned'
    &&operation.results?.length>0&&operation.results.every((result:any)=>['delivered','blocked','stopped','cancelled','noop'].includes(result.state));
  });
 }
 /** A suspended tool emits started before asking for approval, then completes
  * under another run id. Check the real checkpoint instead of pairing run ids. */
 private async completedSuspendedTools(job:any,binding:any,suspended:[string,number][],approvals:any[]){
  if(binding.kind!=='xiaok-hosted'||typeof job.harness?.cwd!=='string')return false;
  const required=new Map<string,number>();for(const [key]of suspended){const name=JSON.parse(key)[1];required.set(name,(required.get(name)??0)+1);}
  for(const [name,count]of required)if(approvals.filter(row=>row.durable&&row.status==='completed'&&row.toolName===name&&row.bindingRevision===binding.revision&&row.modelFingerprint===binding.fingerprint).length<count)return false;
  let release:(()=>void)|undefined;
  try{
   const bot=((await this.upstream.listBots()).agents as any[]).find(bot=>bot.id===job.activeBotId&&!bot.archivedAt);if(!bot||harnessWorkspace(profile(bot).workspace)!==job.harness.cwd)return false;
   if(approvals.some(row=>row.durable&&row.profileRevision!==profile(bot).revision))return false;
   const {identity,directory}=harnessLocation({root:this.store.root,roomId:job.roomId,botId:job.activeBotId,bindingRevision:binding.revision,fingerprint:binding.fingerprint},job.harness.cwd);
   release=acquireHarnessStorage(directory);const core=await sharedRuntime(),snapshot=await new core.FileSessionStore(join(directory,'sessions')).load('kteam_'+identity);
   if(!snapshot||snapshot.cwd!==job.harness.cwd||snapshot.toolBatch||!JSON.stringify(snapshot.messages).includes(job.originId))return false;
   const calls=new Set<string>(),results=new Set<string>();for(const message of snapshot.messages??[])for(const block of message.content??[]){if(block.type==='tool_use'){if(!block.id||calls.has(block.id))return false;calls.add(block.id);}else if(block.type==='tool_result'){if(!block.tool_use_id||results.has(block.tool_use_id))return false;results.add(block.tool_use_id);}}
   return calls.size>0&&[...calls].every(id=>results.has(id))&&[...results].every(id=>calls.has(id));
  }catch{return false;}finally{release?.();}
 }
 /** Reconcile only the legacy checkpoint-only fence. Unknown process shutdowns stay fenced. */
 private async reconcileCheckpointFence(roomId:string,botId:string){
  const fence=this.store.state<any>('harness-fence:'+botId);if(!fence)return true;
  if(fence.reason!=='harness_runtime_close_failed'||typeof fence.jobId!=='string')return false;
  const job=this.store.job(fence.jobId),binding=this.store.binding(botId);
  if(fence.reason!=='harness_runtime_close_failed'||!job||job.roomId!==roomId||job.activeBotId!==botId||job.state!=='blocked'||job.stopResultUnknown||[...(job.toolTrace??[])].reverse().find((event:any)=>['run_failed','run_aborted'].includes(event.type))?.code!=='session_save_locked'||!binding||binding.kind!=='xiaok-hosted')return false;
  const captured=job.recoveryBindings?.[botId];if(!captured||captured.revision!==binding.revision||captured.fingerprint!==binding.fingerprint)return false;
  if(this.store.jobs().some(candidate=>candidate.activeBotId===botId&&(active(candidate)||candidate.state==='waiting')))return false;
  const processes=this.store.operationsWithPrefix('harness-process:'+job.id+':');
  for(const row of processes){
   if(row.state!=='stopped')return false;if(!row.pid)continue;
   try{process.kill(row.pid,0);}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')continue;return false;}
   try{if(sameProcessBirth(processBirth(row.pid),row.birth))return false;}catch{return false;}
  }
  const task=((await this.upstream.aimp(roomId,'tasks')).tasks as any[]).find(task=>task.taskRef===job.task?.taskRef);if(task&&!['halted','delivered','rejected','expired','cancelled'].includes(task.state))return false;
  let release:(()=>void)|undefined;
  try{
   const bot=((await this.upstream.listBots()).agents as any[]).find(bot=>bot.id===botId&&!bot.archivedAt);if(!bot)return false;
   const cwd=harnessWorkspace(profile(bot).workspace);if(job.harness?.cwd!==cwd)return false;
   const {identity,directory}=harnessLocation({root:this.store.root,roomId,botId,bindingRevision:binding.revision,fingerprint:binding.fingerprint},cwd);release=acquireHarnessStorage(directory);
   const core=await sharedRuntime(),sessions=new core.FileSessionStore(join(directory,'sessions')),snapshot=await sessions.load('kteam_'+identity);if(!snapshot)return false;
   // Prove the checkpoint store accepts its saved state. This never executes a pending tool batch.
   await sessions.save(snapshot);
   if(this.store.state<any>('harness-fence:'+botId)?.jobId!==job.id)return false;
   this.store.setState('harness-checkpoint-reconciled:'+job.id,{at:new Date().toISOString(),sessionId:snapshot.sessionId,processIds:processes.map(row=>row.id)});
   this.store.setState('harness-fence:'+botId,null);return true;
  }catch{return false;}finally{release?.();}
 }
 private async wakeCheckpointRecovery(){
  for(const roomId of new Set(this.store.jobs().map(job=>job.roomId))){
   const job=latestWork(this.store.jobs(roomId));
   if(!job||job.state!=='blocked'||!['harness_runtime_close_failed','harness_session_persist_failed','handoff_budget_exhausted'].includes(job.reason)||this.store.settings(roomId)?.paused||this.store.jobs(roomId).some(job=>active(job)||job.state==='waiting')||this.store.operation('work-recovery:'+job.id)||memoryReviewRooms(this.store.root).includes(roomId))continue;
   if(job.reason==='harness_runtime_close_failed'&&!this.store.state('harness-fence:'+job.activeBotId))continue;
   try{
    if(!await this.reconcileCheckpointFence(roomId,job.activeBotId))continue;
    const tasks=(await this.upstream.aimp(roomId,'tasks')).tasks as any[];
    if(!this.view(roomId,tasks)?.canContinue)continue;
    await this.continue(roomId,{jobId:job.id,requestId:'auto-checkpoint:'+job.id},'auto-checkpoint:'+job.id);
   }catch{/* Retry observations on the next tick; no old model/tool action is replayed here. */}
  }
 }
 private async wakeUnknownBatch(){
  for(const roomId of new Set(this.store.jobs().map(job=>job.roomId))){
   const job=latestWork(this.store.jobs(roomId));
   if(!job||!interrupted(job)||!(job.reason==='tool_batch_execution_unknown'||executionFailure(job)?.code==='host_restarted_result_unknown')||this.store.settings(roomId)?.paused||this.store.jobs(roomId).some(job=>active(job)||job.state==='waiting')||this.store.operation('work-recovery:'+job.id)||memoryReviewRooms(this.store.root).includes(roomId))continue;
   const botId=job.activeBotId,binding=this.store.binding(botId);if(!binding||binding.kind!=='xiaok-hosted'||job.stopResultUnknown||this.store.state('harness-fence:'+botId))continue;
   let release:(()=>void)|undefined;
   try{
    const bot=((await this.upstream.listBots()).agents as any[]).find(bot=>bot.id===botId&&!bot.archivedAt);if(!bot)continue;
    const cwd=harnessWorkspace(profile(bot).workspace),{identity,directory}=harnessLocation({root:this.store.root,roomId,botId,bindingRevision:binding.revision,fingerprint:binding.fingerprint},cwd);
    release=acquireHarnessStorage(directory);const core=await sharedRuntime(),snapshot=await new core.FileSessionStore(join(directory,'sessions')).load('kteam_'+identity),batch=snapshot?.toolBatch;
    if(!batch||!['executing','preparing'].includes(batch.state))continue;
    let owner=job;const seen=new Set<string>();while(owner&&owner.id!==batch.ownerId&&!seen.has(owner.id)){seen.add(owner.id);owner=this.store.job(owner.recoveryOf);}
    if(!owner||owner.id!==batch.ownerId||owner.roomId!==roomId||owner.originId!==job.originId||owner.activeBotId!==botId||!interrupted(owner)||owner.stopResultUnknown)continue;
    const autoId='auto-unknown-batch:'+botId+':'+batch.id;if(this.store.operation(autoId))continue;
    release();release=undefined;await this.continue(roomId,{jobId:job.id,requestId:'auto-result-check:'+job.id},autoId);
   }catch{/* Active owners and unverifiable sources are never replayed. */}finally{release?.();}
  }
 }
 view(roomId: string, tasks: any[]) {
  const jobs = this.store.jobs(roomId), job = latestWork(jobs);
  if (!interrupted(job)) return null;
  const continuation = this.store.operation('work-recovery:' + job.id);
  const failure = executionFailure(job);
  const priorTask = tasks.find(task => task.taskRef === job.task?.taskRef);
  const needsStop = priorTask && ['proposed','committed','working','blocked'].includes(priorTask.state);
  return {jobId: job.id, state: job.state, hostInterrupted: failure?.code === 'host_restarted_result_unknown',
   canContinue: !job.artifactPeerReview && !this.store.workPaused() && !this.store.settings(roomId)?.paused && !jobs.some(active) && !needsStop && !continuation,
   reason: this.store.workPaused() || this.store.settings(roomId)?.paused ? 'team_paused' : needsStop ? 'recovery_waiting_stop' : undefined,
   hasGeneratedFiles:this.store.hasGeneratedFiles(roomId,job.id), hasDraft: !!(job.answerDraft || job.partialText), completedReplies: (job.results ?? []).length,
   native: !!job.activeBotId && this.store.binding(job.activeBotId)?.kind === 'local-native'};
 }
 async continue(roomId: string, value: unknown, autoId?:string) {
  const input = record(value); fields(input, ['jobId','requestId','unexecutedReplyId']);
  const jobId = text(input.jobId, 'job_id'), requestId = text(input.requestId, 'request_id', 128);
  await this.coordinator.guardConversation(roomId);
  let prior = this.store.job(jobId);
  let unexecutedReply:any;
  if(input.unexecutedReplyId!==undefined){
   if(autoId||prior?.roomId!==roomId||prior.state!=='delivered'||this.store.jobs(roomId).some(job=>job.state==='waiting'))throw new KTeamError('recovery_unavailable',409);
   const replyId=text(input.unexecutedReplyId,'message_id'),receipt=prior.results?.find((result:any)=>result.messageId===replyId);if(!receipt)throw new KTeamError('recovery_unavailable',409);
   const actual=(await this.upstream.conversationMessage(roomId,replyId)).message as any;
   if(actual.sender?.logicalAgentId!==receipt.botId||actual.sourceRef?.kind!=='aimp_reply'||actual.sourceRef?.taskRef!==receipt.taskRef||!unexecutedModelToolOutput(String(actual.text??'')))throw new KTeamError('recovery_unavailable',409);
   unexecutedReply={messageId:replyId,botId:receipt.botId,taskRef:receipt.taskRef};
   // Local recovery evidence only. The old delivery and canonical artifact stay immutable.
   prior={...prior,state:'blocked',results:prior.results.filter((result:any)=>result!==receipt),failure:{code:'model_response_protocol_invalid',phase:'delivery',botId:receipt.botId,model:receipt.model,at:new Date().toISOString(),evidence:'captured'}};
  }
  if (!prior || prior.roomId !== roomId || !interrupted(prior)) throw new KTeamError('recovery_unavailable', 409);
  if(prior.artifactPeerReview)throw new KTeamError('artifact_peer_restart_required',409);
  const operationId = 'work-recovery:' + jobId, existing = this.store.operation(operationId);
  if (existing) return {ok: true, jobId: existing.jobId, reused: true};
  if (latestWork(this.store.jobs(roomId))?.id !== jobId) throw new KTeamError('recovery_superseded', 409);
  if (this.store.workPaused() || this.store.settings(roomId)?.paused) throw new KTeamError('team_paused', 409);
  if (this.store.jobs(roomId).some(active)) throw new KTeamError('recovery_in_progress', 409);
  const tasks = (await this.upstream.aimp(roomId, 'tasks')).tasks as any[];
  const concurrent = this.store.operation(operationId);
  if (concurrent) return {ok: true, jobId: concurrent.jobId, reused: true};
  if(unexecutedReply){const task=tasks.find(task=>task.taskRef===unexecutedReply.taskRef);if(!task||!['delivered','accepted'].includes(task.state)||task.artifactVerification?.verified!==true)throw new KTeamError('recovery_waiting_stop',409);}
  else if (!this.view(roomId, tasks)?.canContinue) throw new KTeamError('recovery_waiting_stop', 409);
  const members = await this.upstream.membership(roomId);
  const delivered = new Set((prior.results ?? []).map((result: any) => result.botId));
  const botIds = [...new Set<string>([prior.activeBotId, ...(prior.members ?? []), ...(routineWork(prior)?[prior.routine.botId]:[])].filter((id): id is string => !!id && !delivered.has(id)))];
  for (const botId of botIds) {
   if (!this.store.binding(botId) || !(members.members as any[]).some(member => member.status === 'active' && member.subject?.logicalAgentId === botId)) throw new KTeamError('recovery_member_changed', 409);
   if (!await this.reconcileCheckpointFence(roomId,botId)) throw new KTeamError('native_stop_unconfirmed', 409);
  }
  // Scheduled runs have an owner receipt rather than a Room message.
  const routine=routineWork(prior)?await new Routines(this.upstream,this.store).recoverySource(prior):undefined;
  if(!routine)await this.upstream.conversationMessage(roomId, prior.originId);
  await this.coordinator.guardConversation(roomId);
  return this.store.transaction(() => {
   if(autoId&&(this.store.operation(autoId)||this.store.jobs(roomId).some(job=>job.state==='waiting')))throw new KTeamError('recovery_in_progress',409);
   const old = this.store.operation(operationId);
   if (old) return {ok: true, jobId: old.jobId, reused: true};
   if (latestWork(this.store.jobs(roomId))?.id !== jobId || this.store.jobs(roomId).some(active)) throw new KTeamError('recovery_in_progress', 409);
   if (this.store.workPaused() || this.store.settings(roomId)?.paused) throw new KTeamError('team_paused', 409);
   if(routine)new Routines(this.upstream,this.store).assertJob({...prior,trigger:'recovery',routine});
   const nextId = 'job-recovery-' + digest(jobId).slice(0, 32);
   if(autoId)this.store.saveOperation({id:autoId,sourceJobId:jobId,status:'queued'},0);
   this.store.saveOperation({id: operationId, jobId: nextId, sourceJobId: jobId, requestId, status: 'queued'}, 0);
   this.store.enqueueFollowup({id: nextId, roomId, originId: prior.originId, trigger: 'recovery', ...(prior.groupPlanPending||prior.routingRepair?.fallback==='discussion'?{groupPlanPending:true}:{}), ...(prior.groupPlan&&prior.routingRepair?.fallback!=='discussion'?{groupPlan:structuredClone(prior.groupPlan)}:{}), ...(prior.groupResponse?{groupResponse:structuredClone(prior.groupResponse)}:{}), ...(routine?{routine}:{}), recoveryOf: jobId, recoveryAutomatic:!!autoId, recoveryBotIds: botIds,
    recoveryContext: {sourceJobId: jobId,unexecutedReply, reviewGroupStages:prior.groupPlan?.mode==='work'&&!!(prior.recoveryContext?.reviewGroupStages||prior.task||prior.currentHandoffId||prior.groupPlan.stageOperations?.some(Boolean)||this.store.operationsWithPrefix('work-handoff:').some(op=>op.jobId===prior.id))},
    recoveryBindings: Object.fromEntries(botIds.map(id => [id, this.store.binding(id)]))});
   for(const queued of this.store.jobs(roomId).filter(job=>dependent(job)&&job.afterJobId===prior.id)){queued.afterJobId=nextId;this.store.save(queued);}
   return {ok: true, jobId: nextId, reused: false};
  });
 }
}
