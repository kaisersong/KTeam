import {approvalSystemNotice} from '../src/protocol/system-notice.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolve,join} from 'node:path';
import {mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {realUpstreams} from './helpers/real-upstreams.js';
import {TeamStore} from '../src/service/team-store.js';
import {TeamCoordinator} from '../src/service/coordination.js';
import {PrivateConversations} from '../src/service/private-conversations.js';
import {PeerExchanges} from '../src/service/peer-exchanges.js';
import {TeamAssistant} from '../src/service/assistant.js';
import {TeamAutomation} from '../src/service/automation.js';
import {CollaborationService,LOCAL_HUMAN,agentAddress} from '../src/service/collaboration.js';
import {createHarness} from '../src/runtime/harness.js';
import {verifyExecutionScope} from '../src/service/execution-guard.js';
import {KTeamError} from '../src/errors.js';
const user={requestSource:'user'},models={catalog:async()=>({defaultModelId:'fixture'}),identity:async()=>({model:'fixture-model',fingerprint:'frozen'})};
const id=()=>'msg_'+randomBytes(16).toString('hex');
const sleep=()=>new Promise(r=>setTimeout(r,5));
async function setup(){process.env.KTEAM_RUNTIME_ENTRY=resolve('build/shared/kteam-runtime.mjs');const f=await realUpstreams(),store=new TeamStore(f.root),coordinator=new TeamCoordinator(f.upstream,store,1,models);const master=await coordinator.bootstrap(user),a=await coordinator.createMember({name:'开发',modelId:'fixture',requestId:id()},user),b=await coordinator.createMember({name:'CTO',modelId:'fixture',requestId:id()},user),group=await coordinator.createGroup({title:'产品团队',memberAgentIds:[a.bot.id,b.bot.id],requestId:id()},user);return {...f,store,coordinator,master,a,b,roomId:group.room.roomId,async close(){store.close();await f.close();}};}
async function admission(f:any,botId:string,jobId='source-job',excludedRooms:string[]=[]){
 const roomId=f.roomId,origin=(await f.upstream.sendMessage(roomId,{text:'查看KTeam源码并与团队协作',kind:'text',threadId:'source',responsePolicy:'none',contextScope:{kind:'room_only'},idempotencyKey:id()})).message;
 let task=(await f.upstream.aimp(roomId,'event',{id:id(),threadId:'source',act:'request',body:'查看源码',payload:{kind:'task.request@1',must_understand:true,description:'查看KTeam源码',deadline:new Date(Date.now()+3600000).toISOString(),expires:new Date(Date.now()+300000).toISOString(),budget:'none',acceptance:{predicates:['artifact_hash']},assignee:agentAddress(botId),reviewer:LOCAL_HUMAN}})).task;
 task=(await f.upstream.aimp(roomId,'agent-event',{logicalAgentId:botId,id:id(),threadId:task.threadId,taskRef:task.taskRef,act:'accept',body:'accept',targetEvent:{id:task.headId,hash:task.headHash},payload:{kind:'task.accept@1',must_understand:true,terms_hash:task.termsHash,caveats:[]}})).task;
 task=(await f.upstream.aimp(roomId,'begin-execution',{logicalAgentId:botId,taskRef:task.taskRef,requestId:'source-run-'+jobId,expectedRevision:task.revision,bindingRevision:1,hostFence:1})).task;
 const grant={logicalAgentId:botId,taskRef:task.taskRef,epoch:task.epoch,bindingRevision:1,hostFence:1};
 f.store.enqueue(jobId,roomId,origin.messageId);const job=f.store.claim(excludedRooms);job.state='running';f.store.save(job);
 return {roomId,botId,originId:origin.messageId,jobId,admission:grant,signal:AbortSignal.timeout(15000),assertCurrent:async()=>{await f.upstream.aimp(roomId,'execution-check',grant);}};
}
test('master sees actual group work beyond its own chat, including accessible groups not locally created',async()=>{const f=await setup(),assistant=new TeamAssistant(f.upstream,f.store);try{await f.upstream.sendMessage(f.master.roomId,{text:'方案卡片已生成，点击开始',kind:'text',threadId:'assistant',responsePolicy:'none',contextScope:{kind:'room_only'},idempotencyKey:id()});const scope=await admission(f,f.a.bot.id);await f.upstream.aimp(f.roomId,'chat',{...scope.admission,text:'正在核对KTeam源码，尚未完成开发'});const other=(await f.upstream.createTeam({title:'另一项目组',memberAgentIds:[],clientRequestKey:'not-kteam-created'})).room.roomId;const snapshot=await assistant.snapshot(f.master.botId,f.master.roomId);assert.ok(snapshot.groups.some(g=>g.title==='产品团队'));assert.ok(snapshot.groups.some(g=>g.roomId===other));assert.match(JSON.stringify(snapshot),/核对KTeam源码/);assert.equal(snapshot.groups.find(g=>g.roomId===f.roomId)?.execution,'running');await assert.rejects(assistant.snapshot(f.a.bot.id,f.a.roomId),/assistant_scope_required/);}finally{await assistant.close();await f.close();}});

test('master can page through all accessible groups and fences dynamically read sources before the next model request',async()=>{
 const f=await setup(),assistant=new TeamAssistant(f.upstream,f.store);let automation:TeamAutomation|undefined;try{
  for(let i=0;i<21;i++)await f.upstream.createTeam({title:'额外团队'+i,memberAgentIds:[],clientRequestKey:'page-'+i});
  const first=await assistant.snapshot(f.master.botId,f.master.roomId),next=await assistant.snapshot(f.master.botId,f.master.roomId,first.nextOffset!);assert.equal(first.groups.length,20);assert.equal(first.hasMore,true);assert.equal(next.hasMore,false);assert.equal(new Set([...first.groups,...next.groups].map(g=>g.roomId)).size,22);
  let checked=false;
  automation=new TeamAutomation(f.upstream,f.store,1,async input=>{
   await input.onRequest?.();const initial=JSON.parse(input.prompt).teamAwareness;const target=next.groups.find(g=>!initial.groups.some((r:any)=>r.roomId===g.roomId))!;assert.ok(target);
   const tool=input.tools!.find(t=>t.definition.name==='get_team_work');assert.ok(tool);assert.match(await tool.execute({roomId:target.roomId}),/额外团队/);
   const result=f.broker.room.archiveRoom({roomId:target.roomId,expectedRoomRevision:target.roomRevision},{sessionId:'master-revocation',requestSource:'user',actor:{kind:'user',userId:'user.local'},issuedAt:new Date().toISOString()});assert.equal(result.ok,true);
   await assert.rejects(Promise.resolve().then(()=>input.onRequest?.()),/assistant_team_forbidden/);checked=true;return {text:'MUST_NOT_PUBLISH',model:'fixture-model',fingerprint:'frozen',usage:{inputTokens:1,outputTokens:1}};
  },f.coordinator);
  const message=await f.upstream.sendMessage(f.master.roomId,{text:'核对所有团队',kind:'text',threadId:'master',responsePolicy:'none',contextScope:{kind:'room_only'},idempotencyKey:id()});f.store.enqueue('master-new-source',f.master.roomId,message.message.messageId);await automation.tick();assert.equal(checked,true);assert.equal(f.store.jobs(f.master.roomId)[0].state,'blocked');assert.doesNotMatch(JSON.stringify((await f.upstream.messages(f.master.roomId,0,100)).messages),/MUST_NOT_PUBLISH/);
 }finally{await automation?.close();await assistant.close();await f.close();}
});
test('question goes to Bot private Room; one authenticated answer reaches its exact original execution',async()=>{const f=await setup(),chats=new PrivateConversations(f.upstream,f.store,f.coordinator,()=>{});try{const scope=await admission(f,f.a.bot.id),asking=chats.ask(scope,{question:'选择这次验收的范围',options:['本轮变更','全部功能']},'question-one');while(!chats.questions().length)await sleep();const question=chats.questions()[0]!;assert.notEqual(question.roomId,f.roomId);assert.equal(question.sourceRoomId,f.roomId);const projected=(await new CollaborationService(f.upstream).messages(question.roomId,0,100)).messages.find(m=>m.messageId===question.messageId);assert.equal(projected!.sourceRef?.originRoomId,f.roomId);assert.equal(projected!.sourceRef?.verifiedExecution,false);assert.equal((await f.upstream.conversationMessage(question.roomId,question.messageId)).message.sender.logicalAgentId,f.a.bot.id);await chats.answer({id:question.id,answer:'本轮变更'});const response=JSON.parse(await asking);assert.equal(response.answer,'本轮变更');assert.equal(response.source,'user');await assert.rejects(chats.answer({id:question.id,answer:'全部功能'}),/bot_question_expired/);const messages=(await f.upstream.messages(question.roomId,0,100)).messages;assert.equal(messages.filter((m:any)=>m.sender.kind==='user').length,1);assert.match(await chats.ask(scope,{question:'请提供密码'},'secret'),/secure_input_required/);assert.equal(chats.questions().length,0);}finally{chats.close();await f.close();}});
test('private peer consultation uses the target Bot runtime, returns a real message, denies cycles and outsiders',async()=>{const f=await setup();let automation:TeamAutomation|undefined;const chats=new PrivateConversations(f.upstream,f.store,f.coordinator,()=>{void automation!.tick();});try{let invoked=false;automation=new TeamAutomation(f.upstream,f.store,1,async input=>{invoked=true;await input.onRequest?.();assert.match(input.system,/CTO/);return {text:'独立核对结果：测试范围需要包含回滚。',model:'fixture-model',fingerprint:'frozen',usage:{inputTokens:1,outputTokens:1}};},f.coordinator);const scope=await admission(f,f.a.bot.id);const response=JSON.parse(await chats.contact(scope,{botId:f.b.bot.id,message:'请独立检查这项验收范围',wait:true},'peer-one'));assert.equal(invoked,true,JSON.stringify({response,jobs:f.store.jobs(response.roomId)}));assert.equal(response.completed,true);assert.match(response.text,/独立核对结果/);assert.equal((await f.upstream.conversationMessage(response.roomId,response.messageId)).message.sender.logicalAgentId,f.b.bot.id);assert.equal(f.store.settings(response.roomId)?.kind,'peer');await assert.rejects(chats.contact(scope,{botId:f.a.bot.id,message:'cycle'},'cycle'),/bot_contact_cycle_denied/);await assert.rejects(chats.contact(scope,{botId:f.master.botId,message:'outsider'},'outside'),/bot_private_scope_denied/);await assert.rejects(f.upstream.sendBotPrivate(response.roomId,{logicalAgentId:f.b.bot.id,sourceRoomId:f.roomId,admission:scope.admission,text:'forged sender',idempotencyKey:'forged',expectedRoomRevision:1,purpose:'consult',recipientLogicalAgentId:f.a.bot.id}));}finally{chats.close();await automation?.close();await f.close();}});

test('expanding a private Room rejects question answers and Bot messages before publication',async()=>{const f=await setup(),chats=new PrivateConversations(f.upstream,f.store,f.coordinator,()=>{});try{const scope=await admission(f,f.a.bot.id),asking=chats.ask(scope,{question:'选择发布范围'},'private-scope');while(!chats.questions().length)await sleep();const question=chats.questions()[0]!;const changed=f.broker.room.updateRoomMembers({roomId:question.roomId,addUserIds:['synthetic-observer']},{sessionId:'private-scope',requestSource:'user',actor:{kind:'user',userId:'user.local'},issuedAt:new Date().toISOString()});assert.equal(changed.ok,true);await assert.rejects(chats.answer({id:question.id,answer:'MUST_NOT_PUBLISH'}),/conversation_identity_changed/);const membership=await f.upstream.membership(question.roomId);await assert.rejects(f.upstream.sendBotPrivate(question.roomId,{logicalAgentId:scope.botId,sourceRoomId:scope.roomId,admission:scope.admission,text:'MUST_NOT_PUBLISH',idempotencyKey:'expanded',expectedRoomRevision:membership.room.revision,purpose:'notice'}),/bot_private_target_invalid/);assert.doesNotMatch(JSON.stringify((await f.upstream.messages(question.roomId,0,100)).messages),/MUST_NOT_PUBLISH/);chats.close();await asking;}finally{chats.close();await f.close();}});

test('lost private-message receipt cannot be replayed with a new model tool-call ID',async()=>{const f=await setup(),chats=new PrivateConversations(f.upstream,f.store,f.coordinator,()=>{});try{const scope=await admission(f,f.a.bot.id),send=f.upstream.sendBotPrivate.bind(f.upstream);let calls=0;f.upstream.sendBotPrivate=async(...args:any[])=>{calls++;await send(...args);throw new Error('synthetic_receipt_lost');};await assert.rejects(chats.ask(scope,{question:'同一个验收问题'},'call-one'),/synthetic_receipt_lost/);await assert.rejects(chats.ask(scope,{question:'同一个验收问题'},'call-two'),/bot_contact_result_unknown/);assert.equal(calls,1);const op=f.store.operationsWithPrefix('bot-question:')[0];assert.equal((await f.upstream.messages(op.roomId,0,100)).messages.length,1);}finally{chats.close();await f.close();}});

test('concurrent peer contacts reserve the durable per-root limit before asynchronous Room creation',async()=>{const f=await setup(),chats=new PrivateConversations(f.upstream,f.store,f.coordinator,()=>{});try{const scope=await admission(f,f.a.bot.id);const results=await Promise.allSettled(Array.from({length:9},(_,i)=>chats.contact(scope,{botId:f.b.bot.id,message:'独立咨询 '+i,wait:false},'call-'+i)));assert.equal(results.filter(r=>r.status==='fulfilled').length,8,JSON.stringify(results));assert.equal(results.filter(r=>r.status==='rejected').length,1);assert.equal(f.store.operationsWithPrefix('bot-contact:').length,8);}finally{chats.close();await f.close();}});

test('pausing the source group cancels an executing peer consultation and stops its actual AIMP task',async()=>{
 const f=await setup();let automation:TeamAutomation|undefined,started=false,aborted=false;
 const chats=new PrivateConversations(f.upstream,f.store,f.coordinator,()=>{void automation!.tick();});try{
  automation=new TeamAutomation(f.upstream,f.store,1,async input=>{await input.onRequest?.();started=true;await new Promise((_,reject)=>{input.signal.addEventListener('abort',()=>{aborted=true;reject(input.signal.reason);},{once:true});});throw Error('unreachable');},f.coordinator);
  const scope=await admission(f,f.a.bot.id),receipt=JSON.parse(await chats.contact(scope,{botId:f.b.bot.id,message:'核对回滚范围',wait:false}));const until=Date.now()+5000;while(!started&&Date.now()<until)await sleep();assert.equal(started,true);
  await automation.pause(f.roomId);assert.equal(aborted,true);assert.equal(f.store.jobs(receipt.roomId)[0].state,'stopped');const tasks=(await f.upstream.aimp(receipt.roomId,'tasks')).tasks;assert.ok(tasks.some((t:any)=>t.state==='halted'));
 }finally{chats.close();await automation?.close();await f.close();}
});

test('original runtime-core triage runs with the real background budget and creates one assistant message job per source change',async()=>{const f=await setup();let calls=0;const assistant=new TeamAssistant(f.upstream,f.store,async input=>{calls++;await input.onRequest?.();return {text:JSON.stringify(JSON.parse(input.prompt).map((r:any)=>({sourceKey:r.key,priority:'now',reason:'团队遇到需要决策的事项',nextStep:'请确认验收范围'}))),model:'fixture-model',fingerprint:'frozen',usage:{inputTokens:1,outputTokens:1}};});try{const scope=await admission(f,f.a.bot.id);await f.upstream.aimp(f.roomId,'chat',{...scope.admission,text:'验收范围需要用户确认'});await assistant.scan();assert.equal(calls,1,JSON.stringify(f.store.state('assistant-scan-health')));assert.equal(f.store.jobs(f.master.roomId).filter(j=>j.trigger==='assistant-notice').length,1);await assistant.scan();assert.equal(calls,1);assert.equal(f.store.jobs(f.master.roomId).length,1);}finally{await assistant.close();await f.close();}});

test('assistant scan distinguishes failed triage from a durable silent decision',async()=>{
 const f=await setup();
 let calls=0;
 const assistant=new TeamAssistant(f.upstream,f.store,async input=>{
  await input.onRequest?.();
  calls++;
  const text=calls===1?'invalid response':JSON.stringify(JSON.parse(input.prompt).map((record:{key:string})=>({
   sourceKey:record.key,priority:'later',reason:'普通讨论',nextStep:'等待实际进展',
  })));
  return {text,model:'fixture-model',fingerprint:'frozen',usage:{inputTokens:1,outputTokens:1}};
 });
 let restarted:TeamAssistant|undefined,restartCalls=0;
 try{
  const scope=await admission(f,f.a.bot.id);
  const {message}=await f.upstream.aimp(f.roomId,'chat',{...scope.admission,text:'合成测试，仅讨论格式。'});
  await assistant.scan();
  const [failed]=f.store.operationsWithPrefix('assistant-decision:');
  assert.equal(failed.status,'triage_unavailable');
  assert.equal(failed.sourceMessageId,message.messageId);
  assert.equal(failed.sourceRoomId,f.roomId);
  assert.equal(f.store.jobs(f.master.roomId).length,0);
  await assistant.scan();
  const silent=f.store.operation(failed.id);
  assert.equal(silent.status,'stay_silent');
  assert.equal(silent.revision,failed.revision+1);
  await assistant.close();
  restarted=new TeamAssistant(f.upstream,f.store,async()=>{restartCalls++;throw new Error('unexpected decision');});
  await restarted.scan();
  assert.equal(f.store.operation(failed.id).revision,silent.revision);
  assert.equal(f.store.jobs(f.master.roomId).length,0);
  assert.equal(calls,2);
  assert.equal(restartCalls,0);
 }finally{await (restarted??assistant).close();await f.close();}
});

test('assistant notice only publishes if the source is still current',async()=>{
 for(const mode of ['current','superseded','changed_during_turn','revoked','disabled']){
  const f=await setup();
  let noticeCalls=0;
  const assistant=new TeamAssistant(f.upstream,f.store,async input=>{
   await input.onRequest?.();
   return {text:JSON.stringify(JSON.parse(input.prompt).map((record:{key:string})=>({
    sourceKey:record.key,priority:'now',reason:'需要确认验收范围',nextStep:'确认验收范围',
   }))),model:'fixture-model',fingerprint:'frozen',usage:{inputTokens:1,outputTokens:1}};
  });
  let automation:TeamAutomation|undefined;
  try{
   const send=async(text:string)=>{
    const scope=await admission(f,f.a.bot.id,id(),[f.master.roomId]);
    const sourceJob=f.store.job(scope.jobId);
    sourceJob.state='delivered';
    f.store.save(sourceJob);
    return f.upstream.aimp(f.roomId,'chat',{...scope.admission,text});
   };
   await send('合成验收范围需要用户确认');
   await assistant.scan();
   const [decision]=f.store.operationsWithPrefix('assistant-decision:');
   assert.equal(decision.status,'notify');
   const receipt=f.store.operation(decision.noticeId);
   assert.ok(receipt);
   if(mode==='superseded')await send('合成验收范围已解决');
   if(mode==='revoked'){
    const removed=f.broker.room.updateRoomMembers({roomId:f.roomId,removeAgentIds:[f.a.bot.id]},{
     sessionId:'notice-revocation',requestSource:'user',actor:{kind:'user',userId:'user.local'},issuedAt:new Date().toISOString(),
    });
    assert.equal(removed.ok,true);
   }
   automation=new TeamAutomation(f.upstream,f.store,1,async input=>{
    noticeCalls++;
    await input.onRequest?.();
    assert.ok(input.tools?.every(tool=>tool.definition.name==='get_team_work'));
    input.onText?.('合成提醒草稿');
    assert.equal(f.store.job(receipt.jobId).partialText,undefined);
    if(mode==='changed_during_turn')await send('合成验收范围已在推理期间解决');
    if(mode==='disabled')assistant.setEnabled(false);
    return {text:'合成提醒，请确认验收范围。',model:'fixture-model',fingerprint:'frozen',usage:{inputTokens:1,outputTokens:1}};
   },f.coordinator);
   await automation.tick();
   const job=f.store.job(receipt.jobId);
   assert.equal(job.state,mode==='current'?'delivered':'noop',mode+': '+JSON.stringify(job));
   assert.equal(job.answerDraft,undefined,mode);
   assert.equal(noticeCalls,['superseded','revoked'].includes(mode)?0:1,mode);
   const transcript=await f.upstream.messages(f.master.roomId,0,100);
   assert.equal(transcript.messages.filter((message:any)=>message.text==='合成提醒，请确认验收范围。').length,mode==='current'?1:0,mode);
   await automation.tick();
   assert.equal(f.store.jobs(f.master.roomId).length,1);
  }finally{await automation?.close();await assistant.close();await f.close();}
 }
});

test('peer consultation receives the original group request but never another private conversation',async()=>{
 const f=await setup(),chats=new PrivateConversations(f.upstream,f.store,f.coordinator,()=>{});try{
  const scope=await admission(f,f.a.bot.id),receipt=JSON.parse(await chats.contact(scope,{botId:f.b.bot.id,message:'请核实产品甲，不要替换为产品乙',wait:false}));
  await f.upstream.sendMessage(f.b.roomId,{text:'PRIVATE_NOT_SOURCE_CONTEXT_55',kind:'text',threadId:'private',responsePolicy:'none',contextScope:{kind:'room_only'},idempotencyKey:id()});
  const job=f.store.jobs(receipt.roomId)[0],context=await chats.sourceContext(job);
  assert.equal(context?.roomId,f.roomId);assert.equal(context?.title,'产品团队');assert.equal(context?.userMessage?.text,'查看KTeam源码并与团队协作');assert.doesNotMatch(JSON.stringify(context),/PRIVATE_NOT_SOURCE_CONTEXT_55/);
  f.store.pause(f.roomId);await assert.rejects(chats.sourceContext(job),/bot_private_scope_denied/);
 }finally{chats.close();await f.close();}
});
test('peer source context is rejected if membership is revoked while its messages are being read',async()=>{
 const f=await setup(),chats=new PrivateConversations(f.upstream,f.store,f.coordinator,()=>{});try{
  const scope=await admission(f,f.a.bot.id),receipt=JSON.parse(await chats.contact(scope,{botId:f.b.bot.id,message:'核对来源',wait:false})),job=f.store.jobs(receipt.roomId)[0],get=f.upstream.messages.bind(f.upstream);
  f.upstream.messages=async(roomId:string,...args:any[])=>{const result=await get(roomId,...args);if(roomId===f.roomId){const changed=f.broker.room.updateRoomMembers({roomId,removeAgentIds:[f.b.bot.id]},{sessionId:'revoke-read',requestSource:'user',actor:{kind:'user',userId:'user.local'},issuedAt:new Date().toISOString()});assert.equal(changed.ok,true);}return result;};
  await assert.rejects(chats.sourceContext(job),/bot_private_scope_denied/);
 }finally{chats.close();await f.close();}
});

test('peer summary counts broker receipts without disclosing text; clicking resolves only its original exchange',async()=>{
 const f=await setup();let automation:TeamAutomation|undefined;const chats=new PrivateConversations(f.upstream,f.store,f.coordinator,()=>{void automation!.tick();}),reader=new PeerExchanges(f.upstream,f.store);let calls=0;
 try{automation=new TeamAutomation(f.upstream,f.store,1,async input=>{await input.onRequest?.();return {text:'PRIVATE_REPLY_'+(++calls),model:'fixture-model',fingerprint:'frozen',usage:{inputTokens:1,outputTokens:1}};},f.coordinator);
  const first=await admission(f,f.a.bot.id);await chats.contact(first,{botId:f.b.bot.id,message:'PRIVATE_REQUEST_ONE',wait:true});const parent=f.store.job(first.jobId);parent.state='delivered';f.store.save(parent);
  const second=await admission(f,f.a.bot.id,'source-job-two');await chats.contact(second,{botId:f.b.bot.id,message:'PRIVATE_REQUEST_TWO',wait:true});
  const result=await reader.list(f.roomId,{originIds:[first.originId]});assert.equal(result.exchanges.length,1);const summary=result.exchanges[0]!;assert.equal(summary.messageCount,2);assert.equal(summary.state,'complete');assert.doesNotMatch(JSON.stringify(result),/PRIVATE_/);assert.deepEqual(new Set(summary.participantIds),new Set([f.a.bot.id,f.b.bot.id]));
  const detail=await reader.messages(f.roomId,summary.id);assert.deepEqual(detail.messages.map(m=>m.text),['PRIVATE_REQUEST_ONE','PRIVATE_REPLY_1']);assert.doesNotMatch(JSON.stringify(detail),/PRIVATE_REQUEST_TWO|PRIVATE_REPLY_2/);await assert.rejects(reader.messages(f.a.roomId,summary.id),/peer_exchange_not_found/);await assert.rejects(reader.list(f.roomId,{originIds:[first.originId],roomId:'foreign'}),/unknown_field/);
 }finally{chats.close();await automation?.close();await f.close();}
});
test('expanding peer membership while opening details rejects the whole response and removes the summary',async()=>{
 const f=await setup();let automation:TeamAutomation|undefined;const chats=new PrivateConversations(f.upstream,f.store,f.coordinator,()=>{void automation!.tick();}),reader=new PeerExchanges(f.upstream,f.store);
 try{automation=new TeamAutomation(f.upstream,f.store,1,async input=>{await input.onRequest?.();return {text:'PRIVATE_REPLY',model:'fixture-model',fingerprint:'frozen',usage:{inputTokens:1,outputTokens:1}};},f.coordinator);const scope=await admission(f,f.a.bot.id),sent=JSON.parse(await chats.contact(scope,{botId:f.b.bot.id,message:'PRIVATE_REQUEST',wait:true})),summary=(await reader.list(f.roomId,{originIds:[scope.originId]})).exchanges[0]!;const read=f.upstream.conversationMessage.bind(f.upstream);let changed=false;f.upstream.conversationMessage=async(...args:any[])=>{const result=await read(...args);if(!changed){changed=true;assert.equal(f.broker.room.updateRoomMembers({roomId:sent.roomId,addUserIds:['observer']},{sessionId:'peer-reader',requestSource:'user',actor:{kind:'user',userId:'user.local'},issuedAt:new Date().toISOString()}).ok,true);}return result;};await assert.rejects(reader.messages(f.roomId,summary.id),/peer_exchange_forbidden|peer_exchange_scope_changed/);assert.equal((await reader.list(f.roomId,{originIds:[scope.originId]})).exchanges.length,0);
 }finally{chats.close();await automation?.close();await f.close();}
});
test('peer reader rejects another exchange owner receipt and rechecks target access after source revalidation',async()=>{
 const f=await setup();let automation:TeamAutomation|undefined;const chats=new PrivateConversations(f.upstream,f.store,f.coordinator,()=>{void automation!.tick();}),reader=new PeerExchanges(f.upstream,f.store);
 try{automation=new TeamAutomation(f.upstream,f.store,1,async input=>{await input.onRequest?.();return {text:'PRIVATE_REPLY',model:'fixture-model',fingerprint:'frozen',usage:{inputTokens:1,outputTokens:1}};},f.coordinator);const scope=await admission(f,f.a.bot.id),sent=JSON.parse(await chats.contact(scope,{botId:f.b.bot.id,message:'PRIVATE_REQUEST',wait:true})),summary=(await reader.list(f.roomId,{originIds:[scope.originId]})).exchanges[0]!;
  const read=f.upstream.conversationMessage.bind(f.upstream);for(const field of ['exchangeId','originMessageId','recipientLogicalAgentId']){f.upstream.conversationMessage=async(...args:any[])=>{const result=structuredClone(await read(...args));if(result.message.sourceRef.kind==='bot_private_message')result.message.sourceRef[field]='another-exchange';return result;};await assert.rejects(reader.messages(f.roomId,summary.id),/peer_exchange_message_unavailable/);}f.upstream.conversationMessage=read;
  const membership=f.upstream.membership.bind(f.upstream);let sourceReads=0;f.upstream.membership=async(room:string)=>{const value=await membership(room);if(room===f.roomId&&++sourceReads===2)assert.equal(f.broker.room.updateRoomMembers({roomId:sent.roomId,addUserIds:['late-observer']},{sessionId:'peer-late-scope',requestSource:'user',actor:{kind:'user',userId:'user.local'},issuedAt:new Date().toISOString()}).ok,true);return value;};await assert.rejects(reader.list(f.roomId,{originIds:[scope.originId]}),/peer_exchange_forbidden|peer_exchange_scope_changed/);
 }finally{chats.close();await automation?.close();await f.close();}
});

test('production contact registry reconnects preflight, receives the target reply once and fails closed after actual scope revocation',async()=>{
 const f=await setup();let automation:TeamAutomation|undefined,owner:any;
 const previous={config:process.env.KTEAM_MODEL_CONFIG_DIR,plugins:process.env.KTEAM_DISABLE_GLOBAL_PLUGINS};
 const chats=new PrivateConversations(f.upstream,f.store,f.coordinator,()=>{void automation!.tick();});
 try{
  const cwd=join(f.root,'project'),config=join(f.root,'config'),plugin=join(cwd,'.kteam/plugins/review'),marker=join(f.root,'hook-ran');mkdirSync(plugin,{recursive:true});mkdirSync(config);
  process.env.KTEAM_MODEL_CONFIG_DIR=config;process.env.KTEAM_DISABLE_GLOBAL_PLUGINS='1';
  writeFileSync(join(plugin,'plugin.json'),JSON.stringify({name:'review',version:'1.0.0',hooks:[{type:'command',events:['PreToolUse'],matcher:'contact_bot',command:'printf checked > '+marker}]}));
  let targetTurns=0;automation=new TeamAutomation(f.upstream,f.store,1,async input=>{await input.onRequest?.();targetTurns++;return {text:'CTO independently checked the rollback scope.',model:'fixture-model',fingerprint:'frozen',usage:{inputTokens:1,outputTokens:1}};},f.coordinator);
  const scope=await admission(f,f.a.bot.id);let failures=0;
  const guard=()=>verifyExecutionScope(async()=>{if(failures-->0)throw new KTeamError('broker_unavailable',503);await scope.assertCurrent();},scope.signal);
  const h=await createHarness({scope:{root:f.root,botId:scope.botId,roomId:f.roomId,bindingRevision:1,fingerprint:'frozen',profileRevision:1},workspace:cwd,signal:scope.signal,assertCurrent:guard,onPrompt:async()=>true});
  owner=await h.prepare!({getModelName:()=> 'fixture'},'fixture','use actual contact results',chats.tools({...scope,assertCurrent:guard}));
  failures=2;const failed=await owner.registry.executeTool('contact_bot',{botId:f.b.bot.id,message:'This check must not send.',wait:true});
  assert.match(failed,/harness_scope_check_failed:broker_unavailable/);assert.equal(targetTurns,0);assert.equal(existsSync(marker),false);assert.equal(f.store.operationsWithPrefix('bot-contact:').length,0);
  failures=1;const result=await owner.registry.executeTool('contact_bot',{botId:f.b.bot.id,message:'Please check the rollback scope.',wait:true});
  assert.match(result,/CTO independently checked/);assert.equal(targetTurns,1);assert.equal(existsSync(marker),true);assert.equal(f.store.operationsWithPrefix('bot-contact:').length,1);
  f.broker.room.updateRoomMembers({roomId:f.roomId,removeAgentIds:[f.a.bot.id]},{sessionId:'revoke-test',requestSource:'user',actor:{kind:'user',userId:'user.local'},issuedAt:new Date().toISOString()});
  const denied=await owner.registry.executeTool('contact_bot',{botId:f.b.bot.id,message:'No longer authorized.',wait:true});
  assert.doesNotMatch(denied,/"sent":true/);assert.equal(targetTurns,1);assert.equal(f.store.operationsWithPrefix('bot-contact:').length,1);
 }finally{await owner?.close();chats.close();await automation?.close();for(const[k,v]of Object.entries({KTEAM_MODEL_CONFIG_DIR:previous.config,KTEAM_DISABLE_GLOBAL_PLUGINS:previous.plugins}))if(v===undefined)delete process.env[k];else process.env[k]=v;await f.close();}
});

test('group approval stays at its guarded source without creating a private chat or duplicate notices',async()=>{const f=await setup(),chats=new PrivateConversations(f.upstream,f.store,f.coordinator,()=>{});try{const scope=await admission(f,f.a.bot.id),before=(await f.upstream.membership(f.roomId)).room,roomId=await chats.notifyApproval(scope);assert.equal(roomId,f.roomId);assert.equal(await chats.notifyApproval(scope),f.roomId);const rows=(await new CollaborationService(f.upstream).messages(roomId,0,100)).messages.filter((message:any)=>message.sourceRef?.purpose==='approval');assert.equal(rows.length,0);assert.deepEqual((await f.upstream.membership(f.roomId)).room,before);await assert.rejects(chats.notifyApproval({...scope,assertCurrent:async()=>{throw new KTeamError('team_scope_changed',409);}}),/team_scope_changed/);}finally{chats.close();await f.close();}});

test('user briefs need a real group excerpt and reserve duplicate requests before sending', async () => {
 const f = await setup();
 const chats = new PrivateConversations(f.upstream, f.store, f.coordinator, () => {});
 try {
  const scope = await admission(f, f.a.bot.id);
  const body = 'Please choose the beta or stable release by Friday.';
  const brief = {body, kind:'decision' as const, expectsReply:true, sourceMessageId:undefined};
  const publish = (messageId:string, value=brief) => chats.publishBrief(scope, value, messageId, f.roomId);
  const original = await f.upstream.aimp(f.roomId, 'chat', {...scope.admission, text:'Team: the release is awaiting a decision. '+body});
  const messageId = original.message.messageId;
  assert.equal((await publish(scope.originId)).deliveryReason, 'brief_source_invalid');
  assert.equal((await publish(messageId, {...brief, body:'Unpublished details from the peer room'})).deliveryReason, 'brief_source_invalid');
  const results = await Promise.all([publish(messageId), publish(messageId)]);
  assert.deepEqual(results.map(result => result.deliveryReason).sort(), ['decision','duplicate_suppressed']);
  const receipt = results.find(result => result.delivery === 'dm')!;
  const actual = (await f.upstream.conversationMessage(receipt.roomId, receipt.messageId)).message;
  assert.match(actual.text, /Please choose the beta/);
  assert.equal(actual.sourceRef.originRoomId, f.roomId);
  assert.equal(actual.sourceRef.originMessageId, messageId);
 } finally { chats.close(); await f.close(); }
});

test('a lost proactive private receipt cannot be replayed', async () => {
 const f = await setup();
 const chats = new PrivateConversations(f.upstream, f.store, f.coordinator, () => {});
 try {
  const scope = await admission(f, f.a.bot.id);
  const brief = {body:'Approve option A or B.', kind:'decision' as const, expectsReply:true, sourceMessageId:undefined};
  const sent = await f.upstream.aimp(f.roomId, 'chat', {...scope.admission, text:'Awaiting release decision. '+brief.body});
  const publish = () => chats.publishBrief(scope, brief, sent.message.messageId, f.roomId);
  const send = f.upstream.sendBotPrivate.bind(f.upstream);
  let attempts = 0;
  f.upstream.sendBotPrivate = async (...args:any[]) => {
   attempts++;
   await send(...args);
   throw new Error('synthetic_receipt_lost');
  };
  assert.equal((await publish()).deliveryReason, 'brief_delivery_unknown');
  assert.equal((await publish()).deliveryReason, 'duplicate_suppressed');
  assert.equal(attempts, 1);
 } finally { chats.close(); await f.close(); }
});

test('explicit silence and internal notes finish the normal direct turn without publishing', async () => {
 const f = await setup();
 let automation:TeamAutomation|undefined;
 try {
  const turn = async () => ({text:'（无需发言）',model:'fixture-model',fingerprint:'frozen',usage:{inputTokens:1,outputTokens:1}});
  automation = new TeamAutomation(f.upstream, f.store, 1, turn, f.coordinator);
  for (const [jobId, input, reason] of [
   ['internal-note', 'Please evaluate the current plan.', 'internal_note_suppressed'],
   ['explicit-silence', '停好后不用回复', 'user_requested_silence'],
  ]) {
   const origin = await f.upstream.sendMessage(f.a.roomId,{text:input,kind:'text',threadId:'brief-test',responsePolicy:'none',contextScope:{kind:'room_only'},idempotencyKey:id()});
   f.store.enqueue(jobId!,f.a.roomId,origin.message.messageId);
   await automation.tick();
   const job = f.store.job(jobId!);
   assert.equal(job.state,'noop',JSON.stringify(job));
   assert.equal(job.deliveryReason,reason);
  }
  const history = await f.upstream.messages(f.a.roomId,0,100);
  assert.equal(history.messages.filter((message:any)=>message.sender?.kind==='agent'&&message.sourceRef?.kind!=='aimp_event').length,0);
 } finally { await automation?.close(); await f.close(); }
});

test('group work stages a private brief and publishes the public original first', async () => {
 const f = await setup();
 let automation:TeamAutomation|undefined;
 try {
  const team = f.store.settings(f.roomId)!;
  f.store.configure({...team,mode:'mentions'},team.revision);
  const body = 'Choose the beta or stable release by Friday.';
  const groupText = 'The team has prepared both release tracks. '+body;
  let staged = false;
  automation = new TeamAutomation(f.upstream, f.store, 1, async input => {
   const tool = input.tools?.find(tool => tool.definition.name === 'notify_user');
   assert.ok(tool);
   const result = await tool.execute({text:body,kind:'decision',expects_reply:true}, {} as any);
   assert.deepEqual(JSON.parse(String(result)), {staged:true});
   const direct = await f.upstream.messages(f.a.roomId,0,100);
   assert.ok(!direct.messages.some((message:any) => message.sourceRef?.purpose === 'notice'));
   staged = true;
   return {text:groupText,model:'fixture-model',fingerprint:'frozen',usage:{inputTokens:1,outputTokens:1}};
  }, f.coordinator);
  const original = await f.upstream.sendMessage(f.roomId,{text:'@'+f.a.bot.name+' prepare the release options',kind:'text',threadId:'brief-test',responsePolicy:'none',contextScope:{kind:'room_only'},idempotencyKey:id()});
  f.store.enqueue('group-brief',f.roomId,original.message.messageId);
  await automation.tick();
  const job = f.store.job('group-brief');
  assert.equal(staged,true,JSON.stringify(job));
  assert.equal(job.state,'delivered',JSON.stringify(job));
  const brief = job.briefDeliveries[0];
  assert.equal(brief.delivery,'dm',JSON.stringify(brief));
  const notice = (await f.upstream.conversationMessage(brief.roomId,brief.messageId)).message;
  assert.equal(notice.sourceRef.originMessageId, job.results[0].messageId);
  assert.equal((await f.upstream.conversationMessage(f.roomId,notice.sourceRef.originMessageId)).message.text, groupText);
 } finally { await automation?.close(); await f.close(); }
});
