import {createHash} from 'node:crypto';
import {KTeamError, fields, record, text} from '../errors.js';
import {executionFailure} from '../protocol/execution-failure.js';
import type {Upstreams} from '../adapters/upstream.js';
import type {TeamCoordinator} from './coordination.js';
import type {TeamStore} from './team-store.js';

const interrupted = (job: any) => job && ['stopped','unknown','blocked'].includes(job.state) && !['peer','followup','assistant-notice','regenerate'].includes(job.trigger);
const active = (job: any) => ['queued','held','routing','running','stopping'].includes(job.state);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

/** Link a user-requested continuation to preserved evidence. Old runs stay immutable. */
export class WorkRecovery {
 constructor(private upstream: Upstreams, private store: TeamStore, private coordinator: TeamCoordinator) {}
 view(roomId: string, tasks: any[]) {
  const jobs = this.store.jobs(roomId), job = jobs[0];
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
 async continue(roomId: string, value: unknown) {
  const input = record(value); fields(input, ['jobId','requestId']);
  const jobId = text(input.jobId, 'job_id'), requestId = text(input.requestId, 'request_id', 128);
  await this.coordinator.guardConversation(roomId);
  const prior = this.store.job(jobId);
  if (!prior || prior.roomId !== roomId || !interrupted(prior)) throw new KTeamError('recovery_unavailable', 409);
  const operationId = 'work-recovery:' + jobId, existing = this.store.operation(operationId);
  if (existing) return {ok: true, jobId: existing.jobId, reused: true};
  if (this.store.jobs(roomId)[0]?.id !== jobId) throw new KTeamError('recovery_superseded', 409);
  if (this.store.settings(roomId)?.paused) throw new KTeamError('team_paused', 409);
  if (this.store.jobs(roomId).some(active)) throw new KTeamError('recovery_in_progress', 409);
  const tasks = (await this.upstream.aimp(roomId, 'tasks')).tasks as any[];
  const concurrent = this.store.operation(operationId);
  if (concurrent) return {ok: true, jobId: concurrent.jobId, reused: true};
  if (!this.view(roomId, tasks)?.canContinue) throw new KTeamError('recovery_waiting_stop', 409);
  const members = await this.upstream.membership(roomId);
  const delivered = new Set((prior.results ?? []).map((result: any) => result.botId));
  const botIds = [...new Set<string>([prior.activeBotId, ...(prior.members ?? [])].filter((id): id is string => !!id && !delivered.has(id)))];
  for (const botId of botIds) {
   if (!this.store.binding(botId) || !(members.members as any[]).some(member => member.status === 'active' && member.subject?.logicalAgentId === botId)) throw new KTeamError('recovery_member_changed', 409);
   if (this.store.state('harness-fence:' + botId)) throw new KTeamError('native_stop_unconfirmed', 409);
  }
  // Fetch the original request from its own Room, even when it is outside the current page.
  await this.upstream.conversationMessage(roomId, prior.originId);
  await this.coordinator.guardConversation(roomId);
  return this.store.transaction(() => {
   const old = this.store.operation(operationId);
   if (old) return {ok: true, jobId: old.jobId, reused: true};
   if (this.store.jobs(roomId)[0]?.id !== jobId || this.store.jobs(roomId).some(active)) throw new KTeamError('recovery_in_progress', 409);
   if (this.store.settings(roomId)?.paused) throw new KTeamError('team_paused', 409);
   const nextId = 'job-recovery-' + digest(jobId).slice(0, 32);
   this.store.saveOperation({id: operationId, jobId: nextId, sourceJobId: jobId, requestId, status: 'queued'}, 0);
   this.store.enqueueFollowup({id: nextId, roomId, originId: prior.originId, trigger: 'recovery', recoveryOf: jobId, recoveryBotIds: botIds,
    recoveryContext: {sourceJobId: jobId, failure: executionFailure(prior), draft: String(prior.answerDraft ?? prior.partialText ?? '').slice(-16000),
     completedReplies: prior.results ?? [], recentTools: (prior.toolTrace ?? []).slice(-12)},
    recoveryBindings: Object.fromEntries(botIds.map(id => [id, this.store.binding(id)]))});
   return {ok: true, jobId: nextId, reused: false};
  });
 }
}
