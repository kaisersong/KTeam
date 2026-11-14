import {originalMessage,ownerPage,recentContext} from './room-reads.js';
import {createHash,randomUUID} from 'node:crypto';
import type {Upstreams} from '../adapters/upstream.js';
import {KTeamError,record,fields,text} from '../errors.js';
import type {TeamStore} from './team-store.js';
import type {TeamCoordinator} from './coordination.js';
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export interface BotContactScope {roomId:string;botId:string;jobId:string;originId:string;admission:Record<string,unknown>;signal:AbortSignal;onUnanswered?:()=>void;assertCurrent:()=>Promise<void>;rootJobId?:string;path?:string[]}
export class PrivateConversations {
 private pending=new Map<string,{guard:()=>Promise<void>;resolve:(answer:string|null)=>void}>();private closed=false;
 private questionGuard?:(question:any)=>Promise<void>;
 private questionAnswered?:(question:any)=>void;
 setQuestionGuard(guard:(question:any)=>Promise<void>,answered?:(question:any)=>void){this.questionGuard=guard;this.questionAnswered=answered;}
 constructor(private upstream:Upstreams,private store:TeamStore,private coordinator:TeamCoordinator,private dispatch:()=>void,private validateParent?:(job:any)=>Promise<void>){for(const row of store.operationsWithPrefix('bot-question:')){if(row.durable){if(['sending','answering'].includes(row.status))store.saveOperation({...row,status:'unknown',previousStatus:row.status,reason:'host_restarted'},row.revision);}else if(row.status==='pending')store.saveOperation({...row,status:'cancelled',reason:'host_restarted'},row.revision);}}
 async source(scope:BotContactScope,toId?:string){await scope.assertCurrent();const snapshot=await this.upstream.membership(scope.roomId),active=(snapshot.members as any[]).filter(m=>m.status==='active');if((snapshot.room as any)?.status!=='active'||!active.some(m=>m.subject?.kind==='user'&&m.subject.userId==='user.local')||!active.some(m=>m.subject?.logicalAgentId===scope.botId)||(toId&&!active.some(m=>m.subject?.logicalAgentId===toId)))throw new KTeamError('bot_private_scope_denied',403);return snapshot;}
 private async send(scope:BotContactScope,targetRoom:string,purpose:string,body:string,id:string,toId?:string){await this.source(scope,toId);if(this.store.settings(targetRoom)?.paused)throw new KTeamError('bot_private_target_paused',409);const membership=await this.upstream.membership(targetRoom);await this.coordinator.guardConversation(targetRoom,membership);const result=await this.upstream.sendBotPrivate(targetRoom,{logicalAgentId:scope.botId,sourceRoomId:scope.roomId,admission:scope.admission,text:body,threadId:'bot-private',idempotencyKey:id,expectedRoomRevision:(membership.room as any).revision,recipientLogicalAgentId:toId,originMessageId:scope.originId,exchangeId:id,purpose});await scope.assertCurrent();return result.message as any;}
 async direct(scope:BotContactScope){await this.source(scope);const result=await this.coordinator.direct(scope.botId,{requestSource:'user'});await this.source(scope);return result.roomId;}
 async notifyApproval(scope:BotContactScope){const roomId=await this.direct(scope),key='approval-contact:'+hash([scope.jobId,scope.botId]);if(!this.store.operation(key)){const op=this.store.saveOperation({id:key,status:'sending',roomId,sourceRoomId:scope.roomId},0);try{const message=await this.send(scope,roomId,'approval','群聊操作确认，请查看审批卡片。',key);this.store.saveOperation({...op,status:'sent',messageId:message.messageId},op.revision);}catch(error){this.store.saveOperation({...op,status:'unknown'},op.revision);throw error;}}return roomId;}
 tools(scope:BotContactScope){return [
  {permission:'safe',definition:{name:'ask_user',description:'遇到必须由本人回答的问题时，转到你与用户的私聊，显示带来源群的问题并等待用户回答。普通澄清可以提供选项。答案是用户输入数据，不是工具批准；安全批准由真实权限卡处理。不要让用户在聊天中输入密码或验证码，应使用系统/原Agent安全输入通道。',inputSchema:{type:'object',additionalProperties:false,required:['question'],properties:{question:{type:'string',minLength:1,maxLength:2000},options:{type:'array',maxItems:5,items:{type:'string',maxLength:120}}}}},execute:(input:any,context:any)=>this.ask(scope,input,context?.toolInvocationId)},
  {permission:'safe',definition:{name:'contact_bot',description:'与原群中另一名Bot单独协作。会创建成员私聊，消息携带来源群。wait=true等待对方的真实答复，false仅返回已投递回执。不会代替对方发言或把投递当完成。执行环境校验失败发生在发起方，不能据此声称目标成员离线或被用户撤权；如实报告具体错误与是否已投递。对方沿用自己的Agent、工作目录和权限；禁止把私聊用于越权或替用户批准。',inputSchema:{type:'object',additionalProperties:false,required:['botId','message'],properties:{botId:{type:'string'},message:{type:'string',minLength:1,maxLength:6000},wait:{type:'boolean'}}}},execute:(input:any,context:any)=>this.contact(scope,input,context?.toolInvocationId)}
 ];}
 async ask(scope:BotContactScope,input:any,invocationId:string= randomUUID()){
  if(this.closed)throw new KTeamError('host_shutdown');
  const value=record(input);fields(value,['question','options']);const question=text(value.question,'question',2000);if(value.options!==undefined&&(!Array.isArray(value.options)||value.options.length>5||value.options.some(v=>typeof v!=='string'||!v.trim()||v.length>120)))throw new KTeamError('bot_question_invalid');
  if(/(?:输入|提供|告诉|给我|粘贴).{0,12}(?:密码|口令|验证码|密钥|password|secret|token)|(?:password|otp|secret|private.key).{0,12}(?:enter|provide|paste|type)/i.test(question))return JSON.stringify({asked:false,reason:'secure_input_required',next:'不要通过聊天索取或保存密码、验证码或密钥。使用当前Agent/系统的安全登录输入通道；尚不可用则明确请求用户在原应用完成登录。'});
  if(this.store.operationsWithPrefix('bot-question:').some(op=>op.jobId===scope.jobId&&op.status==='unknown'))throw new KTeamError('bot_contact_result_unknown',409);
  const source=await this.source(scope);const roomId=await this.direct(scope),id='bot-question:'+hash([scope.jobId,scope.botId,question,value.options??[]]);if(this.store.operation(id))throw new KTeamError('bot_question_already_requested');
  const op=this.store.saveOperation({id,status:'sending',roomId,sourceRoomId:scope.roomId,botId:scope.botId,jobId:scope.jobId,question,sourceRoomTitle:(source.room as any).title,options:value.options??[],createdAt:Date.now(),expiresAt:Date.now()+10*60000},0);
  let message;try{message=await this.send(scope,roomId,'question',question,id);}catch(error){this.store.saveOperation({...op,status:'unknown'},op.revision);throw error;}
  const pending=this.store.saveOperation({...op,status:'pending',messageId:message.messageId},op.revision);
  const answer=await new Promise<string|null>(resolve=>{let done=false;const finish=(value:string|null)=>{if(done)return;done=true;clearTimeout(timer);scope.signal.removeEventListener('abort',cancel);this.pending.delete(id);const prior=this.store.operation(id);if(prior?.status==='pending')this.store.saveOperation({...prior,status:'cancelled'},prior.revision);resolve(value);},cancel=()=>finish(null),timer=setTimeout(cancel,10*60000);this.pending.set(id,{resolve:finish,guard:async()=>{await this.source(scope);if(this.store.settings(roomId)?.paused)throw new KTeamError('bot_private_target_paused',409);await this.coordinator.guardConversation(roomId);}});scope.signal.addEventListener('abort',cancel,{once:true});if(scope.signal.aborted||this.closed)cancel();});
  if(answer===null)scope.onUnanswered?.();await scope.assertCurrent();return JSON.stringify(answer===null?{answered:false,reason:'cancelled_or_expired'}:{answered:true,answer,source:'user',questionId:pending.id});
 }
 questions(roomId?:string){return this.store.operationsWithPrefix('bot-question:').filter(q=>q.status==='pending'&&(!roomId||q.roomId===roomId)&&(!q.durable||q.expiresAt>Date.now()&&['running','waiting'].includes(this.store.job(q.jobId)?.state))).map(({id,roomId,sourceRoomId,sourceRoomTitle,botId,jobId,question,options,expiresAt,messageId,durable})=>({id,roomId,sourceRoomId,sourceRoomTitle,botId,jobId,question,options,expiresAt,messageId,durable}));}
 async answer(value:unknown){
  const input=record(value);fields(input,['id','answer']);const id=text(input.id,'question_id'),answer=text(input.answer,'answer',4000),prior=this.store.operation(id),live=this.pending.get(id);
  if(prior?.durable)return this.answerDurable(prior,answer);
  if(!live||!prior||prior.status!=='pending'||prior.expiresAt<=Date.now())throw new KTeamError('bot_question_expired',409);await live.guard();if(this.pending.get(id)!==live||this.closed)throw new KTeamError('bot_question_expired',409);
  const expectedRoomRevision=await this.coordinator.guardConversation(prior.roomId);
  const sending=this.store.saveOperation({...prior,status:'answering'},prior.revision);
  let sent;try{sent=await this.upstream.sendMessage(prior.roomId,{text:answer,kind:'text',threadId:'bot-private',responsePolicy:'none',contextScope:{kind:'room_only'},replyToMessageId:prior.messageId,expectedRoomRevision,idempotencyKey:'answer:'+id,sourceRef:{kind:'bot_question_answer',questionId:id}});}catch(error){this.store.saveOperation({...sending,status:'unknown'},sending.revision);live.resolve(null);throw error;}
  await live.guard();if(this.pending.get(id)!==live||this.closed)throw new KTeamError('bot_question_expired',409);
  this.store.saveOperation({...sending,status:'answered',answeredAt:Date.now(),answerMessageId:(sent.message as any)?.messageId},sending.revision);live.resolve(answer);return {ok:true};
 }
 async requestDurableQuestion(scope:BotContactScope,input:unknown,deadline:number,admit:()=>void=()=>{}){
  if(this.closed)throw new KTeamError('host_shutdown');const value=record(input);fields(value,['question','options']);const question=text(value.question,'question',2000);if(value.options!==undefined&&(!Array.isArray(value.options)||value.options.length>5||value.options.some(v=>typeof v!=='string'||!v.trim()||v.length>120)))throw new KTeamError('bot_question_invalid');
  if(/(?:输入|提供|告诉|给我|粘贴).{0,12}(?:密码|口令|验证码|密钥|password|secret|token)|(?:password|otp|secret|private.key).{0,12}(?:enter|provide|paste|type)/i.test(question))return {asked:false,reason:'secure_input_required'};
  await this.source(scope);const id='bot-question:'+hash([scope.jobId,scope.botId,question,value.options??[]]),prior=this.store.operation(id);if(prior){if(!prior.durable||!['pending','answered'].includes(prior.status))throw new KTeamError('bot_contact_result_unknown',409);return {asked:true,id,reused:true};}
  if(this.store.operationsWithPrefix('bot-question:').some(q=>q.jobId===scope.jobId&&q.status==='unknown'))throw new KTeamError('bot_contact_result_unknown',409);
  admit();const source=await this.source(scope),roomId=await this.direct(scope);await scope.assertCurrent();const op=this.store.saveOperation({id,durable:true,status:'sending',roomId,sourceRoomId:scope.roomId,sourceRoomTitle:(source.room as any).title,originId:scope.originId,botId:scope.botId,jobId:scope.jobId,question,options:value.options??[],createdAt:Date.now(),expiresAt:deadline},0);
  try{const message=await this.send(scope,roomId,'question',question,id);this.store.saveOperation({...op,status:'pending',messageId:message.messageId},op.revision);return {asked:true,id};}catch(error){this.store.saveOperation({...op,status:'unknown',previousStatus:'sending'},op.revision);throw error;}
 }
 cancelQuestion(id:string,reason:string){const op=this.store.operation(id);if(op?.durable&&['pending','sending'].includes(op.status))this.store.saveOperation({...op,status:'cancelled',reason},op.revision);}
 private async answerDurable(prior:any,answer:string){
  if(this.closed||!this.questionGuard)throw new KTeamError('bot_question_expired',409);const answerHash=hash(answer);
  if(prior.answerHash&&prior.answerHash!==answerHash)throw new KTeamError('bot_question_answer_changed',409);
  if(prior.status==='answered'){await this.coordinator.guardConversation(prior.roomId);return {ok:true,reused:true};}
  if(prior.status==='unknown'&&prior.previousStatus==='answering'){await this.answeredQuestion(prior.id);if(this.store.operation(prior.id).status==='answered')return {ok:true,reused:true};throw new KTeamError('bot_question_result_unknown',503);}
  if(prior.status!=='pending'||prior.expiresAt<=Date.now())throw new KTeamError('bot_question_expired',409);await this.questionGuard(prior);const expectedRoomRevision=await this.coordinator.guardConversation(prior.roomId);const current=this.store.operation(prior.id);if(current.revision!==prior.revision)throw new KTeamError('bot_question_changed',409);
  const sending=this.store.saveOperation({...prior,status:'answering',answerHash},prior.revision);
  let sent;try{sent=await this.upstream.sendMessage(prior.roomId,{text:answer,kind:'text',threadId:'bot-private',responsePolicy:'none',contextScope:{kind:'room_only'},replyToMessageId:prior.messageId,expectedRoomRevision,idempotencyKey:'answer:'+prior.id,sourceRef:{kind:'bot_question_answer',questionId:prior.id}});}
  catch(error){this.store.saveOperation({...sending,status:'unknown',previousStatus:'answering'},sending.revision);throw error;}
  const answered=this.store.saveOperation({...sending,status:'answered',answerMessageId:(sent.message as any)?.messageId,answeredAt:Date.now()},sending.revision);this.questionAnswered?.(answered);this.dispatch();return {ok:true};
 }
 async answeredQuestion(id:string){
  let op=this.store.operation(id);if(!op?.durable)throw new KTeamError('bot_question_changed',409);await this.coordinator.guardConversation(op.roomId);
  if(op.status==='unknown'&&op.previousStatus==='answering'){
   const page=await ownerPage(this.upstream,op.roomId,{after:op.answerCursor??0,limit:100}),messages=page.messages as any[];const answer=messages.find(m=>m.sender?.kind==='user'&&m.sourceRef?.kind==='bot_question_answer'&&m.sourceRef?.questionId===id&&hash(m.text)===op.answerHash&&m.replyToMessageId===op.messageId);
   const current=this.store.operation(id);if(current.revision!==op.revision)return undefined;
   op=this.store.saveOperation({...op,...(answer?{status:'answered',answerMessageId:answer.messageId,answeredAt:Date.now()}:{answerCursor:Math.max(op.answerCursor??0,...messages.map(m=>Number(m.roomSequence)||0))})},op.revision);
  }
  if(op.status!=='answered')return undefined;const message=(await this.upstream.conversationMessage(op.roomId,op.answerMessageId)).message as any;
  if(message.sender?.kind!=='user'||message.sourceRef?.kind!=='bot_question_answer'||message.sourceRef.questionId!==id||message.replyToMessageId!==op.messageId||hash(message.text)!==op.answerHash)throw new KTeamError('bot_question_source_changed',409);
  await this.coordinator.guardConversation(op.roomId);return {state:'delivered',questionId:id,questionMessageId:op.messageId,answerMessageId:message.messageId,source:'user',answer:message.text};
 }
 async contact(scope:BotContactScope,input:any,invocationId:string=randomUUID()){
  const args=record(input);fields(args,['botId','message','wait']);const toId=text(args.botId,'bot_id'),body=text(args.message,'message',6000),path=scope.path??[scope.botId],rootJobId=scope.rootJobId??scope.jobId;
  if(path.includes(toId)||path.length>=3)throw new KTeamError('bot_contact_cycle_denied');await this.source(scope,toId);
  const id='bot-contact:'+hash([scope.jobId,scope.botId,toId,body]);
  let op=this.store.transaction(()=>{
   if(this.store.operationsWithPrefix('bot-contact:').some(r=>r.sourceJobId===scope.jobId&&r.status==='unknown'))throw new KTeamError('bot_contact_result_unknown',409);
   if(this.store.operation(id))throw new KTeamError('bot_contact_already_requested');
   if(this.store.operationsWithPrefix('bot-contact:').filter(r=>r.rootJobId===rootJobId).length>=8)throw new KTeamError('bot_contact_budget_exhausted');
   return this.store.saveOperation({id,status:'preparing',sourceRoomId:scope.roomId,sourceJobId:scope.jobId,originMessageId:scope.originId,rootJobId,fromBotId:scope.botId,toBotId:toId,path:[...path,toId]},0);
  });
  let room;try{room=await this.coordinator.privatePair(scope.botId,toId,scope.roomId,()=>this.source(scope,toId).then(()=>{}));}catch(error){this.store.saveOperation({...op,status:'failed'},op.revision);throw error;}
  op=this.store.saveOperation({...op,status:'sending',roomId:room.roomId},op.revision);
  let message;try{message=await this.send(scope,room.roomId,'consult',body,id,toId);}catch(error){this.store.saveOperation({...op,status:'unknown'},op.revision);throw error;}
  const jobId='job-'+id;this.store.transaction(()=>{op=this.store.saveOperation({...op,status:'sent',messageId:message.messageId,jobId},op.revision);this.store.enqueueFollowup({id:jobId,roomId:room.roomId,originId:message.messageId,trigger:'peer',peer:{sourceRoomId:scope.roomId,sourceJobId:scope.jobId,rootJobId,fromBotId:scope.botId,toBotId:toId,path:[...path,toId]}});});this.dispatch();
  if(args.wait===false)return JSON.stringify({sent:true,roomId:room.roomId,messageId:message.messageId,jobId,completed:false});
  for(;;){scope.signal.throwIfAborted();await this.source(scope,toId);const job=this.store.jobs(room.roomId).find(j=>j.id===jobId);if(job?.state==='delivered'){const reply=job.results?.find((r:any)=>r.botId===toId);if(!reply)throw new KTeamError('bot_contact_result_missing');const actual=(await this.upstream.conversationMessage(room.roomId,reply.messageId)).message as any;return JSON.stringify({sent:true,completed:true,roomId:room.roomId,messageId:actual.messageId,fromBotId:toId,text:actual.text});}if(job&&['blocked','unknown','stopped','noop'].includes(job.state))return JSON.stringify({sent:true,completed:false,roomId:room.roomId,jobId,state:job.state,reason:job.reason});await new Promise(r=>setTimeout(r,200));}
 }
 async sourceContext(job:any){
  if(!job.peer)return undefined;
  await this.validatePeer(job);
  const parent=this.store.job(job.peer.sourceJobId),snapshot=await this.upstream.membership(job.peer.sourceRoomId),context=await recentContext(this.upstream,job.peer.sourceRoomId,12);
  const origin=parent?.trigger==='routine'?undefined:await originalMessage(this.upstream,job.peer.sourceRoomId,parent.originId);
  await this.validatePeer(job);
  return {roomId:job.peer.sourceRoomId,title:(snapshot.room as any).title,userMessage:origin?{messageId:origin.messageId,text:origin.text}:undefined,routine:!origin?{name:parent.routine.name,prompt:parent.routine.prompt,scheduledAt:parent.routine.scheduledAt,source:'用户在KTeam设置的例行任务'}:undefined,historyCoverage:{limited:context.limited,bytes:context.bytes,limit:12},history:context.messages.map(m=>({messageId:m.messageId,sender:m.sender,text:String(m.text??'').slice(0,6000)}))};
 }
 async validatePeer(job:any){const p=job.peer;if(!p)return;const source=this.store.settings(p.sourceRoomId),parent=this.store.job(p.sourceJobId);if(!source||source.paused||!parent||['stopping','stopped','unknown','blocked','held','cancelled'].includes(parent.state))throw new KTeamError('bot_private_scope_denied',403);await this.validateParent?.(parent);if(p.rootJobId&&p.rootJobId!==parent.id){const root=this.store.job(p.rootJobId);if(!root)throw new KTeamError('bot_private_scope_denied',403);await this.validateParent?.(root);}const snapshot=await this.upstream.membership(p.sourceRoomId),active=(snapshot.members as any[]).filter(m=>m.status==='active');if((snapshot.room as any).status!=='active'||![p.fromBotId,p.toBotId].every(id=>active.some(m=>m.subject?.logicalAgentId===id))||!active.some(m=>m.subject?.userId==='user.local'))throw new KTeamError('bot_private_scope_denied',403);}
 close(){this.closed=true;for(const p of [...this.pending.values()])p.resolve(null);}
}
