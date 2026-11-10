import {KTeamError} from '../errors.js';
import {sharedRuntime} from '../runtime/native.js';
import type {ExecutionFailure} from '../protocol/execution-failure.js';
export function executionFailureCode(error:any){
 if(error instanceof KTeamError)return error.code;
 if(error?.message==='execution_lease_lost')return 'execution_admission_unverified';
 if(error?.status>=500&&error.status<=599)return 'model_service_unavailable';if(error?.status===404)return 'model_endpoint_unavailable';if(error?.status===400)return 'model_request_rejected';if(error?.status===429)return 'model_quota_exhausted';if([401,403].includes(error?.status))return 'model_authentication_failed';
 if(/ConnectionTimeout|RequestTimeout/.test(error?.name??''))return 'model_request_timeout';if(['ECONNREFUSED','ECONNRESET','ENOTFOUND','ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_SOCKET'].includes(error?.cause?.code??error?.code))return 'model_connection_failed';
 if(error?.name==='TimeoutError')return 'execution_timeout';if(error?.name==='AbortError')return 'execution_interrupted';
 if(error?.message==='credential_store_unavailable')return 'credential_store_unavailable';
 return 'model_execution_failed';
}
export async function captureExecutionFailure(error:unknown,job:any,signal:AbortSignal):Promise<ExecutionFailure>{
 const cleanupUnknown=error instanceof KTeamError&&['harness_runtime_close_failed','native_stop_unconfirmed'].includes(error.code);const actual:any=signal.aborted&&!cleanupUnknown?signal.reason:error;let code=executionFailureCode(actual);if(code==='model_execution_failed'&&job.execution?.phase&&!['model','routing'].includes(job.execution.phase))code=job.execution.phase==='tool'?'tool_execution_failed':'execution_failed';
 const failure:ExecutionFailure={code,phase:job.execution?.phase??'unknown',at:new Date().toISOString(),botId:job.execution?.botId??job.activeBotId,model:job.execution?.model,toolName:job.execution?.toolName,evidence:'captured'};
 if(!(actual instanceof KTeamError)&&Number.isInteger(actual?.status)&&actual.status>=100&&actual.status<=599)failure.httpStatus=actual.status;
 if(typeof actual?.name==='string'&&/^[\w. -]{1,60}$/.test(actual.name))failure.exception=actual.name;
 const cause=actual?.details?.causeCode??actual?.cause?.code;if(typeof cause==='string'&&/^[A-Za-z][\w.-]{0,79}$/.test(cause))failure.causeCode=cause;
 if(!(actual instanceof KTeamError)&&typeof actual?.message==='string'){
  try{const core=await sharedRuntime();failure.message=core.redactSecrets(actual.message).text.replace(/https?:\/\/[^\s<>"']+/g,(value:string)=>{try{const url=new URL(value);url.username='';url.password='';url.search='';url.hash='';return url.toString();}catch{return '[接口地址]';}}).slice(0,1000);}catch{/* Failure diagnostics must never mask the original failure. */}
 }
 return failure;
}
