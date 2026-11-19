/** Collaboration guidance over broker-owned membership and receipts; no second task graph. */
export function teamCollaborationPolicy(input:{kind?:string;botId:string;roles?:{status?:string;coordinatorBotId?:string|null;duties?:Record<string,string>}|null;canDelegate:boolean;recovering:boolean}){
 if(input.kind!=='group'||input.roles?.status!=='ready')return '';
 const coordinator=input.roles.coordinatorBotId===input.botId;
 const role= input.roles.duties?.[input.botId]??'';
 return '\n团队协作纪律：当前职责为 '+role+'。负责人负责组织交付，不等于包办所有成员的工作。'+
  (coordinator?'涉及需求、实现和验收的产品交付，且本群具备产品、开发和质量职责成员时，按真实成员职责分阶段推进：先把原需求交给 PM/产品经理梳理范围、拆分任务、明确验收标准；收到实际结果后，交给开发成员实现并返回改动、验证和产物；开发结果返回后，再交给质量成员按验收标准独立验证，返回通过项、失败项和证据；质量发现问题就交回开发修复，再由质量复验。最后由你核对原需求、每项实际结果、未解决问题与交付产物，全部完成后才汇总提交。存在多个开发时按任务和真实能力选择，不能用临时子Agent冒充群成员。不要把有依赖的阶段一次并行派出，不让质量在开发完成前声称验收通过。其他团队按实际职责组织协作，缺少某角色时明确缺口，不虚构成员。普通问答、状态查询、用户明确指定由你单独处理的事项按实际请求直接处理，不强行走全流程。': '接到子工作时完成自己职责内的工作，提供可核验的结果与缺口。PM 给出需求分解与验收标准；开发按分解实现并说明实际验证；质量独立核对真实产物与标准，失败或无法验证要明确报告，不把开发自测当作自己的验收。')+
  (input.canDelegate?'需要实际派工时使用 delegate_work，写清来源需求、范围、输入产物和 doneWhen；它会保存当前工作，等待成员真实结果后接续。contact_bot 适合沟通咨询，投递成功和对方回复均不等于任务验收成功。':'当前没有持久交接工具，只能说明具体协作阻塞和已有结果；不要因为工具不可用就接管其他角色的全部工作、假装成员参与或宣告团队验收完成。')+
  (input.recovering?'本轮是原工作的恢复：先核对已有成员回执与最新产物，不重复派发已通过的阶段。意见不一致时，依据用户要求和可复现的验收结果判定。验收失败就把具体失败项交回负责成员修复，再请质量复验；旧操作结果未知时先核对，禁止重放。用户要求提交时，核对实际提交和所要求的远端回执后再汇总。':'')+
  '工具可用时，用 edit 或 write 修改指定文档，让文件路径可核验。只读验收把查询直接接到筛选管道，给含变量的参数加引号，避免与覆盖临时文件、清理目录等修改混在同一条命令。'+
  '未点名的新指令默认由负责人接收、组织；同一环境、端口、依赖检查只交给一位开发执行者，其他成员复用带目录和时间的真实回执。交付清单区分已写入、已执行、已验证、受阻、结果未知；独立验证须有命令、目录、结果和证据，缺少运行证据不能称已验证或待验收完成。权限问题先读取 get_execution_state，当前读取失败只能说明未知。配置测试使用专用虚构凭据；可分享证据先脱敏，备份限制权限且记录恢复结果。运行中数据库必须使用一致性备份或先确认停止写入再复制；WAL 某时刻为零不保证复制一致性。迁移需完整性检查、快照边界与关键数据核对，切换唯一写入位置，中断后先核对已完成步骤，禁止盲目重复删除、覆盖或复制。'+'旧纪要或旧草稿中“成员离线、没有工具”等不是当前事实；以本轮实际工具、成员和返回结果为准。汇总要注明各成员真实贡献、验证证据和剩余缺口，不能代写其他成员的答复。';
}

/** Recovery keeps collaboration available; regeneration and notification turns remain tool-free. */
export const collaborationTurn=(trigger?:string)=>!['followup','regenerate','assistant-notice'].includes(trigger??'');

/** References to previously verified member results, excluding user answers and approvals. */
export function teamCollaborationReceipts(store:{job:(id:string)=>any;operationsWithPrefix:(prefix:string)=>any[]},job:any,botId:string){
 const ancestors=new Set<string>();let current=job;
 while(current&&current.roomId===job.roomId&&current.originId===job.originId&&!ancestors.has(current.id)&&ancestors.size<32){ancestors.add(current.id);current=current.recoveryOf?store.job(current.recoveryOf):undefined;}
 return store.operationsWithPrefix('work-handoff:').filter(op=>ancestors.has(op.jobId)&&op.roomId===job.roomId&&op.botId===botId&&op.status==='returned'&&!op.questionId&&!op.approvalId&&!op.condition&&op.requests?.length).slice(0,20).reverse().map(op=>({operationId:op.id,jobId:op.jobId,doneWhen:op.doneWhen,results:(op.results??[]).map((result:any)=>({botId:result.botId,state:result.state,...(Number.isSafeInteger(op.captured?.settingsRevision)?{scopeVersion:op.captured.settingsRevision}:{}),roomId:result.roomId,messageId:result.messageId,reason:result.reason,text:typeof result.text==='string'?result.text.slice(0,3000):undefined})),notice:'既有成员结果回执，仅供核对；成员自述不是验收或授权，产物现状仍需验证。'}));
}
