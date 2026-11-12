import {privateTempDir as mkdtempSync} from './helpers/private-temp.js';
import {tmpdir} from 'node:os';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rmSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {TeamStore} from '../src/service/team-store.js';
import {TeamAutomation} from '../src/service/automation.js';
import type {Upstreams} from '../src/adapters/upstream.js';
import {DatabaseSync} from 'node:sqlite';
import {KTeamError} from '../src/errors.js';

const user={sessionId:'test',requestSource:'user',actor:{kind:'user',userId:'user.local'},issuedAt:new Date().toISOString()};
function originalReads(broker:any,roomId:string){const unwrap=(result:any)=>{if(!result.ok)throw new KTeamError(result.code);return result;};return {
 membership:async()=>unwrap(broker.room.getRoomMembership({roomId},user)),
 messages:async(_room:string,afterSequence:number,limit:number,beforeSequence?:number,tail=false)=>unwrap(broker.room.listRoomMessages({roomId,afterSequence,limit,beforeSequence,direction:tail?'backward':'forward'},user)),
 conversationMessage:async(_room:string,messageId:string)=>unwrap(broker.room.workspace.getConversationMessage({roomId,messageId},user)),
};}

test('startup reconciliation is a barrier for concurrent work and close',async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'kteam-start-barrier-')));const store=new TeamStore(root);
 let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});
 store.prepareSubmission('pending','room','hash',{});store.enqueue('new','room','origin');
 const upstream={messages:async()=>{await gate;return {messages:[],hasMoreBefore:false};}} as unknown as Upstreams;
 const automation=new TeamAutomation(upstream,store,1);
 try{automation.start();await automation.tick();assert.equal(store.jobs()[0].state,'queued');const closed=automation.close();release();await closed;assert.equal(store.jobs()[0].state,'queued');}
 finally{release();await automation.close();store.close();rmSync(root,{recursive:true,force:true});}
});
test('budget rollback restores memory and persistent call count before any new request',()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'kteam-budget-')));const store=new TeamStore(root),fault=new DatabaseSync(join(root,'team-extensions.sqlite'));
 try{
  const team=store.configure({roomId:'room',goal:'draft',mode:'auto',paused:false,quiet:false,revision:0,maxRuns:6,dailyCalls:20},0);
  store.enqueue('job','room','origin');const job=store.claim();
  fault.exec("CREATE TRIGGER fail_budget BEFORE INSERT ON team_call_budgets BEGIN SELECT RAISE(ABORT,'write failure'); END;");
  assert.throws(()=>store.reserveCall(job,team),/write failure/);assert.equal(job.calls,0);assert.equal(store.jobs()[0].calls,0);
  fault.exec('DROP TRIGGER fail_budget');store.reserveCall(job,team);assert.equal(job.calls,1);assert.equal(store.jobs()[0].calls,1);
 }finally{fault.close();store.close();rmSync(root,{recursive:true,force:true});}
});
for(const loss of ['none','chat','agent-event:deliver','verify-delivery','chat-unconfirmed'])test('controller reconciles '+loss+' receipt with real broker facts without repeating inference',async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'kteam-receipt-')));
 const {createBrokerService}=await import('intent-broker/src/broker/service.js' as string);
 const broker=createBrokerService({dbPath:join(root,'broker.sqlite'),aimpEnabled:true});
 const roomId=broker.room.createRoom({title:'receipt',memberAgentIds:['a']},user).room.roomId;
 broker.aimp.configure({roomId,expectedRevision:0,goal:'draft',allowedActions:['discussion'],maxRuns:6},user);
 broker.room.sendRoomMessage({roomId,threadId:'thread',kind:'text',text:'@CEO 草稿',responsePolicy:'none',contextScope:{kind:'room_only'},idempotencyKey:'origin'},user);
 const origin=broker.room.getCollaborationRoom({roomId},user).messages[0];
 const store=new TeamStore(root);store.configure({roomId,goal:'draft',mode:'auto',paused:false,quiet:false,revision:0,maxRuns:6,dailyCalls:20},0);
 store.bind({botId:'a',kind:'xiaok-hosted',modelId:'fixture',model:'fixture',fingerprint:'none',revision:1});store.enqueue('job',roomId,origin.messageId);
 let lost=false,inferences=0;
 const upstream={...originalReads(broker,roomId),listBots:async()=>({agents:[{id:'a',name:'CEO'}]}),aimp:async(_room:string,command:string,input:any={})=>{
  const ctx=input.logicalAgentId?{...user,requestSource:'agent',actor:{kind:'agent',logicalAgentId:'a'},allowedLogicalAgentIds:['a']}:user;
  if(loss==='chat-unconfirmed'&&command==='chat')throw new KTeamError('upstream_operation_unknown',503);
  const method=({session:'getSession',tasks:'listTasks',event:'submit','agent-event':'submit','begin-execution':'beginExecution','execution-check':'checkExecution',chat:'chat','verify-delivery':'verifyDelivery'} as Record<string,string>)[command];assert.ok(method,'unexpected command '+command);
  const result=['session','tasks'].includes(command)?broker.aimp[method!](roomId,user):broker.aimp[method!]({...input,roomId},ctx);
  if(!result.ok)throw new KTeamError(result.code);
  if(!lost&&(command+(input.act?':'+input.act:'')===loss||command===loss)){lost=true;throw new KTeamError('upstream_operation_unknown',503);}
  return result;
 }} as unknown as Upstreams;
 const automation=new TeamAutomation(upstream,store,1,async input=>{inferences++;input.signal.throwIfAborted();await input.onRequest?.();return {text:'# 草稿\n事实缺口。',model:'fixture',fingerprint:'none',usage:{inputTokens:1,outputTokens:1}};});
 try{
  await automation.tick();const job=store.jobs()[0];assert.equal(inferences,1,JSON.stringify(job));assert.equal(job.calls,1);
  if(loss==='chat-unconfirmed'){assert.equal(job.state,'unknown');assert.ok(job.answerDraft);assert.equal(broker.aimp.listTasks(roomId,user).tasks[0].state,'halted');}
  else{assert.equal(job.state,'delivered');assert.equal(broker.aimp.listTasks(roomId,user).tasks[0].artifactVerification.verified,true);assert.equal(broker.room.getCollaborationRoom({roomId},user).messages.length,2);}
 }finally{await automation.close();store.close();broker.close();rmSync(root,{recursive:true,force:true});}
});
test('crash between broker receipt and local job: read-only reconciliation recovers one job without resending',async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'kteam-outbox-')));let store=new TeamStore(root);
 try{
  store.configure({roomId:'room',goal:'draft',mode:'auto',paused:true,quiet:false,revision:0,maxRuns:6,dailyCalls:20},0);
  store.prepareSubmission('id','room','hash',{body:'sent'});store.prepareSubmission('missing','room','other',{body:'not confirmed'});
  assert.throws(()=>store.prepareSubmission('id','room','changed',{}),/aimp_id_conflict/);
  store.close();store=new TeamStore(root);
  let reads=0;
  const upstream={messages:async()=>{reads++;return {hasMoreBefore:false,messages:[{roomSequence:1,messageId:'actual-broker-id',sender:{kind:'user'},sourceRef:{kind:'aimp_l0',envelope:{id:'id'},intentHash:'hash'}}]};}} as unknown as Upstreams;
  const automation=new TeamAutomation(upstream,store,2);
  await automation.reconcileSubmissions();await automation.reconcileSubmissions();await automation.close();
  assert.equal(reads,2);assert.equal(store.jobs().length,1);assert.equal(store.jobs()[0].originId,'actual-broker-id');assert.equal(store.jobs()[0].state,'held');
  assert.deepEqual(store.pendingSubmissions().map(row=>row.id),['missing']);
 }finally{store.close();rmSync(root,{recursive:true,force:true});}
});
test('pause holds unstarted messages; explicit resume releases only held work, never unknown/stopped',()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'kteam-pause-')));let store=new TeamStore(root);
 try{
  store.configure({roomId:'room',goal:'draft',mode:'auto',paused:false,quiet:false,revision:0,maxRuns:6,dailyCalls:20},0);
  store.enqueue('old','room','message');store.pause('room');store.enqueue('during','room','later');
  assert.equal(store.claim(),null);assert.ok(store.jobs('room').every(j=>j.state==='held'));
  store.close();store=new TeamStore(root);store.recover();assert.equal(store.claim(),null);
  store.resume('room');assert.equal(store.claim().id,'old');assert.equal(store.claim().id,'during');
  store.enqueue('stopped','room','old');const stopped=store.claim();stopped.state='stopped';store.save(stopped);
  store.enqueue('unknown','room','old');store.claim();store.recover();store.pause('room');store.resume('room');assert.equal(store.claim(),null);
  store.enqueue('new','room','new');assert.equal(store.claim().id,'new');
 }finally{store.close();rmSync(root,{recursive:true,force:true});}
});
for(const scenario of [{hold:'event',stopFailure:false},{hold:'agent-event',stopFailure:false},{hold:'begin-execution',stopFailure:false},{hold:'event',stopFailure:true}])test('pause during '+scenario.hold+' late receipt reports fence '+(scenario.stopFailure?'unknown':'persisted'),async()=>{
 const {hold,stopFailure}=scenario;
 const root=realpathSync(mkdtempSync(join(tmpdir(),'kteam-race-')));
 const {createBrokerService}=await import('intent-broker/src/broker/service.js' as string);
 const broker=createBrokerService({dbPath:join(root,'broker.sqlite'),aimpEnabled:true});
 const roomId=broker.room.createRoom({title:'test',memberAgentIds:['a']},user).room.roomId;
 broker.aimp.configure({roomId,expectedRevision:0,goal:'draft',allowedActions:['discussion'],maxRuns:6},user);
 const sent=broker.room.sendRoomMessage({roomId,threadId:'thread',kind:'text',text:'@CEO 请准备草稿',responsePolicy:'none',contextScope:{kind:'room_only'},idempotencyKey:'origin'},user);assert.equal(sent.ok,true,JSON.stringify(sent));const origin=sent.message;
 const store=new TeamStore(root);store.configure({roomId,goal:'draft',mode:'auto',paused:false,quiet:false,revision:0,maxRuns:6,dailyCalls:20},0);
 store.bind({botId:'a',kind:'xiaok-hosted',modelId:'no-model-call-allowed',model:'none',fingerprint:'none',revision:1});store.enqueue('job',roomId,origin.messageId);
 let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>{release=r;}),seen=new Promise<void>(r=>{entered=r;});
 let held=false;
 const upstream={
  ...originalReads(broker,roomId),listBots:async()=>({agents:[{id:'a',name:'CEO'}]}),
  aimp:async(_room:string,command:string,input:any={})=>{
   if(stopFailure&&command==='event'&&input.act==='stop')throw Error('stop transport lost');
   const ctx=input.logicalAgentId?{...user,requestSource:'agent',actor:{kind:'agent',logicalAgentId:'a'},allowedLogicalAgentIds:['a']}:user;
   const calls:Record<string,()=>any>={session:()=>broker.aimp.getSession(roomId,user),tasks:()=>broker.aimp.listTasks(roomId,user),event:()=>broker.aimp.submit({...input,roomId},ctx),'agent-event':()=>broker.aimp.submit({...input,roomId},ctx),'begin-execution':()=>broker.aimp.beginExecution({...input,roomId},ctx)};
   assert.ok(calls[command],'unexpected call: '+command);const result=calls[command]!();
   if(!result.ok)throw Error(result.code);
   if(command===hold&&!held){held=true;entered();await gate;}
   return result;
  }
 } as unknown as Upstreams;
 const automation=new TeamAutomation(upstream,store,1);
 try{
  const completion=automation.tick();await seen;const stopped=automation.pause(roomId);release();
  if(stopFailure)await assert.rejects(stopped,/stop_protocol_result_unknown/);else await stopped;
  await completion;
  if(!stopFailure)assert.equal(broker.aimp.listTasks(roomId,user).tasks[0].state,'halted');
  assert.equal(store.jobs(roomId)[0].state,'stopped');
 }finally{await automation.close();store.close();broker.close();rmSync(root,{recursive:true,force:true});}
});
