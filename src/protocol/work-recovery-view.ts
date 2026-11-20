type RecoveryCandidate = {
 id:string;
 roomId:string;
 state:string;
 reason?:string;
 trigger?:string;
 groupResponse?:unknown;
 groupInput?:unknown;
 afterJobId?:string;
};

const background = new Set(['assistant-notice','peer','followup','regenerate']);
const interrupted = new Set(['blocked','unknown','stopped']);
const dispatchedDiscussion = (job:RecoveryCandidate) => job.state==='noop'&&job.reason==='group_discussion_dispatched';

export function dependentWork(job:RecoveryCandidate) {
 return ['queued','held'].includes(job.state)&&typeof job.afterJobId==='string';
}

/** Receipts and dependent messages do not own the current conversation work. */
export function latestWorkRoot<T extends RecoveryCandidate>(jobs:readonly T[]):T|undefined {
 const roots=jobs.filter(job=>!job.groupResponse&&!job.groupInput&&!dependentWork(job)&&!background.has(job.trigger??''));
 const latest=roots[0];
 if(!latest||!dispatchedDiscussion(latest))return latest;
 const prior=roots.find(job=>!dispatchedDiscussion(job));
 // A discussion can finish while an interrupted workflow still owns queued messages.
 return prior&&interrupted.has(prior.state)&&jobs.some(job=>job.roomId===prior.roomId&&dependentWork(job)&&job.afterJobId===prior.id)?prior:latest;
}

/** Require both the current root and a matching recovery projection from the host. */
export function currentRecoveryJob<T extends RecoveryCandidate>(roomId:string|undefined,jobs:readonly T[],recovery?:{jobId?:string}|null):T|undefined{
 if(!roomId||!recovery?.jobId)return;
 const job=latestWorkRoot(jobs.filter(job=>job.roomId===roomId));
 if(job?.id===recovery.jobId&&interrupted.has(job.state))return job;
}

/** Phone notice uses the same root as the desktop. The newest job is not the root. */
export function mobileRecoveryNotice<T extends RecoveryCandidate>(roomId:string|undefined,work?:{jobs?:readonly T[];recovery?:{jobId?:string}|null}|null):T|undefined{
 if(!work?.jobs)return;
 return currentRecoveryJob(roomId,work.jobs,work.recovery);
}
