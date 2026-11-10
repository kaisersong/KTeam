export interface Bot {isAssistant?:boolean;id:string;name:string;binding?:{modelId:string;model:string;kind:string;revision:number}|null;connection?:any;description?:string;instructions?:string;profile?:any}
export interface Room {pinnedAt?:string|null;memberAgentIds?:string[];botId?:string;roomId:string;title:string;description?:string;kind?:'assistant'|'direct'|'group'|'peer'}
export interface Message {messageId:string;roomId?:string;sender:{kind:string;logicalAgentId?:string};text?:string;roomSequence:number;createdAt?:string;workRef?:string;sourceRef?:any;replyToMessageId?:string}
export interface KTeamAPI {
 toolPermissions():Promise<any>;revokeToolPermission(input:{id:string}):Promise<any>;
 integrationSettings():Promise<any>;saveIntegrationSettings(input:any):Promise<any>;testIntegration(input:any):Promise<any>;importProviderModels(input:any):Promise<any>;voiceOptions():Promise<any>;previewVoice():Promise<any>;transcribeAudio(input:any):Promise<any>;
 legacySharedNotice():Promise<{ok:true;show:boolean}>;dismissLegacySharedNotice():Promise<{ok:true;show:boolean}>;
 appPreferences():Promise<any>;saveAppPreferences(input:any):Promise<any>;appResources():Promise<any>;openSettingsLocation(input:any):Promise<any>;
 reconnectServices():Promise<any>;modelSettings():Promise<any>;saveModel(input:any):Promise<any>;setCredentialStorage(input:any):Promise<any>;saveDecisionModels(input:any):Promise<any>;
 pinConversation(input:{roomId:string;pinned:boolean}):Promise<{ok:boolean;pinnedAt:string|null}>;
 peerExchanges(input:{roomId:string;originIds:string[]}):Promise<{exchanges:import('../../../src/service/peer-exchanges').PeerExchange[]}>;peerExchangeMessages(input:{roomId:string;exchangeId:string}):Promise<any>;
 decisionModels():Promise<any>;assistantState():Promise<any>;setAssistantProactivity(input:{enabled:boolean}):Promise<any>;
 botQuestions():Promise<any>;answerBotQuestion(input:any):Promise<any>;
 toolApprovals():Promise<any>;decideToolApproval(input:any):Promise<any>;
 conversationData(input?:any):Promise<any>;
 saveShared(input?:any):Promise<any>;
 messageState(input?:any):Promise<any>;
 conversationMessage(input?:any):Promise<any>;
 searchConversation(input?:any):Promise<any>;
 importLibrary(input?:any):Promise<any>;
 previewLibrary(input?:any):Promise<any>;
 removeLibrary(input?:any):Promise<any>;
 computer(input?:any):Promise<any>;
 usage(input?:any):Promise<any>;
 regenerate(input?:any):Promise<any>;
 newConversation(input?:any):Promise<any>;
 openLibrary(input?:any):Promise<any>;
 readAloud(input?:any):Promise<any>;
 stopSpeech(input?:any):Promise<any>;
 speechStatus(input?:any):Promise<any>;
 exportConversation(input?:any):Promise<any>;
 chooseWorkspace(input?:any):Promise<any>;

