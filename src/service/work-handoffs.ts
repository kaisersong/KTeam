import {peerExchangeId} from './peer-exchanges.js';
import {memberHandoffDeadline} from './work-deadlines.js';
import {executionFailure} from '../protocol/execution-failure.js';
import {originalMessage} from './room-reads.js';
import {WorkConditions} from './work-conditions.js';
import {createHash} from 'node:crypto';
import {KTeamError,fields,record,text} from '../errors.js';
import type {Upstreams} from '../adapters/upstream.js';
import type {TeamStore} from './team-store.js';
import type {TeamCoordinator} from './coordination.js';
import type {PrivateConversations,BotContactScope} from './private-conversations.js';
import {profile} from './bot-profile.js';
import {appPreferences} from './app-preferences.js';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const eventId=(value:string)=>'msg_'+hash(value).slice(0,32);
const terminal=new Set(['delivered','blocked','unknown','stopped','noop','cancelled']);

export function handoffChildJob(store:Pick<TeamStore,'job'>,job:any,child:any){
 const record=store.job(child.jobId);
 if(!record||record.roomId!==child.roomId||record.originId!==child.requestMessageId||
    record.peer?.sourceJobId!==job.id||record.peer?.rootJobId!==(job.peer?.rootJobId??job.id)||
    record.peer?.toBotId!==child.botId||record.peer?.sourceRoomId!==job.roomId)return undefined;
 return record;
}

export function handoffChildReceipt(record:any,botId:string){
 return record?.state==='delivered'?record.results?.find((result:any)=>result.botId===botId&&result.messageId&&result.taskRef):undefined;
}

