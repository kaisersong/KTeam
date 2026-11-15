import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {realUpstreams} from './helpers/real-upstreams.js';
import {TeamStore} from '../src/service/team-store.js';
import {TeamCoordinator} from '../src/service/coordination.js';
import {PrivateConversations} from '../src/service/private-conversations.js';
import {TeamAssistant} from '../src/service/assistant.js';
import {TeamAutomation} from '../src/service/automation.js';
import {LOCAL_HUMAN,agentAddress} from '../src/service/collaboration.js';
import {KTeamError} from '../src/errors.js';
const user={requestSource:'user'},models={catalog:async()=>({defaultModelId:'fixture'}),identity:async()=>({model:'fixture-model',fingerprint:'frozen'})};
const id=()=>'msg_'+randomBytes(16).toString('hex');
async function setup(){process.env.KTEAM_RUNTIME_ENTRY=resolve('build/shared/kteam-runtime.mjs');const f=await realUpstreams(),store=new TeamStore(f.root),coordinator=new TeamCoordinator(f.upstream,store,1,models);const master=await coordinator.bootstrap(user),a=await coordinator.createMember({name:'开发',modelId:'fixture',requestId:id()},user),b=await coordinator.createMember({name:'CTO',modelId:'fixture',requestId:id()},user),group=await coordinator.createGroup({title:'产品团队',memberAgentIds:[a.bot.id,b.bot.id],requestId:id()},user);return {...f,store,coordinator,master,a,b,roomId:group.room.roomId,async close(){store.close();await f.close();}};}
async function admission(f:any,botId:string,jobId='source-job'){
 const roomId=f.master.roomId,origin=(await f.upstream.sendMessage(roomId,{text:'查看KTeam源码并与团队协作',kind:'text',threadId:'source',responsePolicy:'none',contextScope:{kind:'room_only'},idempotencyKey:id()})).message;
 let task=(await f.upstream.aimp(roomId,'event',{id:id(),threadId:'source',act:'request',body:'查看源码',payload:{kind:'task.request@1',must_understand:true,description:'查看KTeam源码',deadline:new Date(Date.now()+3600000).toISOString(),expires:new Date(Date.now()+300000).toISOString(),budget:'none',acceptance:{predicates:['artifact_hash']},assignee:agentAddress(botId),reviewer:LOCAL_HUMAN}})).task;
 task=(await f.upstream.aimp(roomId,'agent-event',{logicalAgentId:botId,id:id(),threadId:task.threadId,taskRef:task.taskRef,act:'accept',body:'accept',targetEvent:{id:task.headId,hash:task.headHash},payload:{kind:'task.accept@1',must_understand:true,terms_hash:task.termsHash,caveats:[]}})).task;
 task=(await f.upstream.aimp(roomId,'begin-execution',{logicalAgentId:botId,taskRef:task.taskRef,requestId:'source-run-'+jobId,expectedRevision:task.revision,bindingRevision:1,hostFence:1})).task;
 const grant={logicalAgentId:botId,taskRef:task.taskRef,epoch:task.epoch,bindingRevision:1,hostFence:1};
 f.store.enqueue(jobId,roomId,origin.messageId);const job=f.store.claim();job.state='running';job.activeBotId=botId;f.store.save(job);
 return {roomId,botId,originId:origin.messageId,jobId,admission:grant,signal:AbortSignal.timeout(15000),assertCurrent:async()=>{await f.upstream.aimp(roomId,'execution-check',grant);}};
}

