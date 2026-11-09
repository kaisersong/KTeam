export interface Bot {id:string;name:string;binding?:{modelId:string;model:string;kind:string;revision:number}|null}
export interface Room {roomId:string;title:string;description?:string;kind?:'assistant'|'direct'|'group'}
export interface Message {messageId:string;roomId?:string;sender:{kind:string;logicalAgentId?:string};text?:string;roomSequence:number;createdAt?:string;workRef?:string}
export interface KTeamAPI {
 resumeCreation(input:{id:string}):Promise<any>;inbox():Promise<any>;bootstrap():Promise<{roomId:string;botId:string}>;direct(input:{botId:string}):Promise<{roomId:string}>;proposals(roomId:string):Promise<any>;acceptProposal(input:{roomId:string;proposalId:string;expectedHash:string}):Promise<{roomId:string}>;
 status():Promise<any>;bots():Promise<{bots:Bot[]}>;teams():Promise<{rooms:Room[]}>;models():Promise<any>;runtimes():Promise<any>;
 createBot(input:{name:string;modelId:string;requestId:string}):Promise<any>;
 createTeam(input:{title:string;goal:string;memberAgentIds:string[];requestId:string}):Promise<any>;
 send(input:{roomId:string;text:string;id:string}):Promise<any>;
 messages(input:{roomId:string;after?:number;before?:number;tail?:boolean;limit?:number}):Promise<{messages:Message[];hasMoreBefore?:boolean}>;
 settings(roomId:string):Promise<any>;work(roomId:string):Promise<any>;pause(roomId:string):Promise<any>;resume(roomId:string):Promise<any>;
 seen(input:{roomId:string;sequences:number[]}):Promise<any>;review(input:{roomId:string;taskRef:string;decision:'pass'|'rework'}):Promise<any>;
 reconcile(roomId:string):Promise<any>;
}
declare global{interface Window{kteam?:KTeamAPI}}
async function dev(method:string,args:unknown[]){
 const response=await fetch('/__kteam_rpc',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({method,args})});
 const result=await response.json();if(!response.ok||result.ok===false)throw new Error(result.code??'服务请求失败');return result;
}
export const api:KTeamAPI=window.kteam??new Proxy({} as KTeamAPI,{get:(_target,key:string)=>(...args:unknown[])=>dev(key,args)});
const reasons:Record<string,string>={conversation_identity_changed:'会话成员或目标已变化，已暂停发送。请核对会话详情',conversation_contract_changed:'会话目标或规则已变化，请核对后重新创建方案',operation_receipt_missing:'原创建结果暂不可用，已停止后续操作，请稍后核对',proposal_expired:'组队方案已过期，请让小K重新准备',proposal_changed:'方案已变化，请刷新后确认',proposal_scope_mismatch:'方案与当前会话不一致，请重新打开原会话',operation_result_unknown:'创建结果待核对，原结果确认前不会重复创建。请稍后重试核对',operation_owner_changed:'后台已更新，请刷新后核对结果',member_identity_changed:'成员信息已变化，请让小K重新准备方案',

 broker_unavailable:'协作消息服务尚未连接',kswarm_unavailable:'项目与成员服务尚未连接',upstream_protocol_unavailable:'请先连接小K协作服务',
 aimp_unavailable:'当前协作服务需要升级以支持 KTeam',model_quota_exhausted:'模型额度不足，已停止本次工作',model_authentication_failed:'模型登录已失效，请在小K中更新凭据',
 credential_store_unavailable:'模型凭据暂不可用，请检查小K的凭据存储设置',team_budget_exhausted:'本次或当天调用预算已用完',model_binding_changed:'模型配置发生变化，请重新绑定后继续',
 team_stopped:'团队工作已停止',model_execution_failed:'模型执行失败，请检查服务状态',team_has_no_bound_agents:'团队成员尚未绑定 KTeam 执行方式',
 origin_message_missing:'原消息不可用',aimp_session_required:'团队协作契约尚未建立',stop_protocol_result_unknown:'停止请求的协议结果未知，模型调用已中止',
 upstream_operation_unknown:'发送结果待核对，请先核对结果。重复发送会沿用同一编号。',team_scope_changed:'团队设置已变化，本次工作已停止',team_paused:'团队已暂停，未开工的消息会在继续后处理',host_restarted_result_unknown:'主机曾重新启动，旧工作结果待核对，不会自动重放',
};
export const explain=(error:unknown)=>{const code=error instanceof Error?error.message:String(error);return reasons[code]??code;};