/** Durable references to the existing peer jobs and AIMP task, never a second task owner. */
export class WorkHandoffs {
 constructor(private upstream:Upstreams,private store:TeamStore,private coordinator:TeamCoordinator,private chats:PrivateConversations,
  private assertRoutine:(job:any)=>Promise<void>,private invalidateChildren:(rootId:string)=>void,private now=Date.now){this.conditions=new WorkConditions(upstream,store);chats.setQuestionGuard(async question=>{const job=store.job(question.jobId),op=job?.currentHandoffId?store.operation(job.currentHandoffId):undefined;if(job?.state!=='waiting'||op?.questionId!==question.id||!['parked','parking'].includes(op.status))throw new KTeamError('bot_question_expired',409);await this.guard(job);},question=>{const job=store.job(question.jobId),op=job?.currentHandoffId?store.operation(job.currentHandoffId):undefined;if(op?.questionId===question.id&&op.status==='parked')store.saveOperation({...op,pollAt:0},op.revision);});}
 private conditions:WorkConditions;
 /** A child already waiting on the user must not lose its parent at the model's
  * shorter wait limit. Only a linked, durable approval can extend that wait. */
 private memberDeadline(job:any,op:any){
  const limit=Date.parse(job.task?.terms?.deadline);
  if(!Number.isFinite(limit)||limit<=op.deadline)return op.deadline;
  let deadline=op.deadline;
  for(const child of op.children??[]){
   const peer=this.store.job(child.jobId);
   if(peer?.roomId!==child.roomId||peer.peer?.sourceJobId!==job.id||peer.peer?.sourceRoomId!==job.roomId||peer.peer?.toBotId!==child.botId)continue;
   const wait=peer.currentHandoffId&&this.store.operation(peer.currentHandoffId);
   const approval=wait?.approvalId&&this.store.operation(wait.approvalId);
   if(wait?.jobId!==peer.id||wait?.roomId!==child.roomId||!['parked','resuming','returned'].includes(wait.status)||!approval?.durable||approval.handoffId!==wait.id||approval.jobId!==peer.id||approval.roomId!==child.roomId||approval.botId!==child.botId||!['pending','allowed','denied','executing','completed'].includes(approval.status))continue;
   if(!Number.isFinite(approval.createdAt)||approval.createdAt>op.deadline||!Number.isFinite(approval.expiresAt))continue;
   deadline=Math.max(deadline,Math.min(limit,approval.expiresAt));
  }
  return deadline;
 }
 private async capture(job:any,botId:string,targetIds:string[]){
  await this.coordinator.guardConversation(job.roomId);
  const snapshot=await this.upstream.membership(job.roomId),bots=((await this.upstream.listBots()).agents as any[]),members=snapshot.members as any[];
  const bindings=Object.fromEntries([botId,...targetIds].map(id=>{const bot=bots.find(bot=>bot.id===id&&!bot.archivedAt),binding=this.store.binding(id);if(!bot||!binding||this.store.state('source-changing:'+id)||!members.some(member=>member.status==='active'&&member.subject?.logicalAgentId===id))throw new KTeamError('handoff_scope_changed',409);return [id,{binding,profileRevision:profile(bot).revision}];}));
  const settings=this.store.settings(job.roomId);if(!settings||settings.paused)throw new KTeamError('handoff_scope_changed',409);
  return {settingsRevision:settings.revision,roomRevision:(snapshot.room as any).revision,bindings,sourceOrigin:job.routine?{routineId:job.routine.id}:{messageId:job.originId,bodyHash:hash((await originalMessage(this.upstream,job.roomId,job.originId)).text)},rolesRevision:this.store.state<any>('team-role-policy:'+job.roomId)?.revision??0,disabledSkills:appPreferences(this.store).disabledSkills};
 }
 async guard(job:any){
  if(!job?.currentHandoffId)return;
  const op=this.store.operation(job.currentHandoffId);if(!op||['failed','unknown','cancelled'].includes(op.status))throw new KTeamError('handoff_scope_changed',409);
  try{if(['waiting','parking','parked','resuming'].includes(op.status)&&this.now()>this.memberDeadline(job,op))throw new KTeamError(op.condition?'condition_wait_expired':'handoff_wait_expired',409);await this.conditions.assertScope(op);await this.assertRoutine(job);const current=await this.capture(job,op.botId,op.requests.map((request:any)=>request.botId));const {sourceTailId:legacyTail,...captured}=op.captured;const comparable={...current};if(!captured.sourceOrigin)delete (comparable as any).sourceOrigin;if(hash(comparable)!==hash(captured))throw new KTeamError('handoff_scope_changed',409);for(const child of op.children??[])await this.coordinator.guardConversation(child.roomId);}
  catch(error){if(error instanceof KTeamError&&([403,404].includes(error.status)||['conversation_identity_changed','conversation_contract_changed','routine_scope_changed','bot_profile_changed','model_binding_changed'].includes(error.code)))throw new KTeamError('handoff_scope_changed',409);throw error;}
 }
 async guardApproval(approval:any){
  const job=this.store.job(approval.jobId),op=job?.currentHandoffId?this.store.operation(job.currentHandoffId):undefined;
  if(!job||!op||op.approvalId!==approval.id||op.id!==approval.handoffId||!['waiting','running'].includes(job.state)||!['waiting','parking','parked','resuming','returned'].includes(op.status))throw new KTeamError('tool_approval_expired',409);
  await this.guard(job);await this.chats.validatePeer(job);if(approval.displayRoomId)await this.coordinator.guardConversation(approval.displayRoomId);
 }
 async waitForApproval(scope:BotContactScope,job:any,approval:any){
  await scope.assertCurrent();
  if(this.store.waitingJobs().length>=100)throw new KTeamError('handoff_capacity_exceeded',409);
  const previous=job.currentHandoffId?this.store.operation(job.currentHandoffId):undefined;
  if(previous&&!['returned','cancelled','failed'].includes(previous.status))throw new KTeamError('handoff_result_unknown',409);
  const captured=await this.capture(job,scope.botId,[]),id='work-handoff:'+hash([job.id,approval.id]),version=(job.handoffVersion??0)+1;
  await scope.assertCurrent();
  this.store.transaction(()=>{this.store.saveOperation({id,jobId:job.id,roomId:job.roomId,botId:scope.botId,requests:[],children:[],approvalId:approval.id,doneWhen:'等待本人审核工具操作',deadline:approval.expiresAt,captured,version,status:'waiting'},0);const current=this.store.operation(approval.id);this.store.saveOperation({...current,handoffId:id},current.revision);job.currentHandoffId=id;job.handoffVersion=version;job.handoffWait={operationId:id,doneWhen:'等待本人审核工具操作',deadline:approval.expiresAt,approvalId:approval.id,children:[]};this.store.save(job);});
 }
 wantsPause(job:any){const op=job.currentHandoffId?this.store.operation(job.currentHandoffId):null;return !!op&&['waiting','parking'].includes(op.status);}
 questionTool(scope:BotContactScope,job:any){const original=this.chats.tools(scope).find(tool=>tool.definition.name==='ask_user')!;return {...original,definition:{...original.definition,description:'遇到必须由本人回答的问题时，转到你与用户的私聊。原工作保存并挂起、释放执行槽；本人回答后重新核验来源并接续同一工作，重启不重新询问。答案不是工具批准，不索取密码或验证码。'},execute:async(input:unknown)=>{
  await scope.assertCurrent();const captured=await this.capture(job,scope.botId,[]),deadline=Date.parse(job.task?.terms?.deadline)||this.now()+3600000;
  const receipt=await this.chats.requestDurableQuestion(scope,input,deadline,()=>{if(this.store.waitingJobs().length>=100)throw new KTeamError('handoff_capacity_exceeded',409);});if(!receipt.asked)return JSON.stringify(receipt);const answer=await this.chats.answeredQuestion(receipt.id!);if(answer)return JSON.stringify({answered:true,...answer});
  await scope.assertCurrent();const id='work-handoff:'+hash([job.id,scope.botId,receipt.id]),prior=this.store.operation(id);if(prior)throw new KTeamError('handoff_result_unknown',409);
  if(this.store.waitingJobs().length>=100){this.chats.cancelQuestion(receipt.id!,'handoff_capacity_exceeded');throw new KTeamError('handoff_capacity_exceeded',409);}
  const version=(job.handoffVersion??0)+1;this.store.transaction(()=>{this.store.saveOperation({id,jobId:job.id,roomId:job.roomId,botId:scope.botId,requests:[],children:[],questionId:receipt.id,doneWhen:'本人回答后接续原工作',deadline,captured,version,status:'waiting'},0);job.currentHandoffId=id;job.handoffVersion=version;job.handoffWait={operationId:id,doneWhen:'等待本人回答',deadline,questionId:receipt.id,questionRoomId:this.store.operation(receipt.id!).roomId,children:[]};this.store.save(job);});
  return JSON.stringify({waiting:true,answered:false,questionId:receipt.id,next:'问题已发送到本人私聊。原工作将保存并挂起，回答后接续，不重新提问。'});
 }};}
 tools(scope:BotContactScope,job:any){return [this.conditionTool(scope,job),{permission:'safe',definition:{name:'delegate_work',description:'把独立子工作交给当前群内至多三位成员，可并行完成。当前工作会保存并挂起，释放执行槽；全部结果或失败返回后，重新校验原范围并自动接续原工作。不把送达当完成，不授予新权限。不使用本工具重复结果未知的旧操作。未指定 timeoutMinutes 时等待至原任务期限；指定较短期限时，已发起的人工审批可等到该审批截止，但不超过原任务期限。',inputSchema:{type:'object',additionalProperties:false,required:['requests','doneWhen'],properties:{requests:{type:'array',minItems:1,maxItems:3,items:{type:'object',additionalProperties:false,required:['botId','message'],properties:{botId:{type:'string'},message:{type:'string',minLength:1,maxLength:6000}}}},doneWhen:{type:'string',minLength:1,maxLength:512},timeoutMinutes:{type:'integer',minimum:1,maximum:60}}}},execute:(input:unknown)=>this.delegate(scope,job,input)}];}
 private conditionTool(scope:BotContactScope,job:any){return {permission:'safe',definition:{name:'wait_for_condition',description:'保存当前工作并释放执行槽，等待工作目录内文件到位、文件内容变化或同会话已有工作返回结果。未变化不调用模型。只读观察不扩大权限，不重新执行旧操作。文件内容变化最多检查1MiB；必须填写期限，最多60分钟且不超过原任务期限。',inputSchema:{type:'object',additionalProperties:false,required:['condition','reason','timeoutMinutes'],properties:{condition:{type:'object',additionalProperties:false,required:['kind'],properties:{kind:{type:'string',enum:['file_exists','file_changed','work_result']},path:{type:'string'},jobId:{type:'string'}}},reason:{type:'string',maxLength:512},timeoutMinutes:{type:'integer',minimum:1,maximum:60}}}},execute:async(value:unknown)=>{
  const input=record(value);fields(input,['condition','reason','timeoutMinutes']);const reason=text(input.reason,'condition_reason',512),minutes=input.timeoutMinutes;
  if(!Number.isSafeInteger(minutes)||Number(minutes)<1||Number(minutes)>60||this.store.waitingJobs().length>=100)throw new KTeamError('condition_input_invalid');
  await scope.assertCurrent();const condition=await this.conditions.capture(job,scope.botId,input.condition),captured=await this.capture(job,scope.botId,[]);await scope.assertCurrent();
  const id='work-handoff:'+hash([job.id,scope.botId,input]),existing=this.store.operation(id);if(existing)throw new KTeamError('condition_already_recorded',409);
  const version=(job.handoffVersion??0)+1,deadline=Math.min(this.now()+Number(minutes)*60000,Date.parse(job.task?.terms?.deadline)||this.now()+3600000);
  this.store.saveOperation({id,jobId:job.id,roomId:job.roomId,botId:scope.botId,requests:[],children:[],condition,doneWhen:reason,deadline,captured,version,status:'waiting'},0);
  job.currentHandoffId=id;job.handoffVersion=version;job.handoffWait={operationId:id,doneWhen:reason,deadline,condition:{kind:condition.kind,label:condition.kind==='work_result'?'已有工作返回结果':condition.kind==='file_exists'?'文件到位':'文件内容变化'},children:[]};this.store.save(job);
  return JSON.stringify({waiting:true,completed:false,operationId:id,condition:job.handoffWait.condition,next:'原工作将保存，条件满足后接续，不进行模型轮询。'});
 }};}

