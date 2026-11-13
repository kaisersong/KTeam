import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TeamStore} from '../src/service/team-store.js';
import {TeamCoordinator} from '../src/service/coordination.js';
import {CollaborationService,LOCAL_HUMAN,agentAddress} from '../src/service/collaboration.js';
import {KTeamError} from '../src/errors.js';
import {realUpstreams} from './helpers/real-upstreams.js';
import {randomBytes} from 'node:crypto';
const user={requestSource:'user' as const};
const models={catalog:async()=>({defaultModelId:'fixture'}),identity:async(modelId:string)=>({modelId,model:'fixture-model',fingerprint:'frozen'})};
const id=()=> 'msg_'+randomBytes(16).toString('hex');
async function admitted(f:any,coordinator:TeamCoordinator,ref:any){
 const collaboration=new CollaborationService(f.upstream);const envelope={aimp:'1.0',id:id(),room_id:ref.roomId,thread_id:'thread-'+ref.roomId,from:LOCAL_HUMAN,to:[],mentions:[],ts:new Date().toISOString(),act:'chat',source_level:'principal',body:'帮我组一个经营复盘团队'};
 const origin=await collaboration.send(envelope);const request=await f.upstream.aimp(ref.roomId,'event',{id:id(),roomId:ref.roomId,threadId:envelope.thread_id,act:'request',body:envelope.body,payload:{kind:'task.request@1',must_understand:true,description:envelope.body,deadline:new Date(Date.now()+3600000).toISOString(),expires:new Date(Date.now()+300000).toISOString(),budget:'none',acceptance:{predicates:['artifact_hash']},assignee:agentAddress(ref.botId),reviewer:LOCAL_HUMAN}});
 let task=request.task;task=(await f.upstream.aimp(ref.roomId,'agent-event',{logicalAgentId:ref.botId,id:id(),roomId:ref.roomId,threadId:task.threadId,taskRef:task.taskRef,act:'accept',body:'accept',targetEvent:{id:task.headId,hash:task.headHash},payload:{kind:'task.accept@1',must_understand:true,terms_hash:task.termsHash,caveats:[]}})).task;
 const runId='run-'+origin.messageId;task=(await f.upstream.aimp(ref.roomId,'begin-execution',{logicalAgentId:ref.botId,taskRef:task.taskRef,requestId:runId+':'+ref.botId,expectedRevision:task.revision,bindingRevision:1,hostFence:1})).task;
 return {requestSource:'agent' as const,roomId:ref.roomId,threadId:task.threadId,originId:String(origin.messageId),botId:ref.botId,runId,admission:{logicalAgentId:ref.botId,taskRef:task.taskRef,epoch:task.epoch,bindingRevision:1,hostFence:1}};
}
test('concurrent bootstrap is durable and creates one coordinator and one conversation',async()=>{
 const f=await realUpstreams(),store=new TeamStore(f.root);const c=new TeamCoordinator(f.upstream,store,1,models);
 try{const refs=await Promise.all(Array.from({length:8},()=>c.bootstrap(user)));assert.equal(new Set(refs.map(r=>r.roomId)).size,1);assert.equal((await f.upstream.listTeams()).rooms.length,1);assert.equal((await f.upstream.listBots()).agents.filter((b:any)=>b.id===refs[0]!.botId).length,1);const restarted=new TeamCoordinator(f.upstream,store,2,models);assert.equal((await restarted.bootstrap(user)).roomId,refs[0]!.roomId);await assert.rejects(c.bootstrap({requestSource:'agent'} as any),/user_action_required/);}finally{store.close();await f.close();}
});
test('proposal does not create entities; explicit scoped hash acceptance creates one quiet group with evolving shared notes',async()=>{
 const f=await realUpstreams(),store=new TeamStore(f.root),c=new TeamCoordinator(f.upstream,store,1,models);
 try{
  const ref=await c.bootstrap(user),ctx=await admitted(f,c,ref);const before=(await f.upstream.listBots()).agents.length;
  const proposal=await c.propose({title:'经营复盘',goal:'确认本周资料缺口',members:[{name:'CEO'},{name:'CTO'}]},ctx);
  assert.equal((await f.upstream.listBots()).agents.length,before);assert.equal((await f.upstream.listTeams()).rooms.length,1);
  await assert.rejects(c.accept({roomId:ref.roomId,proposalId:proposal.id,expectedHash:'changed'},user),/proposal_changed/);
  await assert.rejects(c.accept({roomId:'another-room',proposalId:proposal.id,expectedHash:proposal.hash},user),/proposal_scope_mismatch/);
  const results=await Promise.all(Array.from({length:5},()=>c.accept({roomId:ref.roomId,proposalId:proposal.id,expectedHash:proposal.hash},user)));
  assert.equal(new Set(results.map(r=>r.roomId)).size,1);assert.equal((await f.upstream.listBots()).agents.length,before+2);assert.equal((await f.upstream.listTeams()).rooms.length,2);
  const draft=await f.upstream.messages(results[0]!.roomId,0,20);assert.equal(draft.messages.length,0);assert.equal(store.jobs(results[0]!.roomId).length,0);const data=await f.upstream.conversationData(results[0]!.roomId);assert.match(data.shared.text,/确认本周资料缺口/);assert.equal(data.shared.revision,1);assert.equal(store.jobs(results[0]!.roomId).length,0);
 }finally{store.close();await f.close();}
});
test('unknown unconfirmed creation is not replayed; frozen model changes reject new side effects',async()=>{
 const f=await realUpstreams(),store=new TeamStore(f.root);let fingerprint='frozen';const c=new TeamCoordinator(f.upstream,store,1,{...models,identity:async modelId=>({modelId,model:'fixture-model',fingerprint})});
 try{
  const ref=await c.bootstrap(user),ctx=await admitted(f,c,ref);let proposal=await c.propose({title:'draft',goal:'资料核对',members:[{name:'运营'}]},ctx);const before=(await f.upstream.listBots()).agents.length;
  fingerprint='changed';await assert.rejects(c.accept({roomId:ref.roomId,proposalId:proposal.id,expectedHash:proposal.hash},user),/model_binding_changed/);assert.equal((await f.upstream.listBots()).agents.length,before);fingerprint='frozen';
  let calls=0;const create=f.upstream.createBot.bind(f.upstream);f.upstream.createBot=async()=>{calls++;throw new KTeamError('upstream_operation_unknown',503);};
  await assert.rejects(c.accept({roomId:ref.roomId,proposalId:proposal.id,expectedHash:proposal.hash},user),/operation_result_unknown/);
  await assert.rejects(c.accept({roomId:ref.roomId,proposalId:proposal.id,expectedHash:proposal.hash},user),/operation_result_unknown/);assert.equal(calls,1);assert.equal((await f.upstream.listBots()).agents.length,before);f.upstream.createBot=create;
 }finally{store.close();await f.close();}
});
test('lost creation receipt is recovered through owner reads after a new host fence, without replay',async()=>{
 const f=await realUpstreams(),store=new TeamStore(f.root),c=new TeamCoordinator(f.upstream,store,1,models);
 try{const ref=await c.bootstrap(user),ctx=await admitted(f,c,ref),p=await c.propose({title:'市场讨论',goal:'核对市场资料',members:[{name:'市场'}]},ctx);const create=f.upstream.createBot.bind(f.upstream);let writes=0;f.upstream.createBot=async(input:any)=>{writes++;await create(input);throw new KTeamError('upstream_operation_unknown',503);};await assert.rejects(c.accept({roomId:ref.roomId,proposalId:p.id,expectedHash:p.hash},user),/operation_result_unknown/);f.upstream.createBot=async()=>{throw Error('must not repeat POST');};const restarted=new TeamCoordinator(f.upstream,store,2,models);const result=await restarted.accept({roomId:ref.roomId,proposalId:p.id,expectedHash:p.hash},user);assert.equal(writes,1);assert.equal((await f.upstream.messages(result.roomId,0,100)).messages.length,0);assert.equal((await restarted.accept({roomId:ref.roomId,proposalId:p.id,expectedHash:p.hash},user)).roomId,result.roomId);
 }finally{store.close();await f.close();}
});
test('direct conversation reuses bound member and survives reopening; model-origin acceptance is forbidden',async()=>{
 const f=await realUpstreams(),store=new TeamStore(f.root),c=new TeamCoordinator(f.upstream,store,1,models);
 try{const ref=await c.bootstrap(user),ctx=await admitted(f,c,ref),p=await c.propose({title:'协作',goal:'整理资料',members:[{name:'资料员'}]},ctx);await assert.rejects(c.accept({roomId:ref.roomId,proposalId:p.id,expectedHash:p.hash},{requestSource:'agent'}),/user_action_required/);await assert.rejects(c.accept({...{roomId:ref.roomId,proposalId:p.id,expectedHash:p.hash},members:[]} as any,user),/unknown_field/);await c.accept({roomId:ref.roomId,proposalId:p.id,expectedHash:p.hash},user);const member=p.members[0]!;const [a,b]=await Promise.all([c.direct(member.botId,user),c.direct(member.botId,user)]);assert.equal(a.roomId,b.roomId);assert.equal((await new TeamCoordinator(f.upstream,store,2,models).direct(member.botId,user)).roomId,a.roomId);assert.equal((await f.upstream.messages(a.roomId,0,100)).messages.length,0);assert.equal(store.settings(a.roomId)?.kind,'direct');
 }finally{store.close();await f.close();}
});
const ownerContext={sessionId:'coordination-test',requestSource:'user',actor:{kind:'user',userId:'user.local'},issuedAt:new Date().toISOString()};
test('resuming a partial group rejects changed recipients, including other humans, without sending the goal',async()=>{
 for(const addition of [{addAgentIds:['unapproved-observer']},{addUserIds:['another-human']}]){
  const f=await realUpstreams(),store=new TeamStore(f.root),c=new TeamCoordinator(f.upstream,store,1,models);
  try{const ref=await c.bootstrap(user),ctx=await admitted(f,c,ref),p=await c.propose({title:'范围冻结',goal:'仅供批准的成员讨论',members:[{name:'复核员'}]},ctx);const aimp=f.upstream.aimp.bind(f.upstream);f.upstream.aimp=async(room:string,command:string,input:any)=>{const result=await aimp(room,command,input);if(command==='configure'&&room!==ref.roomId)throw new KTeamError('upstream_operation_unknown',503);return result;};await assert.rejects(c.accept({roomId:ref.roomId,proposalId:p.id,expectedHash:p.hash},user),/operation_result_unknown/);f.upstream.aimp=aimp;const target=store.operation('accept:'+p.id).stages.room.receipt.roomId;assert.equal(f.broker.room.updateRoomMembers({roomId:target,...addition},ownerContext).ok,true);await assert.rejects(new TeamCoordinator(f.upstream,store,2,models).accept({roomId:ref.roomId,proposalId:p.id,expectedHash:p.hash},user),/conversation_identity_changed/);assert.equal((await f.upstream.messages(target,0,100)).messages.length,0);
  }finally{store.close();await f.close();}
 }
});
test('private conversation refuses to remain private after external membership changes',async()=>{
 const f=await realUpstreams(),store=new TeamStore(f.root),c=new TeamCoordinator(f.upstream,store,1,models);
 try{const created=await c.createMember({name:'私聊成员',modelId:'fixture',requestId:'private-test'},user),direct=await c.direct(created.bot.id,user);assert.equal(direct.roomId,created.roomId);assert.equal(f.broker.room.updateRoomMembers({roomId:direct.roomId,addUserIds:['observer']},ownerContext).ok,true);await assert.rejects(c.direct(created.bot.id,user),/conversation_identity_changed/);await assert.rejects(c.guardConversation(direct.roomId),/conversation_identity_changed/);
 }finally{store.close();await f.close();}
});
test('manual creation has durable recoverable intents through member and contract receipt loss',async()=>{
 const f=await realUpstreams(),store=new TeamStore(f.root),c=new TeamCoordinator(f.upstream,store,1,models);
 try{const create=f.upstream.createBot.bind(f.upstream);let writes=0;f.upstream.createBot=async(input:any)=>{writes++;await create(input);throw new KTeamError('upstream_operation_unknown',503);};await assert.rejects(c.createMember({name:'新成员',modelId:'fixture',requestId:'manual-test'},user),/operation_result_unknown/);assert.equal(c.pendingCreations().length,1);f.upstream.createBot=async()=>{throw Error('no replay');};const restarted=new TeamCoordinator(f.upstream,store,2,models),member=await restarted.resumeCreation({id:c.pendingCreations()[0]!.id},user);assert.equal(writes,1);assert.equal(store.settings(member.roomId)?.kind,'direct');const aimp=f.upstream.aimp.bind(f.upstream);f.upstream.aimp=async(room:string,cmd:string,input:any)=>{const result=await aimp(room,cmd,input);if(cmd==='configure')throw new KTeamError('upstream_operation_unknown',503);return result;};await assert.rejects(restarted.createGroup({title:'手动群',goal:'共同目标',memberAgentIds:[member.bot.id],requestId:'group-test'},user),/operation_result_unknown/);f.upstream.aimp=aimp;const final=await new TeamCoordinator(f.upstream,store,3,models).resumeCreation({id:restarted.pendingCreations()[0]!.id},user);assert.equal(store.settings(final.room.roomId)?.kind,'group');assert.equal(restarted.pendingCreations().length,0);
 }finally{store.close();await f.close();}
});
test('private reply is not published when recipients change while the model is running',async()=>{
 const {TeamAutomation}=await import('../src/service/automation.js');const f=await realUpstreams(),store=new TeamStore(f.root),c=new TeamCoordinator(f.upstream,store,1,models);let automation:InstanceType<typeof TeamAutomation>|undefined;
 try{const created=await c.createMember({name:'私聊',modelId:'fixture',requestId:'reply-scope'},user);const envelope={aimp:'1.0',id:id(),room_id:created.roomId,thread_id:'thread-'+created.roomId,from:LOCAL_HUMAN,to:[],mentions:[],ts:new Date().toISOString(),act:'chat',source_level:'principal',body:'请整理当前私聊资料'};const origin=await new CollaborationService(f.upstream).send(envelope);store.enqueue('job-private',created.roomId,String(origin.messageId));automation=new TeamAutomation(f.upstream,store,1,async input=>{await input.onRequest?.();assert.equal(f.broker.room.updateRoomMembers({roomId:created.roomId,addUserIds:['observer']},ownerContext).ok,true);return {text:'原私聊的答复',model:'fixture-model',fingerprint:'frozen',usage:{inputTokens:1,outputTokens:1}};},c);await automation.tick();assert.equal(store.jobs()[0].state,'blocked');assert.equal(store.jobs()[0].reason,'conversation_identity_changed');const messages=(await f.upstream.messages(created.roomId,0,100)).messages;assert.equal(messages.some((m:any)=>m.sourceRef?.kind==='aimp_reply'||m.text==='原私聊的答复'),false);
 }finally{await automation?.close();store.close();await f.close();}
});
test('queued work does not call a model or publish when the owner cannot enforce message revision CAS',async()=>{
 const {TeamAutomation}=await import('../src/service/automation.js');const f=await realUpstreams(),store=new TeamStore(f.root),c=new TeamCoordinator(f.upstream,store,1,models);let automation:InstanceType<typeof TeamAutomation>|undefined;
 try{const member=await c.createMember({name:'兼容性检查',modelId:'fixture',requestId:'cap-gate'},user);const origin=await new CollaborationService(f.upstream).send({aimp:'1.0',id:id(),room_id:member.roomId,thread_id:'thread-'+member.roomId,from:LOCAL_HUMAN,to:[],mentions:[],ts:new Date().toISOString(),act:'chat',source_level:'principal',body:'准备草稿'});store.enqueue('cap-job',member.roomId,String(origin.messageId));f.upstream.requireReady=async()=>{throw new KTeamError('upstream_protocol_unavailable',503);};let calls=0;automation=new TeamAutomation(f.upstream,store,1,async()=>{calls++;throw Error('must not infer');},c);await automation.tick();assert.equal(calls,0);assert.equal(store.jobs()[0].state,'blocked');assert.equal((await f.upstream.messages(member.roomId,0,100)).messages.length,1);
 }finally{await automation?.close();store.close();await f.close();}
});

