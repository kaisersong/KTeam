import {executionFailure} from './execution-failure.js';
const codes=new Set(['model_response_protocol_invalid','model_authentication_failed','model_quota_exhausted','model_service_unavailable','model_endpoint_unavailable','model_request_rejected','model_request_timeout','model_connection_failed','group_plan_invalid','group_dependency_cycle','routing_invalid','iteration_budget_exhausted','group_research_evidence_missing','model_tool_approval_unavailable']);
const background=new Set(['peer','followup','assistant-notice','regenerate']);
/** Surface the latest request's model blocker independently of execution recovery eligibility. */
export function currentModelFailure(roomId:string|undefined,jobs:any[]){
 if(!roomId)return;
 const relevant=jobs.filter(job=>job.roomId===roomId&&!background.has(job.trigger));
 const latest=relevant[0];if(!latest)return;
 const current=relevant.filter(job=>job.originId===latest.originId),seen=new Set<string>();
 for(const job of current){
  const failure=executionFailure(job),key=job.trigger==='group-discussion'?'routing':failure?.botId??job.activeBotId??job.groupResponse?.botId??job.execution?.botId??job.id;
  // A retry replaces only its own member/phase; another member's reply cannot hide this blocker.
  if(seen.has(key))continue;seen.add(key);
  if(failure&&codes.has(failure.code))return {job,failure};
  if(job===latest&&!['group-response','group-discussion'].includes(job.trigger))return;
 }
}
export function modelFailureMessage(code:string,phase:string){
 const reason=code==='model_response_protocol_invalid'?'模型响应格式不完整，或返回了未执行的工具请求文本':code==='model_tool_approval_unavailable'?'当前模型与这类任务的工具执行不兼容':code==='iteration_budget_exhausted'?'成员尚未提交完整答复，已有查证记录已保留':code==='group_research_evidence_missing'?'尚未取得有效的源码或原始资料读取回执':['group_plan_invalid','group_dependency_cycle','routing_invalid'].includes(code)?'群聊分工方案未通过校验，尚未安排成员执行':code==='model_authentication_failed'?'模型凭据无效或没有访问权限':code==='model_quota_exhausted'?'模型额度不足或请求受到限流':code==='model_service_unavailable'?'模型服务暂时不可用':code==='model_endpoint_unavailable'?'模型接口地址或模型名称不可用':code==='model_request_rejected'?'模型服务拒绝了这次请求':code==='model_request_timeout'?'等待模型响应超时':'无法连接模型服务';
 return {title:phase==='routing'?'群聊未能安排成员回复':'成员暂时无法回复',reason,
  guidance:code==='model_response_protocol_invalid'?'已完成的工具结果已保留。请核对记录后继续；若重复出现，请检查当前模型接口的兼容性。':phase==='routing'?'这次未能完成成员分派，后续成员尚未开始处理。':'这次模型请求未能完成，已有消息和工作记录已保留。'};
}
