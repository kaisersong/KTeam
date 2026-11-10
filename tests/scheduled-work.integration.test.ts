import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolve,join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {realUpstreams} from './helpers/real-upstreams.js';
import {TeamStore} from '../src/service/team-store.js';
import {TeamCoordinator} from '../src/service/coordination.js';
import {TeamAutomation} from '../src/service/automation.js';
import {ScheduledWork} from '../src/service/scheduled-work.js';
import {saveBotProfile} from '../src/service/bot-profile.js';
import {CollaborationService,LOCAL_HUMAN} from '../src/service/collaboration.js';
import {startHost} from '../src/service/server.js';
import {hostRequest} from '../src/service/client.js';
import {initConfig} from '../src/service/config.js';
const models={catalog:async()=>({defaultModelId:'fixture'}),identity:async()=>({model:'fixture',fingerprint:'fixture'})};
async function fixture(){
 process.env.KTEAM_RUNTIME_ENTRY=resolve('build/shared/xiaok-runtime.mjs');const f=await realUpstreams();let store=new TeamStore(f.root),coordinator=new TeamCoordinator(f.upstream,store,1,models),automation:TeamAutomation;let turns=0;
 const bot=await coordinator.createMember({name:'资料跟进者',modelId:'fixture',requestId:'schedule-owner'},{requestSource:'user'});
 await saveBotProfile(f.upstream,store,{botId:bot.bot.id,expectedRevision:0,description:'核对材料',instructions:'依据事实',participation:'auto',workspace:'',followup:true});
 const origin=await new CollaborationService(f.upstream).send({aimp:'1.0',id:'msg_'+randomBytes(16).toString('hex'),room_id:bot.roomId,thread_id:'source',from:LOCAL_HUMAN,to:[],mentions:[],ts:new Date().toISOString(),act:'chat',source_level:'principal',body:'请稍后检查一次材料进展'});
 const turn=async(input:any)=>{await input.onRequest?.();turns++;if(input.tools?.some((t:any)=>t.definition.name==='schedule_follow_up')){await input.tools.find((t:any)=>t.definition.name==='schedule_follow_up').execute({delayMinutes:10,reason:'检查材料是否到位'});return{text:'已安排稍后检查',model:'fixture',fingerprint:'fixture',usage:{inputTokens:1,outputTokens:1}};}return{text:'{"notify":false}',model:'fixture',fingerprint:'fixture',usage:{inputTokens:1,outputTokens:1}};};
 automation=new TeamAutomation(f.upstream,store,1,turn,coordinator);store.enqueue('schedule-source-job',bot.roomId,String(origin.messageId));await automation.tick();
 return {...f,bot,get store(){return store;},get coordinator(){return coordinator;},get automation(){return automation;},get schedules(){return new ScheduledWork(f.upstream,store,coordinator);},get turns(){return turns;},async restart(){await automation.close();store.close();store=new TeamStore(f.root);coordinator=new TeamCoordinator(f.upstream,store,2,models);automation=new TeamAutomation(f.upstream,store,2,turn,coordinator);},async close(){await automation.close();store.close();await f.close();}};
}
test('upcoming work projects only actual future receipts; pause survives restart and resume executes once through the original queue',async()=>{
 const f=await fixture();try{
  let view=await f.schedules.view(f.bot.roomId);assert.equal(view.schedules.length,1);let item=view.schedules[0]!;assert.equal(item.kind,'once');assert.equal(item.title,'检查材料是否到位');assert.equal(f.store.jobs().length,1,'delivered conversation history is not future work');
  await f.schedules.change(f.bot.roomId,{id:item.id,expectedRevision:item.revision,action:'pause'});assert.equal((await f.schedules.change(f.bot.roomId,{id:item.id,expectedRevision:item.revision,action:'pause'})).reused,true);
  await f.restart();item=(await f.schedules.view(f.bot.roomId)).schedules[0]!;assert.equal(item.state,'paused');
  let pending=f.store.operation(item.id);f.store.saveOperation({...pending,dueAt:Date.now()-1},pending.revision);await f.automation.tick();assert.equal(f.turns,1);assert.equal(f.store.job('job-'+item.id),null);
  item=(await f.schedules.view(f.bot.roomId)).schedules[0]!;await f.schedules.change(f.bot.roomId,{id:item.id,expectedRevision:item.revision,action:'resume'});
  pending=f.store.operation(item.id);f.store.saveOperation({...pending,dueAt:Date.now()-1},pending.revision);await f.automation.tick();assert.equal(f.turns,2);assert.equal(f.store.job('job-'+item.id).reason,'followup_no_new_finding');assert.equal((await f.schedules.view(f.bot.roomId)).schedules.length,0);await f.automation.tick();assert.equal(f.turns,2);
 }finally{await f.close();}
});
test('future-work controls reject other members, stale revisions and changed sources; cancellation is durable and idempotent',async()=>{
 const f=await fixture();try{
  const item=(await f.schedules.view(f.bot.roomId)).schedules[0]!,other=await f.coordinator.createMember({name:'其他成员',modelId:'fixture',requestId:'other-schedule-owner'},{requestSource:'user'});
  assert.equal((await f.schedules.view(other.roomId)).schedules.length,0);await assert.rejects(f.schedules.change(other.roomId,{id:item.id,expectedRevision:item.revision,action:'cancel'}),/scheduled_work_forbidden/);
  await f.schedules.change(f.bot.roomId,{id:item.id,expectedRevision:item.revision,action:'pause'});await assert.rejects(f.schedules.change(f.bot.roomId,{id:item.id,expectedRevision:item.revision,action:'cancel'}),/scheduled_work_changed/);
  await f.upstream.sendMessage(f.bot.roomId,{text:'更新了这项工作的方向',kind:'text',threadId:'source',responsePolicy:'none',contextScope:{kind:'room_only'},idempotencyKey:'source-update'});
  const paused=(await f.schedules.view(f.bot.roomId)).schedules[0]!;assert.equal(paused.unavailable,'来源对话已有更新');await assert.rejects(f.schedules.change(f.bot.roomId,{id:item.id,expectedRevision:paused.revision,action:'resume'}),/scheduled_work_scope_changed/);
  const cancel={id:item.id,expectedRevision:paused.revision,action:'cancel'};await f.schedules.change(f.bot.roomId,cancel);assert.equal((await f.schedules.change(f.bot.roomId,cancel)).reused,true);assert.equal((await f.schedules.view(f.bot.roomId)).schedules.length,0);
 }finally{await f.close();}
});
test('pause wins a race with a due check before any job is admitted',async()=>{
 const f=await fixture();try{
  const op=f.store.operationsWithPrefix('followup:')[0];f.store.saveOperation({...op,dueAt:Date.now()-1},op.revision);const item=(await f.schedules.view(f.bot.roomId)).schedules[0]!;
  const read=f.upstream.messages.bind(f.upstream);let first=true,release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>release=r),seen=new Promise<void>(r=>entered=r);
  f.upstream.messages=async(...args:any[])=>{if(first){first=false;entered();await gate;}return read(...args);};
  const ticking=f.automation.tick();await seen;await f.schedules.change(f.bot.roomId,{id:item.id,expectedRevision:item.revision,action:'pause'});release();await ticking;
  assert.equal(f.store.operation(item.id).status,'paused');assert.equal(f.store.job('job-'+item.id),null);assert.equal(f.turns,1);
 }finally{await f.close();}
});
test('the host exposes a semantic read surface and restricts schedule changes to the desktop user client',async()=>{
 const f=await realUpstreams(),root=join(f.root,'desktop');let host:Awaited<ReturnType<typeof startHost>>|undefined;try{
  initConfig(root,{version:1,brokerUrl:f.upstream.options.brokerUrl,kswarmUrl:f.upstream.options.kswarmUrl});
  host=await startHost({root,upstream:f.upstream.options});const room=(await f.upstream.createTeam({title:'独立权限检查',description:'测试',memberAgentIds:[],clientRequestKey:'schedule-api-test'})).room.roomId;
  await assert.rejects(hostRequest(root,'kteam-main','/v1/teams/'+room+'/scheduled-work'),/scheduled_work_forbidden/);
  await assert.rejects(hostRequest(root,'xiaok-main','/v1/teams/'+room+'/scheduled-work',{id:'followup:untrusted',expectedRevision:1,action:'resume'}),/user_action_required/);
 }finally{await host?.close();await f.close();}
});
test('Bot details aggregate its accessible group arrangements while group details only show their own plans',async()=>{
 const f=await fixture();try{
  const group=await f.coordinator.createGroup({title:'待跟进项目',memberAgentIds:[f.bot.bot.id],requestId:'schedule-group'},{requestSource:'user'}),roomId=group.room.roomId;
  const origin=await new CollaborationService(f.upstream).send({aimp:'1.0',id:'msg_'+randomBytes(16).toString('hex'),room_id:roomId,thread_id:'source',from:LOCAL_HUMAN,to:[],mentions:[],ts:new Date().toISOString(),act:'chat',source_level:'principal',body:'@资料跟进者 稍后检查这项材料'});
  f.store.enqueue('group-schedule-source',roomId,String(origin.messageId));await f.automation.tick();
  const botView=await f.schedules.view(f.bot.roomId),groupView=await f.schedules.view(roomId);assert.equal(botView.schedules.length,2);assert.equal(groupView.schedules.length,1);assert.equal(groupView.schedules[0]?.sourceRoomId,roomId);
  const direct=botView.schedules.find(s=>s.sourceRoomId===f.bot.roomId)!;await assert.rejects(f.schedules.change(roomId,{id:direct.id,expectedRevision:direct.revision,action:'pause'}),/scheduled_work_forbidden/);
  const settings=f.store.settings(roomId)!;f.store.configure({...settings,kind:undefined},settings.revision);assert.equal((await f.schedules.view(roomId)).schedules.length,1,'legacy groups must not aggregate another conversation');
 }finally{await f.close();}
});