 builtinAgent(modelId?:string):Promise<any>;probeBuiltinAgent(input:{modelId:string}):Promise<any>;
 localAgents():Promise<any>;probeLocalAgent(input:any):Promise<any>;localAgentProbe(driver:string):Promise<any>;bindLocalAgent(input:any):Promise<any>;createLocalBot(input:any):Promise<any>;saveBot(input:any):Promise<any>;onboarding():Promise<any>;saveOnboarding(input:any):Promise<any>;createFirstBot(input:any):Promise<any>;finishOnboarding(input:any):Promise<any>;agentConnections():Promise<any>;inviteAgent(input:any):Promise<any>;agentInvitation(id:string):Promise<any>;approveAgent(input:any):Promise<any>;revokeAgent(id:string):Promise<any>;useSystemAgent(input:any):Promise<any>;editGroup(input:any):Promise<any>;
 resumeCreation(input:{id:string}):Promise<any>;inbox():Promise<any>;bootstrap():Promise<{roomId:string;botId:string}>;direct(input:{botId:string}):Promise<{roomId:string}>;proposals(roomId:string):Promise<any>;acceptProposal(input:{roomId:string;proposalId:string;expectedHash:string}):Promise<{roomId:string}>;
 status():Promise<any>;bots():Promise<{bots:Bot[]}>;teams():Promise<{rooms:Room[]}>;models():Promise<any>;runtimes():Promise<any>;
 createBot(input:{name:string;modelId:string;requestId:string;expectedFingerprint?:string}):Promise<any>;
 createTeam(input:{title:string;goal?:string;memberAgentIds:string[];requestId:string}):Promise<any>;
 send(input:{roomId:string;text:string;id:string;replyToMessageId?:string}):Promise<any>;
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
const reasons:Record<string,string>={
 tool_permission_changed:'此授权已变化，请刷新列表',tool_permission_once_required:'此操作需要逐次确认',
 invalid_profile_name:'请输入 1–40 个字符的名字，不含换行或控制字符',invalid_profile_avatar:'图片无法读取，请重新选择 PNG、JPG 或 WebP 图片',profile_avatar_type:'请选择 PNG、JPG 或 WebP 图片',profile_avatar_too_large:'图片过大，请选择 10 MB、4000 万像素以内的图片',
 memory_embedding_loopback_required:'请使用本机向量服务地址（localhost 或 127.0.0.1）',integration_provider_fallback:'所选服务未成功，运行时已回退到默认服务；请检查所选服务的密钥与网络',integration_input_invalid:'请检查配置格式、端口与必填项',integration_changed:'配置已更新，请重新读取后保存；执行中的旧配置已暂停',integration_busy:'配置正在保存，请稍后重试',integration_not_found:'这个连接已被移除，请刷新',integration_test_failed:'连接检查失败，请检查已保存的地址、凭据、驱动安装与网络',mail_password_required:'启用邮箱前请填写授权码或应用专用密码',cua_macos_required:'CUA 驱动目前仅支持 macOS',voice_asr_unconfigured:'请先在语音设置中启用并配置转写接口',voice_transcription_failed:'语音转写失败，请检查接口、模型、凭据与网络',voice_audio_invalid:'录音格式无效或超过 8 MB',voice_recorder_unavailable:'当前环境不支持录音',model_import_schema_unsupported:'配置格式暂不支持，请选择 API 配置 JSON / TOML，或使用服务商预设手动添加',model_import_source_missing:'未发现这个平台的本机 API 配置，可选择导出文件',model_import_source_unsafe:'导入文件必须是当前用户拥有的普通文件',model_import_too_large:'导入配置最多 1 MB 和 128 个模型',
 app_settings_changed:'设置已在其它窗口更新，请重新读取后保存',app_settings_forbidden:'当前客户端不能修改 KTeam 设置',invalid_app_settings:'请检查设置值',harness_skills_changed:'技能启停已更新，当前执行已停止，请重新发起任务',desktop_location_unavailable:'这个位置尚未创建或暂时无法打开',desktop_location_forbidden:'此目录不能从设置中打开',model_settings_changed:'模型配置已变化，请关闭后重新打开设置',model_settings_busy:'模型设置正在保存，请稍后重试',model_binding_not_found:'请先在 KTeam 设置中配置模型，或导入原有模型配置',credential_missing:'该密钥尚未导入，请在模型设置中重新填写',model_endpoint_invalid:'接口地址不能包含用户名、密码或查询参数',managed_services_start_timeout:'内置消息服务启动超时，请重新连接',ENOENT:'后台尚未连接，请点击重新连接',peer_exchange_forbidden:'你暂时无法查看这段成员往来',peer_exchange_not_found:'这段消息往来已不可用',peer_exchange_scope_changed:'会话成员已变化，请重新打开',peer_exchange_message_unavailable:'这段消息暂时无法读取，请稍后重试',tool_approval_changed:'工具调用内容已变化，请读取最新请求',tool_approval_expired:'这次批准已失效，请使用当前会话中的新请求',harness_permissions_changed:'工具权限配置已变化，本轮已停止，请重试当前新请求',conversation_revision_conflict:'共享纪要已更新，请读取最新内容后再保存',regeneration_readonly_unavailable:'这个 Agent 暂不支持保证无工具执行的重新生成',regeneration_unavailable:'这条消息无法重新生成；原执行须已完成并有可核对记录',library_file_too_large:'每份资料最多 4 MB',library_file_type_unsupported:'暂不支持这种资料格式',library_file_other_host:'资料保存在另一台电脑，请在原电脑打开',conversation_service_upgrade_required:'请升级协作消息服务后使用会话资料功能',speech_unavailable:'当前电脑无法启动朗读',desktop_action_unavailable:'请在 KTeam 桌面版中使用这个功能',builtin_runtime_unavailable:'KTeam 内置运行时暂不可用，请重新启动 KTeam',native_probe_interrupted:'上次检测被中断，请重新检测',native_version_failed:'独立 CLI 的版本检查失败，请检查该 CLI 的安装',native_stop_unconfirmed:'旧 Agent 是否停止尚未确认，已阻止继续执行',native_platform_unverified:'当前系统的原生进程管理尚未验证',native_not_installed:'这台机器尚未安装该 Agent',native_probe_required:'请先检测这个 Agent 的真实调用',native_login_required:'该 Agent 尚未登录，请在它自己的设置中登录后重新检测',native_quota_exhausted:'该 Agent 的模型额度不足，请恢复额度后重新检测',native_timeout:'Agent 调用超时，已停止，不会自动重新执行',native_probe_failed:'Agent 检测失败，请检查它的本机配置',native_execution_failed:'Agent 执行失败，请检查原 Agent 的配置与日志',native_response_invalid:'Agent 没有返回有效答复，请重新检测兼容性',native_approval_required:'原 Agent 需要人工批准，本次没有自动扩大权限',native_result_unknown:'原 Agent 运行结果待核对，不会自动重放，请先检查工作目录',native_installation_changed:'Agent 程序或配置发生变化，请重新检测并绑定',native_probe_response_invalid:'Agent 未通过真实生成检测，请检查配置后重试',native_known_requires_direct:'这个 Agent 已支持直接调用，请在列表中选择，无需手动配对',native_readonly_unavailable:'这个 Agent 的后台只读检查尚未支持',native_start_failed:'Agent 程序无法启动，请检查安装',native_workspace_changed:'Agent 工作目录已变化，请核对目录',bot_profile_changed:'Bot 属性已被修改，请重新打开设置后保存',bot_workspace_invalid:'请选择这台机器上存在的资料目录',agent_invite_expired:'接入邀请已过期，请重新生成指令',agent_invite_claimed:'已有另一个客户端申请，请在KTeam核对或重新生成',agent_candidate_changed:'来源会话信息已变化，请刷新后重新核对',agent_approval_required:'等待你在KTeam确认接入',agent_service_upgrade_required:'消息服务需要配套升级才能接入本地Agent',agent_reply_result_unknown:'回复结果待核对，不会自动重新执行',agent_link_revoked:'连接已断开',agent_revocation_pending:'正在核对发出中的回复，核对后可切换',onboarding_creation_pending:'正在恢复上次创建，请先核对其结果',conversation_identity_changed:'会话成员或目标已变化，已暂停发送。请核对会话详情',conversation_contract_changed:'会话目标或规则已变化，请核对后重新创建方案',operation_receipt_missing:'原创建结果暂不可用，已停止后续操作，请稍后核对',proposal_expired:'组队方案已过期，请让小K重新准备',proposal_changed:'方案已变化，请刷新后确认',proposal_scope_mismatch:'方案与当前会话不一致，请重新打开原会话',operation_result_unknown:'创建结果待核对，原结果确认前不会重复创建。请稍后重试核对',operation_owner_changed:'后台已更新，请刷新后核对结果',member_identity_changed:'成员信息已变化，请让小K重新准备方案',

 broker_unavailable:'协作消息服务尚未连接',kswarm_unavailable:'项目与成员服务尚未连接',upstream_protocol_unavailable:'请先连接小K协作服务',
 aimp_unavailable:'当前协作服务需要升级以支持 KTeam',model_quota_exhausted:'模型请求受到限流或额度限制，本次工作已停止',model_authentication_failed:'模型凭据无效或没有访问权限，请在模型设置中检查',
 credential_store_unavailable:'模型凭据暂不可用，请检查 KTeam 模型设置与凭据存储',team_budget_exhausted:'本次或当天调用预算已用完',model_binding_changed:'模型配置发生变化，请重新绑定后继续',
 model_service_unavailable:'模型服务暂时不可用',model_endpoint_unavailable:'模型接口或模型名称不存在',model_request_rejected:'模型服务拒绝了请求',model_request_timeout:'请求模型超时',model_connection_failed:'无法连接模型服务',
 execution_failed:'本次工作执行失败',tool_execution_failed:'工具执行失败',
 execution_interrupted:'工作执行被中断',execution_timeout:'本次工作执行超时',execution_lease_lost:'执行资格已失效，工作已停止',execution_admission_unverified:'暂时无法确认执行资格，工作已停止',model_response_incomplete:'模型未返回完整结果',iteration_budget_exhausted:'本轮达到执行步数上限',
 team_stopped:'团队工作已停止',model_execution_failed:'模型执行失败，请检查服务状态',team_has_no_bound_agents:'团队成员尚未绑定 KTeam 执行方式',
 origin_message_missing:'原消息不可用',aimp_session_required:'团队协作契约尚未建立',stop_protocol_result_unknown:'停止请求的协议结果未知，模型调用已中止',
 upstream_operation_unknown:'发送结果待核对，请先核对结果。重复发送会沿用同一编号。',team_scope_changed:'团队设置已变化，本次工作已停止',team_paused:'团队已暂停，未开工的消息会在继续后处理',host_restarted_result_unknown:'主机曾重新启动，旧工作结果待核对，不会自动重放',
};
export const explain=(error:unknown)=>{const code=error instanceof Error?error.message:String(error);return reasons[code]??code;};
