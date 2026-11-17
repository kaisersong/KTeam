import {KTeamError} from '../errors.js';
const HOUR=60*60_000;
/** Independent work gets an hour. Sequential group stages also need time for
 * their member executions and the coordinator's final review. New contracts
 * only: an existing task's agreed deadline is never silently extended. */
export function newWorkDeadline(job:any,now=Date.now()){
 const stages=job?.groupPlan?.stages;
 const count=job?.groupPlan?.mode==='work'&&!job.groupResponse&&Array.isArray(stages)?stages.length:0;
 if(!Number.isSafeInteger(count)||count>8)throw new KTeamError('group_plan_invalid',409);
 return new Date(now+HOUR*(1+count)).toISOString();
}
export function executionWindowMs(task:any,now=Date.now()){
 const deadline=Date.parse(task?.terms?.deadline);
 if(!Number.isFinite(deadline))throw new KTeamError('execution_deadline_invalid',409);
 return Math.max(0,Math.min(HOUR,deadline-now));
}
/** Omitted timeout means wait within the original contract. Explicit shorter
 * waits remain binding; approval and condition waits use their own deadlines. */
export function memberHandoffDeadline(task:any,minutes:number|undefined,now=Date.now()){
 const deadline=Date.parse(task?.terms?.deadline);
 if(!Number.isFinite(deadline))throw new KTeamError('execution_deadline_invalid',409);
 if(minutes!==undefined&&(!Number.isSafeInteger(minutes)||minutes<1||minutes>60))throw new KTeamError('handoff_input_invalid');
 return minutes===undefined?deadline:Math.min(deadline,now+minutes*60_000);
}
