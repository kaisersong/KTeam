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
import type {Upstreams} from '../adapters/upstream.js';
import type {TeamCoordinator} from './coordination.js';
import type {TeamStore} from './team-store.js';

const interrupted = (job: any) => job && !job.groupResponse&& ['stopped','unknown','blocked'].includes(job.state) && !['peer','followup','assistant-notice','regenerate'].includes(job.trigger);
const dependent = (job:any) => ['queued','held'].includes(job.state)&&typeof job.afterJobId==='string';
const active = (job: any) => !dependent(job)&&['queued','held','routing','running','stopping'].includes(job.state);
const latestWork = (jobs:any[]) => jobs.find(job=>!job.groupResponse&&!dependent(job)&&!['assistant-notice','peer','followup','regenerate'].includes(job.trigger));
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

/** Link a user-requested continuation to preserved evidence. Old runs stay immutable. */
export class WorkRecovery {
 constructor(private upstream: Upstreams, private store: TeamStore, private coordinator: TeamCoordinator) {}
 async wakeSafe(){
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
     const batch=session.getToolBatch();if(!staleToolBatchApproval(this.store,batch,scope)||this.store.job(batch.ownerId)?.originId!==job.originId)continue;
     const autoId='auto-stale-batch:'+batch.ownerId+':'+batch.id;if(this.store.operation(autoId))continue;
     // Release before queue dispatch; opening the runtime revalidates all evidence.
     release();release=undefined;
     await this.continue(roomId,{jobId:job.id,requestId:'auto-stale-approval:'+job.id},autoId);break;
    }catch{/* Scope changes, active locks and unknown evidence remain blocked. */}finally{release?.();}
   }
  }
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
   canContinue: !this.store.settings(roomId)?.paused && !jobs.some(active) && !needsStop && !continuation,
   reason: this.store.settings(roomId)?.paused ? 'team_paused' : needsStop ? 'recovery_waiting_stop' : undefined,
   hasGeneratedFiles:this.store.hasGeneratedFiles(roomId,job.id), hasDraft: !!(job.answerDraft || job.partialText), completedReplies: (job.results ?? []).length,
   native: !!job.activeBotId && this.store.binding(job.activeBotId)?.kind === 'local-native'};
 }
 async continue(roomId: string, value: unknown, autoId?:string) {
  const input = record(value); fields(input, ['jobId','requestId']);
  const jobId = text(input.jobId, 'job_id'), requestId = text(input.requestId, 'request_id', 128);
  await this.coordinator.guardConversation(roomId);
  const prior = this.store.job(jobId);
  if (!prior || prior.roomId !== roomId || !interrupted(prior)) throw new KTeamError('recovery_unavailable', 409);
  const operationId = 'work-recovery:' + jobId, existing = this.store.operation(operationId);
  if (existing) return {ok: true, jobId: existing.jobId, reused: true};
  if (latestWork(this.store.jobs(roomId))?.id !== jobId) throw new KTeamError('recovery_superseded', 409);
  if (this.store.settings(roomId)?.paused) throw new KTeamError('team_paused', 409);
  if (this.store.jobs(roomId).some(active)) throw new KTeamError('recovery_in_progress', 409);
  const tasks = (await this.upstream.aimp(roomId, 'tasks')).tasks as any[];
  const concurrent = this.store.operation(operationId);
  if (concurrent) return {ok: true, jobId: concurrent.jobId, reused: true};
  if (!this.view(roomId, tasks)?.canContinue) throw new KTeamError('recovery_waiting_stop', 409);
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
   if (this.store.settings(roomId)?.paused) throw new KTeamError('team_paused', 409);
   if(routine)new Routines(this.upstream,this.store).assertJob({...prior,trigger:'recovery',routine});
   const nextId = 'job-recovery-' + digest(jobId).slice(0, 32);
   if(autoId)this.store.saveOperation({id:autoId,sourceJobId:jobId,status:'queued'},0);
   this.store.saveOperation({id: operationId, jobId: nextId, sourceJobId: jobId, requestId, status: 'queued'}, 0);
   this.store.enqueueFollowup({id: nextId, roomId, originId: prior.originId, trigger: 'recovery', ...(prior.groupPlanPending?{groupPlanPending:true}:{}), ...(prior.groupPlan?{groupPlan:structuredClone(prior.groupPlan)}:{}), ...(prior.groupResponse?{groupResponse:structuredClone(prior.groupResponse)}:{}), ...(routine?{routine}:{}), recoveryOf: jobId, recoveryAutomatic:!!autoId, recoveryBotIds: botIds,
    recoveryContext: {sourceJobId: jobId, failure: executionFailure(prior), draft: String(prior.answerDraft ?? prior.partialText ?? '').slice(-16000),
     completedReplies: prior.results ?? [], recentTools: (prior.toolTrace ?? []).slice(-12)},
    recoveryBindings: Object.fromEntries(botIds.map(id => [id, this.store.binding(id)]))});
   for(const queued of this.store.jobs(roomId).filter(job=>dependent(job)&&job.afterJobId===prior.id)){queued.afterJobId=nextId;this.store.save(queued);}
   return {ok: true, jobId: nextId, reused: false};
  });
 }
}
