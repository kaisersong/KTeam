type RecoveryCandidate = {
 id:string;
 roomId:string;
 state:string;
 trigger?:string;
 groupResponse?:unknown;
 groupInput?:unknown;
 afterJobId?:string;
};

const background = new Set(['assistant-notice','peer','followup','regenerate']);

export function dependentWork(job:RecoveryCandidate) {
 return ['queued','held'].includes(job.state)&&typeof job.afterJobId==='string';
}

/** Receipts and dependent messages do not own the current conversation work. */
export function latestWorkRoot<T extends RecoveryCandidate>(jobs:readonly T[]):T|undefined {
 return jobs.find(job=>!job.groupResponse&&!job.groupInput&&!dependentWork(job)&&!background.has(job.trigger??''));
}

/** Require both the current root and a matching recovery projection from the host. */
export function currentRecoveryJob<T extends RecoveryCandidate>(roomId:string|undefined,jobs:readonly T[],recovery?:{jobId?:string}|null):T|undefined{
 if(!roomId||!recovery?.jobId)return;
 const job=latestWorkRoot(jobs.filter(job=>job.roomId===roomId));
 if(job?.id===recovery.jobId&&['blocked','unknown','stopped'].includes(job.state))return job;
}