test('Master contacts a Bot outside its room with real sender, execution and reply; no source history or membership expansion',async()=>{
 const f=await setup();let automation:TeamAutomation|undefined,calls=0;
 const chats=new PrivateConversations(f.upstream,f.store,f.coordinator,()=>{void automation!.tick();});
 try{
  automation=new TeamAutomation(f.upstream,f.store,1,async input=>{await input.onRequest?.();calls++;const prompt=JSON.parse(input.prompt);assert.deepEqual(prompt.sourceConversation.history,[]);assert.equal(prompt.sourceConversation.shared,undefined);assert.doesNotMatch(input.prompt,/PRIVATE_SOURCE_SECRET/);return {text:'已独立核实转交事项',model:'fixture-model',fingerprint:'frozen',usage:{inputTokens:1,outputTokens:1}};},f.coordinator);
  await f.upstream.sendMessage(f.master.roomId,{text:'PRIVATE_SOURCE_SECRET',kind:'text',threadId:'private',responsePolicy:'none',contextScope:{kind:'room_only'},idempotencyKey:id()});
  const assistant=new TeamAssistant(f.upstream,f.store);const awareness=await assistant.snapshot(f.master.botId,f.master.roomId);assert.ok(awareness.bots.some(bot=>bot.id===f.b.bot.id&&bot.name==='CTO'));await assistant.close();
  const scope=await admission(f,f.master.botId),before=(await f.upstream.membership(f.b.roomId)).members;
  assert.ok(chats.tools(scope).some(t=>t.definition.name==='send_group_message'));
  const input={botId:f.b.bot.id,message:'请核实这条明确转交事项',wait:true};
  const response=JSON.parse(await chats.contact(scope,input));assert.equal(response.completed,true);assert.equal(calls,1);assert.match(response.text,/独立核实/);
  const rows=(await f.upstream.messages(response.roomId,0,100)).messages,relay=rows.find((m:any)=>m.sourceRef?.kind==='assistant_relay');assert.equal(relay.sender.logicalAgentId,f.master.botId);assert.equal(relay.sourceRef.verifiedExecution,false);assert.equal(relay.sourceRef.originRoomId,f.master.roomId);
  assert.deepEqual((await f.upstream.membership(f.b.roomId)).members,before);
  const again=JSON.parse(await chats.contact(scope,input));assert.equal(again.messageId,response.messageId);assert.equal(calls,1);assert.equal((await f.upstream.messages(response.roomId,0,100)).messages.length,2);
  const ordinary={...scope,botId:f.a.bot.id};assert.equal(chats.tools(ordinary).some(t=>t.definition.name==='send_group_message'),false);await assert.rejects(chats.contact(ordinary,{botId:f.b.bot.id,message:'forbidden'}),/bot_private_scope_denied/);
 }finally{chats.close();await automation?.close();await f.close();}
});
test('Master sends to an unrelated group; paused and revoked targets fail before publication',async()=>{
 const f=await setup();let automation:TeamAutomation|undefined;
 const chats=new PrivateConversations(f.upstream,f.store,f.coordinator,()=>{});
 try{
  automation=new TeamAutomation(f.upstream,f.store,1,async input=>{await input.onRequest?.();return {text:'收到群消息',model:'fixture-model',fingerprint:'frozen',usage:{inputTokens:1,outputTokens:1}};},f.coordinator);
  const scope=await admission(f,f.master.botId),tool=chats.tools(scope).find(t=>t.definition.name==='send_group_message')!;
  const receipt=JSON.parse(await tool.execute({roomId:f.roomId,message:'@开发 请检查本条群消息'},id()));assert.equal(receipt.sent,true);await automation.tick();assert.equal(f.store.job(receipt.jobId).state,'delivered',JSON.stringify(f.store.job(receipt.jobId)));
  assert.equal((await f.upstream.membership(f.roomId)).members.some((m:any)=>m.subject?.logicalAgentId===f.master.botId),false);
  const unmanaged=(await f.upstream.createTeam({title:'其他群',memberAgentIds:[],clientRequestKey:id()})).room.roomId;
  const extra=JSON.parse(await tool.execute({roomId:unmanaged,message:'跨群明确通知',wait:true},id()));assert.equal(extra.sent,true);assert.equal(extra.completed,false);assert.equal(extra.reason,'target_runtime_unmanaged');assert.equal((await f.upstream.messages(unmanaged,0,100)).messages[0].sender.logicalAgentId,f.master.botId);
  f.store.pause(f.roomId);await assert.rejects(tool.execute({roomId:f.roomId,message:'MUST_NOT_PUBLISH'},id()),/bot_private_target_paused/);assert.doesNotMatch(JSON.stringify((await f.upstream.messages(f.roomId,0,100)).messages),/MUST_NOT_PUBLISH/);
  await assert.rejects(tool.execute({roomId:f.b.roomId,message:'not a group'},id()),/assistant_team_forbidden/);
  const snapshot=await f.upstream.membership(f.b.roomId);assert.equal(f.broker.room.archiveRoom({roomId:f.b.roomId,expectedRoomRevision:snapshot.room.revision},{sessionId:'fixture',requestSource:'user',actor:{kind:'user',userId:'user.local'},issuedAt:new Date().toISOString()}).ok,true);
  await assert.rejects(chats.contact(scope,{botId:f.b.bot.id,message:'MUST_NOT_PUBLISH'}));
 }finally{chats.close();await automation?.close();await f.close();}
});
test('lost Master relay receipt is reconciled from the real transcript without sending twice; forged sender and stale admission denied',async()=>{
 const f=await setup(),chats=new PrivateConversations(f.upstream,f.store,f.coordinator,()=>{});
 try{
  const scope=await admission(f,f.master.botId),send=f.upstream.sendOwnerAgentRelay.bind(f.upstream);let sends=0;
  f.upstream.sendOwnerAgentRelay=async(...args:any[])=>{sends++;await send(...args);throw new KTeamError('upstream_operation_unknown',503);};
  const input={botId:f.b.bot.id,message:'只允许真实投递一次',wait:false};await assert.rejects(chats.contact(scope,input),/upstream_operation_unknown/);
  const receipt=JSON.parse(await chats.contact(scope,input));assert.equal(receipt.sent,true);assert.equal(sends,1);assert.equal((await f.upstream.messages(receipt.roomId,0,100)).messages.length,1);
  const room=await f.upstream.membership(f.roomId),body={logicalAgentId:f.master.botId,sourceRoomId:f.master.roomId,admission:scope.admission,text:'MUST_NOT_PUBLISH',idempotencyKey:id(),expectedRoomRevision:room.room.revision};
  await assert.rejects(send(f.roomId,{...body,logicalAgentId:f.a.bot.id}));await assert.rejects(send(f.roomId,{...body,admission:{...scope.admission,epoch:999}}));await assert.rejects(send(f.roomId,{...body,requestSource:'user'}));
  assert.doesNotMatch(JSON.stringify((await f.upstream.messages(f.roomId,0,100)).messages),/MUST_NOT_PUBLISH/);
 }finally{chats.close();await f.close();}
});