test('assistant Bot proposal creates a single private Bot after scoped confirmation and survives receipt loss',async()=>{
 const f=await realUpstreams(),store=new TeamStore(f.root),c=new TeamCoordinator(f.upstream,store,1,models);
 try{
  const before=(await f.upstream.listBots()).agents.length;const ref=await c.bootstrap(user),ctx=await admitted(f,c,ref),p=await c.proposeBot({name:'资料核对员'},ctx);
  assert.equal(p.kind,'bot');assert.equal((await f.upstream.listBots()).agents.length,before+1);assert.equal((await f.upstream.listTeams()).rooms.length,1);
  await assert.rejects(c.proposeBot({name:'另一位',modelId:'injected'},ctx),/unknown_field/);
  await assert.rejects(c.accept({roomId:ref.roomId,proposalId:p.id,expectedHash:p.hash},{requestSource:'agent'}),/user_action_required/);
  await assert.rejects(c.accept({roomId:ref.roomId,proposalId:p.id,expectedHash:'changed'},user),/proposal_changed/);
  const create=f.upstream.createBot.bind(f.upstream);let writes=0;f.upstream.createBot=async(value:any)=>{writes++;await create(value);throw new KTeamError('upstream_operation_unknown',503);};
  const input={roomId:ref.roomId,proposalId:p.id,expectedHash:p.hash};await assert.rejects(c.accept(input,user),/operation_result_unknown/);
  f.upstream.createBot=async()=>{throw Error('must not replay');};const restarted=new TeamCoordinator(f.upstream,store,2,models),results=await Promise.all([restarted.accept(input,user),restarted.accept(input,user)]);
  assert.equal(writes,1);assert.equal(results[0]!.roomId,results[1]!.roomId);const roomId=results[0]!.roomId;
  assert.equal(store.settings(roomId)?.kind,'direct');assert.equal((await f.upstream.listBots()).agents.length,before+2);assert.equal((await f.upstream.listTeams()).rooms.length,2);
  assert.equal((await f.upstream.messages(roomId,0,100)).messages.length,0);assert.equal((await restarted.direct(p.members[0]!.botId,user)).roomId,roomId);
  assert.equal((await new TeamCoordinator(f.upstream,store,3,models).accept(input,user)).roomId,roomId);
 }finally{store.close();await f.close();}
});
