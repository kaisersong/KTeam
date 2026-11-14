/** Only the owner-selected current run belongs in the conversation recovery notice. */
export function currentRecoveryJob<T extends {id:string;roomId:string;state:string}>(roomId:string|undefined,jobs:T[],recovery?:{jobId?:string}|null):T|undefined{
 const job=jobs[0];
 if(!roomId||!recovery?.jobId||!job||job.id!==recovery.jobId||job.roomId!==roomId||!['blocked','unknown','stopped'].includes(job.state))return;
 return job;
}
