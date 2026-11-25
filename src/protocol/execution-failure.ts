export type ExecutionPhase='routing'|'preparing'|'model'|'tool'|'delivery'|'unknown';
export interface ExecutionFailure{code:string;phase:ExecutionPhase;at:string;botId?:string;model?:string;toolName?:string;httpStatus?:number;exception?:string;message?:string;causeCode?:string;evidence:'captured'|'legacy-inferred'|'legacy-unavailable'}
const diagnosticCodes=new Set([
 'builtin_runtime_unavailable','native_probe_required','native_probe_response_invalid','native_probe_interrupted','native_installation_changed',
 'model_binding_changed','model_tool_approval_unavailable','model_authentication_failed','model_endpoint_unavailable','model_connection_failed',
 'model_request_timeout','model_quota_exhausted','model_service_unavailable','model_execution_failed','model_response_protocol_invalid',
 'credential_store_unavailable','tool_approval_changed','execution_admission_unverified','host_restarted_result_unknown',
 'routine_readonly_tool_refused','execution_interrupted','execution_timeout','execution_failed','tool_execution_failed','native_stop_unconfirmed','harness_runtime_close_failed',
]);
const diagnosticPhases=new Set<ExecutionPhase>(['routing','preparing','model','tool','delivery','unknown']);
export function executionDiagnostic(job:any){
 const failure=executionFailure(job);
 if(!failure)return;
 const phase=diagnosticPhases.has(failure.phase)?failure.phase:'unknown';
 const code=diagnosticCodes.has(failure.code)?failure.code:'unclassified';
 const mode=job.routine?.mode==='read-only'||job.harness?.permissionMode==='read-only'?'read-only':job.harness?.permissionMode==='default'?'host-policy':'unknown';
 const next=code==='model_authentication_failed'||code==='credential_store_unavailable'?'检查模型连接和安全凭据':
  code==='native_probe_required'||code==='native_probe_response_invalid'||code==='native_installation_changed'?'在 Agent 设置中重新验证当前安装':
   code==='tool_approval_changed'?'返回原工作查看当前审批':
    code==='routine_readonly_tool_refused'?'本次只读试运行已拒绝工具操作':
    '先核对原工作的回执和执行状态';
 const at=typeof failure.at==='string'?Date.parse(failure.at):NaN;
 return {
  version:1,phase,code,mode,
  evidence:failure.evidence==='captured'?'captured':'limited',
  ...(Number.isFinite(at)?{at:new Date(at).toISOString()}:{}),
  ...(Number.isInteger(failure.httpStatus)&&failure.httpStatus!>=100&&failure.httpStatus!<=599?{httpStatus:failure.httpStatus}:{}),
  next,
 };
}
export function executionFailure(job:any):ExecutionFailure|undefined{
 if(!job||!['blocked','unknown','stopped'].includes(job.state))return;
 if(['harness_runtime_close_failed','native_stop_unconfirmed'].includes(job.failure?.code))return job.failure;
 if(job.interruption?.reason==='host_shutdown')return {...job.failure,code:'host_restarted_result_unknown',phase:job.failure?.phase??job.execution?.phase??'unknown',at:job.interruption.at,evidence:'captured',...(job.failure?.code?{causeCode:job.failure.code}:{} )};
 const previousNetworkFailure=job.failure?.code==='model_execution_failed'&&job.failure.phase==='model'&&/^(?:模型供应商|GLM|Kimi|kteam )?模型网络连接中断(?:（[^）]*）)?；自动恢复窗口不足或已耗尽/.test(job.failure.message??'');
 if(previousNetworkFailure)return {...job.failure,code:'model_connection_failed'};
 if(job.failure?.message==='KIMI_REASONING_ADMISSION_REQUIRED'&&job.failure.code==='model_execution_failed')return {...job.failure,code:'model_response_protocol_invalid'};
 if(job.failure?.message==='tool_batch_profile_unavailable'&&job.failure.code==='execution_failed')return {...job.failure,code:'model_tool_approval_unavailable'};
 if(job.failure)return job.failure.message==='host_shutdown'?{...job.failure,code:'host_restarted_result_unknown'}:job.failure;
 const trace=job.toolTrace??[],aborted=[...trace].reverse().find(e=>e.type==='run_aborted'||e.name==='run_aborted'),lastActivity=[...trace].reverse().find(e=>['tool_started','model_request_started'].includes(e.type)),lastTool=lastActivity?.type==='tool_started'?lastActivity:undefined;
 return {code:job.reason==='model_execution_failed'&&aborted?'execution_interrupted':job.reason??'execution_failed',phase:aborted&&lastTool?'tool':'unknown',at:aborted?.startedAt??job.finishedAt??job.createdAt,botId:job.activeBotId,toolName:aborted?lastTool?.name:undefined,evidence:aborted?'legacy-inferred':'legacy-unavailable'};
}