 async delegate(scope:BotContactScope,job:any,value:unknown){
  const input=record(value);fields(input,['requests','doneWhen','timeoutMinutes']);const doneWhen=text(input.doneWhen,'handoff_done_when',512),minutes=input.timeoutMinutes;
  if(!Array.isArray(input.requests)||!input.requests.length||input.requests.length>3||minutes!==undefined&&(!Number.isSafeInteger(minutes)||Number(minutes)<1||Number(minutes)>60))throw new KTeamError('handoff_input_invalid');
  const requests=input.requests.map(value=>{const request=record(value);fields(request,['botId','message']);return {botId:text(request.botId,'bot_id'),message:text(request.message,'message',6000)};});
  if(new Set(requests.map(request=>request.botId)).size!==requests.length||requests.some(request=>(scope.path??[scope.botId]).includes(request.botId)))throw new KTeamError('handoff_input_invalid');
  await scope.assertCurrent();const id='work-handoff:'+hash([job.id,scope.botId,requests,doneWhen]),existing=this.store.operation(id);
  if(existing){await this.guard({...job,currentHandoffId:id});if(existing.status==='returned')return JSON.stringify({completed:true,results:existing.results});if(existing.status==='waiting'){job.currentHandoffId=id;this.store.save(job);return JSON.stringify({completed:false,waiting:true});}throw new KTeamError('handoff_result_unknown',409);}
  if(this.store.waitingJobs().length>=100)throw new KTeamError('handoff_capacity_exceeded',409);
  const captured=await this.capture(job,scope.botId,requests.map(request=>request.botId));await scope.assertCurrent();
  const version=(job.handoffVersion??0)+1,deadline=memberHandoffDeadline(job.task,minutes as number|undefined,this.now());
  let op=this.store.saveOperation({id,jobId:job.id,roomId:job.roomId,botId:scope.botId,requests,doneWhen,deadline,captured,version,status:'creating',children:[]},0);
  job.currentHandoffId=id;job.handoffVersion=version;this.store.save(job);
  try{
   // Dispatching each receipt starts the original peer lane immediately; no worker waits here.
   for(const request of requests){
    const receipt=JSON.parse(await this.chats.contact(scope,{...request,wait:false},id));
    if(receipt.sent===false){
     // The private message was never dispatched. Preserve this as a known
     // failed result without invalidating the other members' real work.
     op=this.store.saveOperation({...op,dispatchFailures:[...(op.dispatchFailures??[]),{botId:request.botId,state:'blocked',reason:receipt.reason}]},op.revision);
    }else{
     op=this.store.saveOperation({...op,children:[...op.children,{botId:request.botId,jobId:receipt.jobId,roomId:receipt.roomId,requestMessageId:receipt.messageId}]},op.revision);
    }
   }
   await scope.assertCurrent();op=this.store.saveOperation({...op,status:'waiting'},op.revision);job.currentHandoffId=id;job.handoffVersion=version;job.handoffWait={operationId:id,doneWhen,deadline,children:this.memberProgress(job,op)};this.store.save(job);
   return JSON.stringify({waiting:true,completed:false,operationId:id,children:op.children.map((child:any)=>({botId:child.botId,jobId:child.jobId})),next:'当前工作将挂起，实际结果回来后接续。'});
  }catch(error){const current=this.store.operation(id);this.store.saveOperation({...current,status:'unknown',reason:'handoff_result_unknown'},current.revision);this.invalidateChildren(job.id);throw error;}
 }
 private memberProgress(job:any,op:any){
  const questions=this.chats.questions();
  const members=(op.children??[]).map((child:any)=>{
   const record=handoffChildJob(this.store,job,child);
   const rootJobId=job.peer?.rootJobId??job.id;
   if(!record)return {botId:child.botId,jobId:child.jobId,state:'unknown',reason:'handoff_result_invalid'};
   const question=questions.find(question=>question.jobId===record.id);
   const approval=record.handoffWait?.approvalId?this.store.operation(record.handoffWait.approvalId):undefined;
   const pending=approval?.status==='pending'&&approval.jobId===record.id&&approval.botId===child.botId&&approval.expiresAt>this.now();
   const result=handoffChildReceipt(record,child.botId);
   const failure=executionFailure(record);
   return {botId:child.botId,jobId:child.jobId,state:question||pending?'waiting_user':record.state==='delivered'&&!result?'unknown':record.state,
    exchangeId:peerExchangeId(rootJobId,child.roomId),requestMessageId:child.requestMessageId,resultMessageId:result?.messageId,
    questionRoomId:question?.roomId,questionId:question?.id,approvalRoomId:pending?approval.displayRoomId??approval.roomId:undefined,approvalId:pending?approval.id:undefined,
    reason:failure?.code??record.reason,model:failure?.model};
  });
  const failures=(op.dispatchFailures??[]).map((failure:any)=>({botId:failure.botId,state:'blocked',reason:failure.reason}));
  return [...members,...failures];
 }
 async park(job:any){
  const op=this.store.operation(job.currentHandoffId);if(!op||!this.wantsPause(job))throw new KTeamError('handoff_result_unknown',409);
  await this.guard(job);const task=((await this.upstream.aimp(job.roomId,'tasks')).tasks as any[]).find(task=>task.taskRef===job.task?.taskRef);
  const latest=this.store.job(job.id);
  if(latest?.state!=='running'||latest.currentHandoffId!==op.id||this.store.settings(job.roomId)?.paused||this.store.workPaused())throw new KTeamError('team_paused',409);
  if(!task||task.state!=='working'||task.assignee.split('/').at(-1)!==op.botId)throw new KTeamError('handoff_scope_changed',409);
  const reason=(op.questionId||op.approvalId?'waiting_user:':'waiting_members:')+op.id,parkId=eventId(op.id+':park');let current=this.store.saveOperation({...op,status:'parking',taskRef:task.taskRef,reason,parkId},op.revision);
  job.state='waiting';delete job.handoffResume;this.store.save(job);
  let blocked:any;
  try{blocked=(await this.upstream.aimp(job.roomId,'agent-event',{logicalAgentId:op.botId,id:parkId,roomId:job.roomId,threadId:task.threadId,taskRef:task.taskRef,act:'escalate',body:op.approvalId?'已保存工具批次，等待本人审核后接续。':op.questionId?'已保存工作，等待本人回答后接续。':op.condition?'已保存工作，条件满足后接续。':'已交给相关成员，结果返回后接续本项工作。',targetEvent:{id:task.headId,hash:task.headHash},payload:{kind:'task.escalate@1',must_understand:true,reason_code:reason,evidence:{handoffId:op.id,childJobIds:op.children.map((child:any)=>child.jobId)},mandatory:false}})).task;}
  catch(error){if(!(error instanceof KTeamError)||error.code!=='upstream_operation_unknown')throw error;blocked=((await this.upstream.aimp(job.roomId,'tasks')).tasks as any[]).find(candidate=>candidate.taskRef===task.taskRef);if(blocked?.state!=='blocked'||blocked.headId!==parkId)throw error;}
  current=this.store.saveOperation({...current,status:'parked'},current.revision);const aborted=[...(job.toolTrace??[])].reverse().find(event=>event.type==='run_aborted'&&!job.handoffPauseEventIds?.includes(event.id));if(aborted)job.handoffPauseEventIds=[...(job.handoffPauseEventIds??[]),aborted.id].slice(-8);job.task=blocked;job.state='waiting';this.store.save(job);
 }
 cancel(job:any,reason='team_stopped'){const op=job.currentHandoffId?this.store.operation(job.currentHandoffId):undefined;if(op?.approvalId){const approval=this.store.operation(op.approvalId);if(approval?.status==='pending')this.store.saveOperation({...approval,status:'cancelled',reason},approval.revision);}if(op?.questionId)this.chats.cancelQuestion(op.questionId,reason);if(op&&!['returned','cancelled'].includes(op.status))this.store.saveOperation({...op,status:'cancelled',reason},op.revision);job.state='stopped';job.reason=reason;job.handoffWait=undefined;this.store.save(job);this.invalidateChildren(job.id);}
 private async fail(job:any,code:string){
  const op=this.store.operation(job.currentHandoffId);if(op?.approvalId){const approval=this.store.operation(op.approvalId);if(approval&&['pending','allowed','denied'].includes(approval.status))this.store.saveOperation({...approval,status:'cancelled',reason:code},approval.revision);}if(op?.questionId)this.chats.cancelQuestion(op.questionId,code);if(op&&!['cancelled','failed'].includes(op.status))this.store.saveOperation({...op,status:'failed',reason:code},op.revision);
  job.state='blocked';job.reason=code;this.store.save(job);this.invalidateChildren(job.id);
  if(job.task){const task=((await this.upstream.aimp(job.roomId,'tasks')).tasks as any[]).find(task=>task.taskRef===job.task.taskRef);if(task&&['committed','working','blocked'].includes(task.state))await this.upstream.aimp(job.roomId,'event',{id:eventId(job.currentHandoffId+':stop'),roomId:job.roomId,threadId:task.threadId,taskRef:task.taskRef,act:'stop',body:'交接的原范围已失效或已超时，等待核对后继续。',targetEvent:{id:task.headId,hash:task.headHash},payload:{kind:'task.stop@1',must_understand:true,reason:code}});}
 }
 private queueResume(job:any,op:any,task:any){
  this.store.transaction(()=>{const latest=this.store.job(job.id),operation=this.store.operation(op.id);if(latest?.state!=='waiting'||latest.currentHandoffId!==op.id||operation.status!=='resuming')throw new KTeamError('handoff_scope_changed',409);this.store.saveOperation({...operation,status:'returned'},operation.revision);latest.task=task;latest.handoffResume={operationId:op.id,botId:op.botId,version:op.version,approvalId:operation.approvalId,question:operation.questionId?{questionId:operation.questionId}:undefined,condition:operation.condition?{kind:operation.condition.kind,label:latest.handoffWait?.condition?.label}:undefined,readonly:operation.results.some((result:any)=>result.state!=='delivered'),results:operation.results,doneWhen:op.doneWhen};latest.state='queued';latest.handoffWait=undefined;this.store.save(latest);});
 }
 async wake(){
  const candidates=this.store.waitingJobs().map(job=>({job,op:this.store.operation(job.currentHandoffId)})).filter(entry=>entry.op&&['parked','parking','resuming'].includes(entry.op.status)&&(!entry.op.retryAt||entry.op.retryAt<=this.now())).sort((a,b)=>(a.op.lastCheckedAt??0)-(b.op.lastCheckedAt??0)).slice(0,20);
  for(const {job:snapshot} of candidates){
   let op=this.store.operation(snapshot.currentHandoffId);if(!op||!['parked','parking','resuming'].includes(op.status))continue;
   if(op.retryAt&&op.retryAt>this.now())continue;
   try{
    const job=this.store.job(snapshot.id);if(job?.state!=='waiting'||job.currentHandoffId!==op.id)continue;
    if(op.status==='parking'||op.status==='resuming'){
     await this.guard(job);const task=((await this.upstream.aimp(job.roomId,'tasks')).tasks as any[]).find(task=>task.taskRef===op.taskRef);
     if(op.status==='resuming'&&task?.state==='committed'&&task.headId===op.resumeId){this.queueResume(job,op,task);continue;}
     if(op.status==='parking'&&task?.state==='blocked'&&task.headId===op.parkId){op=this.store.saveOperation({...op,status:'parked'},op.revision);job.task=task;this.store.save(job);}
     else {await this.fail(job,'handoff_result_unknown');const latest=this.store.job(job.id);latest.state='unknown';this.store.save(latest);continue;}
    }
    const deadline=this.memberDeadline(job,op);
    if(this.now()>deadline){await this.fail(job,op.condition?'condition_wait_expired':'handoff_wait_expired');continue;}
    if(deadline!==op.deadline){
     await this.guard(job);
     const latest=this.store.job(job.id),current=this.store.operation(op.id);
     if(latest?.state!=='waiting'||latest.currentHandoffId!==op.id||current?.revision!==op.revision)continue;
     this.store.transaction(()=>{op=this.store.saveOperation({...current,deadline},current.revision);latest.handoffWait={...latest.handoffWait,deadline};this.store.save(latest);});
     job.handoffWait=latest.handoffWait;
    }
    if((op.condition||op.questionId)&&op.pollAt&&op.pollAt>this.now())continue;
    const children=op.children.map((child:any)=>({...child,job:handoffChildJob(this.store,job,child)}));
    const states=this.memberProgress(job,op);
    if(hash(job.handoffWait?.children)!==hash(states)){job.handoffWait={...job.handoffWait,children:states};this.store.save(job);}
    if(children.some((child:any)=>child.job&&!terminal.has(child.job.state))){const current=this.store.operation(op.id);if(current?.status==='parked')this.store.saveOperation({...current,lastCheckedAt:this.now(),retryAt:null},current.revision);continue;}
    await this.guard(job);
    const results:any[]=[...(op.dispatchFailures??[])];
    if(op.approvalId){const approval=this.store.operation(op.approvalId);if(!approval||approval.handoffId!==op.id||!approval.durable||approval.expiresAt<=this.now())throw new KTeamError('tool_approval_expired',409);if(approval.status==='pending'){const current=this.store.operation(op.id);this.store.saveOperation({...current,lastCheckedAt:this.now(),retryAt:null},current.revision);continue;}if(!['allowed','denied'].includes(approval.status))throw new KTeamError('tool_approval_result_unknown',409);results.push({state:'delivered',approvalId:op.approvalId});}
    if(op.questionId){const answer=await this.chats.answeredQuestion(op.questionId);if(!answer){const current=this.store.operation(op.id);this.store.saveOperation({...current,lastCheckedAt:this.now(),pollAt:this.now()+5000,retryAt:null},current.revision);continue;}const {answer:privateBody,...receipt}=answer;results.push(receipt);}
    if(op.condition){const observed=await this.conditions.observe(job,op);if(!observed.ready){const current=this.store.operation(op.id);this.store.saveOperation({...current,lastCheckedAt:this.now(),pollAt:this.now()+5000,retryAt:null,readFailures:0,lastError:null},current.revision);if(job.handoffWait?.lastError){delete job.handoffWait.lastError;this.store.save(job);}continue;}results.push(...observed.results!);}
    for(const child of children){
     if(child.job?.state!=='delivered'){results.push({botId:child.botId,state:child.job?.state??'unknown',reason:child.job?.reason??'child_result_missing'});continue;}
     await this.chats.validatePeer(child.job);await this.coordinator.guardConversation(child.roomId);const receipt=handoffChildReceipt(child.job,child.botId);if(!receipt)throw new KTeamError('handoff_result_invalid',409);
     const actual=(await this.upstream.conversationMessage(child.roomId,receipt.messageId)).message as any;
     const task=((await this.upstream.aimp(child.roomId,'tasks')).tasks as any[]).find(task=>task.taskRef===receipt.taskRef);
     if(actual.sender?.logicalAgentId!==child.botId||actual.sourceRef?.kind!=='aimp_reply'||actual.sourceRef?.taskRef!==receipt.taskRef||!task?.artifactVerification?.verified||!['delivered','accepted'].includes(task.state))throw new KTeamError('handoff_result_invalid',409);
     results.push({botId:child.botId,state:'delivered',roomId:child.roomId,messageId:actual.messageId,text:String(actual.text).slice(0,12000)});
    }
    const task=((await this.upstream.aimp(job.roomId,'tasks')).tasks as any[]).find(task=>task.taskRef===op.taskRef);
    if(!task||task.state!=='blocked'||task.blockReasons?.length!==1||task.blockReasons[0]!==op.reason)throw new KTeamError('handoff_resume_blocked',409);
    await this.guard(job);if(this.store.job(job.id)?.state!=='waiting')continue;
    const resumeId=eventId(op.id+':resume'),current=this.store.operation(op.id);if(current?.status!=='parked')continue;this.store.saveOperation({...current,status:'resuming',results,resumeId},current.revision);
    let resumed:any;
    try{resumed=(await this.upstream.aimp(job.roomId,'event',{id:resumeId,roomId:job.roomId,threadId:task.threadId,taskRef:task.taskRef,act:'resume',body:op.questionId?'本人已回答，核对后接续原工作。':'成员结果已返回，核对后接续原工作。',targetEvent:{id:task.headId,hash:task.headHash},payload:{kind:'task.resume@1',must_understand:true,resolved_causes:[op.reason],authorization:{kind:'original_work_continuation',jobId:job.id,handoffId:op.id}}})).task;}
    catch(error){if(!(error instanceof KTeamError)||error.code!=='upstream_operation_unknown')throw error;resumed=((await this.upstream.aimp(job.roomId,'tasks')).tasks as any[]).find(task=>task.taskRef===op.taskRef);if(resumed?.state!=='committed'||resumed.headId!==resumeId)throw error;}
    await this.guard(job);
    this.queueResume(job,op,resumed);
   }catch(error){const current=this.store.job(snapshot.id);if(current?.state!=='waiting')continue;
    if(error instanceof KTeamError&&([403,404].includes(error.status)||['tool_approval_expired','tool_approval_result_unknown','bot_question_changed','bot_question_source_changed','condition_wait_expired','handoff_wait_expired','condition_scope_changed','condition_file_invalid','condition_file_too_large','condition_result_invalid','handoff_scope_changed','handoff_result_invalid','handoff_resume_blocked','conversation_identity_changed','conversation_contract_changed'].includes(error.code))){try{await this.fail(current,error.code);}catch{current.stopResultUnknown=true;this.store.save(current);}}
    else {const operation=this.store.operation(op.id);if(operation?.status==='resuming'){current.state='unknown';current.reason='handoff_result_unknown';this.store.save(current);this.store.saveOperation({...operation,status:'unknown'},operation.revision);}else if(operation){this.store.saveOperation({...operation,retryAt:this.now()+Math.min(300000,5000*2**Math.min(operation.readFailures??0,6)),readFailures:(operation.readFailures??0)+1,lastCheckedAt:this.now(),lastError:'handoff_source_unavailable'},operation.revision);current.handoffWait={...current.handoffWait,lastError:'handoff_source_unavailable'};this.store.save(current);}}
   }
  }
 }
}
