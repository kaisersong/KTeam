export type ExecutionPhase='routing'|'preparing'|'model'|'tool'|'delivery'|'unknown';
export interface ExecutionFailure{code:string;phase:ExecutionPhase;at:string;botId?:string;model?:string;toolName?:string;httpStatus?:number;exception?:string;message?:string;causeCode?:string;evidence:'captured'|'legacy-inferred'|'legacy-unavailable'}
export function executionFailure(job:any):ExecutionFailure|undefined{
 if(!job||!['blocked','unknown','stopped'].includes(job.state))return;
 if(job.failure)return job.failure.message==='host_shutdown'?{...job.failure,code:'host_restarted_result_unknown'}:job.failure;
 const trace=job.toolTrace??[],aborted=[...trace].reverse().find(e=>e.type==='run_aborted'||e.name==='run_aborted'),lastActivity=[...trace].reverse().find(e=>['tool_started','model_request_started'].includes(e.type)),lastTool=lastActivity?.type==='tool_started'?lastActivity:undefined;
 return {code:job.reason==='model_execution_failed'&&aborted?'execution_interrupted':job.reason??'execution_failed',phase:aborted&&lastTool?'tool':'unknown',at:aborted?.startedAt??job.finishedAt??job.createdAt,botId:job.activeBotId,toolName:aborted?lastTool?.name:undefined,evidence:aborted?'legacy-inferred':'legacy-unavailable'};
}
