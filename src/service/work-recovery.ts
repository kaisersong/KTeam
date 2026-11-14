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

const interrupted = (job: any) => job && ['stopped','unknown','blocked'].includes(job.state) && !['peer','followup','assistant-notice','regenerate'].includes(job.trigger);
const active = (job: any) => ['queued','held','routing','running','stopping'].includes(job.state);
const latestWork = (jobs:any[]) => jobs.find(job=>!['assistant-notice','peer','followup','regenerate'].includes(job.trigger));
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

/** Link a user-requested continuation to preserved evidence. Old runs stay immutable. */
export class WorkRecovery {
 constructor(private upstream: Upstreams, private store: TeamStore, private coordinator: TeamCoordinator) {}
 async wakeSafe(){
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
   if (this.store.state('harness-fence:' + botId)) throw new KTeamError('native_stop_unconfirmed', 409);
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
   this.store.enqueueFollowup({id: nextId, roomId, originId: prior.originId, trigger: 'recovery', ...(routine?{routine}:{}), recoveryOf: jobId, recoveryAutomatic:!!autoId, recoveryBotIds: botIds,
    recoveryContext: {sourceJobId: jobId, failure: executionFailure(prior), draft: String(prior.answerDraft ?? prior.partialText ?? '').slice(-16000),
     completedReplies: prior.results ?? [], recentTools: (prior.toolTrace ?? []).slice(-12)},
    recoveryBindings: Object.fromEntries(botIds.map(id => [id, this.store.binding(id)]))});
   return {ok: true, jobId: nextId, reused: false};
  });
 }
}