test('Master group work uses reserved collaboration capacity, and pausing its source fences further delivery',async()=>{
 const f=await setup(),chats=new PrivateConversations(f.upstream,f.store,f.coordinator,()=>{});
 try{
  const scope=await admission(f,f.master.botId),tool=chats.tools(scope).find(t=>t.definition.name==='send_group_message')!;
  const receipt=JSON.parse(await tool.execute({roomId:f.roomId,message:'明确的群通知'},id()));
  const claimed=f.store.claim([],true);assert.equal(claimed.id,receipt.jobId);
  f.store.pause(f.master.roomId);await assert.rejects(chats.sourceContext(claimed),/assistant_scope_required/);await assert.rejects(tool.execute({roomId:f.roomId,message:'MUST_NOT_PUBLISH'},id()),/assistant_scope_required/);
  assert.doesNotMatch(JSON.stringify((await f.upstream.messages(f.roomId,0,100)).messages),/MUST_NOT_PUBLISH/);
 }finally{chats.close();await f.close();}
});

test('the actual Master automation turn exposes cross-room tools and waits for a separately executed Bot reply',async()=>{
 const f=await setup();let automation:TeamAutomation|undefined,masterCalls=0,targetCalls=0;
 try{
  automation=new TeamAutomation(f.upstream,f.store,1,async input=>{
   await input.onRequest?.();const prompt=JSON.parse(input.prompt);
   if(prompt.team.roomId===f.master.roomId){masterCalls++;assert.match(input.system,/Master Bot/);assert.ok(input.tools!.some(t=>t.definition.name==='send_group_message'));const contact=input.tools!.find(t=>t.definition.name==='contact_bot')!;const reply=JSON.parse(await contact.execute({botId:f.b.bot.id,message:'请独立核实本条指派',wait:true},id()));assert.equal(reply.completed,true);assert.equal(reply.text,'独立核实完成');return {text:'CTO 已返回独立核实结果',model:'fixture-model',fingerprint:'frozen',usage:{inputTokens:1,outputTokens:1}};}
   targetCalls++;return {text:'独立核实完成',model:'fixture-model',fingerprint:'frozen',usage:{inputTokens:1,outputTokens:1}};
  },f.coordinator);
  const origin=(await f.upstream.sendMessage(f.master.roomId,{text:'请让CTO核实本条事项',kind:'text',threadId:'master',responsePolicy:'none',contextScope:{kind:'room_only'},idempotencyKey:id()})).message;
  f.store.enqueue('actual-master-turn',f.master.roomId,origin.messageId);await automation.tick();assert.equal(f.store.job('actual-master-turn').state,'delivered',JSON.stringify(f.store.job('actual-master-turn')));assert.equal(masterCalls,1);assert.equal(targetCalls,1);assert.match(JSON.stringify((await f.upstream.messages(f.master.roomId,0,100)).messages),/CTO 已返回独立核实结果/);
 }finally{await automation?.close();await f.close();}
});
