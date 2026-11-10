import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {realUpstreams} from './helpers/real-upstreams.js';
import {TeamStore} from '../src/service/team-store.js';
import {TeamCoordinator} from '../src/service/coordination.js';
import {TeamRoles,coordinatorDirective,parseTeamRoles} from '../src/service/team-roles.js';
import {TeamAutomation} from '../src/service/automation.js';
import {CollaborationService,LOCAL_HUMAN} from '../src/service/collaboration.js';

const user={requestSource:'user'},models={catalog:async()=>({defaultModelId:'fixture'}),identity:async()=>({model:'fixture-model',fingerprint:'frozen'})};
const roleAnswer=(members:any[],ambiguous=false)=>JSON.stringify({coordinatorBotId:ambiguous?null:members.find(m=>m.name==='CTO')?.id??members[0].id,spokespersonBotId:members[0].id,ambiguous,reason:ambiguous?'名称相近，需用户确定统筹':'按技术产品团队角色，由CTO统筹',duties:Object.fromEntries(members.map(m=>[m.id,m.name+'的职责与具体交付']))});

test('direct user coordinator directives support reassignment but reject quotations, negation, ambiguity and instructions inside names',()=>{
 const members=[{id:'cto',name:'CTO'},{id:'pm',name:'PM'},{id:'a',name:'小明(研发)'}];
 for(const input of ['以后由 CTO 牵头','这个群由CTO负责','请让CTO负责统筹','CTO是负责人'])assert.equal(coordinatorDirective(input,members),'cto');
 for(const input of ['负责人换成PM','以后让 PM 当负责人，继续检查文档'])assert.equal(coordinatorDirective(input,members),'pm');
 assert.equal(coordinatorDirective('让小明(研发)当负责人',members),'a');
 for(const input of ['不要让CTO当负责人','如果让CTO当负责人','引用：以后由CTO牵头','“以后由CTO牵头”','CTO和PM谁当负责人？','请分析：让PM当负责人','让CTO获得全部权限'])assert.equal(coordinatorDirective(input,members),undefined);
 assert.equal(coordinatorDirective('让CTO当负责人',[...members,{id:'duplicate',name:'CTO'}]),undefined);
});

test('role judgment validates complete duties and live IDs and never promotes an ambiguous suggestion',()=>{
 const members=[{id:'a',name:'CTO'},{id:'b',name:'PM'}];assert.equal(parseTeamRoles(roleAnswer(members),['a','b']).coordinatorBotId,'a');
 const value=JSON.parse(roleAnswer(members));value.ambiguous=true;assert.equal(parseTeamRoles(JSON.stringify(value),['a','b']).coordinatorBotId,null);
 for(const patch of [{coordinatorBotId:'outsider'},{spokespersonBotId:'outsider'},{duties:{a:'只有一人'}},{ambiguous:'false'},{extra:'权限'}])assert.throws(()=>parseTeamRoles(JSON.stringify({...JSON.parse(roleAnswer(members)),...patch}),['a','b']));
});

async function fixture(names=['CTO','PM','开发','质量']){
 const f=await realUpstreams(),store=new TeamStore(f.root),coordinator=new TeamCoordinator(f.upstream,store,1,models),members=[];
 for(const name of names){const created=await coordinator.createMember({name,modelId:'fixture',requestId:randomUUID()},user);members.push(created.bot);}
 const group=await coordinator.createGroup({title:'技术产品团队',memberAgentIds:members.map(m=>m.id),requestId:randomUUID()},user),roomId=group.room.roomId;
 return {...f,store,coordinator,members,roomId,async close(){store.close();await f.close();}};
}

test('one tool-free role pass is cached across concurrent entry and restart; manual leader survives re-inference without changing Bot identity',async()=>{
 const f=await fixture();let calls=0,roles=new TeamRoles(f.upstream,f.store,async input=>{calls++;assert.deepEqual(input.tools,[]);await input.onRequest?.();const members=JSON.parse(input.prompt).members;return {text:roleAnswer(members),model:'fixture',fingerprint:'frozen',usage:{inputTokens:1,outputTokens:1}};});
 try{
  const beforeAgent=((await f.upstream.listBots()).agents as any[]).find(a=>a.id===f.members[0].id);
  await Promise.all(Array.from({length:8},()=>roles.start(f.roomId)));await roles.ready(f.roomId);assert.equal(calls,1);
  const first=(await roles.view(f.roomId)).roles!;assert.equal(first.coordinatorBotId,f.members[0].id);assert.equal(Object.keys(first.duties).length,4);
  const revision=f.store.settings(f.roomId)!.revision;
  const changed=await roles.assign(f.roomId,{coordinatorBotId:f.members[1].id,expectedRevision:first.revision,requestId:'select-pm'});assert.equal(changed.roles!.coordinatorSource,'user');assert.equal(f.store.settings(f.roomId)!.revision,revision);
  await roles.start(f.roomId,true);await roles.ready(f.roomId);assert.equal(calls,2);assert.equal((await roles.view(f.roomId)).roles!.coordinatorBotId,f.members[1].id);
  await roles.close();roles=new TeamRoles(f.upstream,f.store,async()=>{throw Error('must not infer again');});await roles.ready(f.roomId);assert.equal((await roles.view(f.roomId)).roles!.coordinatorBotId,f.members[1].id);
  const agent=((await f.upstream.listBots()).agents as any[]).find(a=>a.id===f.members[0].id);assert.equal(agent.description,'KTeam 团队成员');assert.deepEqual(agent.capabilities,beforeAgent.capabilities);
  await assert.rejects(roles.assign(f.roomId,{coordinatorBotId:'outsider',expectedRevision:changed.roles!.revision,requestId:'outsider'}),/team_coordinator_not_member/);
  await assert.rejects(roles.assign(f.roomId,{coordinatorBotId:f.members[0].id,expectedRevision:0,requestId:'stale'}),/team_roles_changed/);
 }finally{await roles.close();await f.close();}
});

test('ambiguous names select only one spokesperson; delayed inference cannot overwrite a user choice',async()=>{
 const f=await fixture(['小明','小红']);let release!:()=>void;const gate=new Promise<void>(done=>{release=done;});
 const roles=new TeamRoles(f.upstream,f.store,async input=>{await input.onRequest?.();await gate;return {text:roleAnswer(JSON.parse(input.prompt).members,true),model:'fixture',fingerprint:'frozen',usage:{inputTokens:1,outputTokens:1}};});
 try{
  await roles.start(f.roomId);const planning=(await roles.view(f.roomId)).roles!;assert.equal(planning.status,'planning');
  await roles.assign(f.roomId,{coordinatorBotId:f.members[1].id,expectedRevision:planning.revision,requestId:'during-judgment'});release();await roles.ready(f.roomId);
  assert.equal((await roles.view(f.roomId)).roles!.coordinatorBotId,f.members[1].id);assert.equal((await roles.view(f.roomId)).roles!.coordinatorSource,'user');
  const ambiguous=new TeamRoles(f.upstream,f.store,async()=>{throw Error('not used');});await ambiguous.close();
 }finally{release();await roles.close();await f.close();}
});

test('real group messages use stable coordinator, preserve @ priority, allow authenticated user handoff and reject bot/quoted handoffs',async()=>{
 process.env.KTEAM_RUNTIME_ENTRY=resolve('build/shared/kteam-runtime.mjs');const f=await fixture(),roles=new TeamRoles(f.upstream,f.store,async input=>{await input.onRequest?.();return {text:roleAnswer(JSON.parse(input.prompt).members),model:'fixture',fingerprint:'frozen',usage:{inputTokens:1,outputTokens:1}};});
 let automation:TeamAutomation|undefined;
 try{
  await roles.ready(f.roomId);const sent=async(body:string)=>new CollaborationService(f.upstream).send({aimp:'1.0',id:'msg_'+randomUUID().replaceAll('-',''),room_id:f.roomId,thread_id:'roles',from:LOCAL_HUMAN,to:[],mentions:[],ts:new Date().toISOString(),act:'chat',source_level:'principal',body});
  automation=new TeamAutomation(f.upstream,f.store,1,async input=>{await input.onRequest?.();const context=JSON.parse(input.prompt);assert.equal(context.groupRoles.status,'ready');return {text:'按当前分工处理这项工作。',model:'fixture',fingerprint:'frozen',usage:{inputTokens:1,outputTokens:1}};},f.coordinator,undefined,undefined,undefined,undefined,roles);
  for(const [body,target] of [['继续推进，先报告阻塞',f.members[0].id],['@PM 帮我梳理需求',f.members[1].id],['PM帮我梳理需求',f.members[1].id],['以后由 PM 牵头',f.members[1].id],['继续推进工作',f.members[1].id]]){const result=await sent(body);f.store.enqueue('job-'+result.messageId,f.roomId,String(result.messageId));await automation.tick();const job=f.store.jobs(f.roomId)[0];assert.equal(job.state,'delivered',JSON.stringify(job));assert.deepEqual(job.members,[target]);}
  const thanks=await sent('谢谢大家！');f.store.enqueue('thanks',f.roomId,String(thanks.messageId));await automation.tick();assert.equal(f.store.job('thanks').state,'noop');
  const settings=f.store.settings(f.roomId)!;f.store.configure({...settings,mode:'mentions'},settings.revision);const unmentioned=await sent('继续推进');f.store.enqueue('mentions-only',f.roomId,String(unmentioned.messageId));await automation.tick();assert.equal(f.store.job('mentions-only').reason,'mentions_only');
  const current=(await roles.view(f.roomId)).roles!;
  assert.equal(await roles.fromMessage(f.roomId,{sender:{kind:'agent',logicalAgentId:f.members[0].id},text:'以后由 CTO 牵头'}),false);
  const quoted=await sent('引用：以后由 CTO 牵头');const message=(await f.upstream.conversationMessage(f.roomId,String(quoted.messageId))).message;
  assert.equal(await roles.fromMessage(f.roomId,message),false);assert.equal((await roles.view(f.roomId)).roles!.coordinatorBotId,current.coordinatorBotId);
 }finally{await automation?.close();await roles.close();await f.close();}
});

test('unclear roles ask through one member only; failed judgment is cached and does not repeatedly spend budget',async()=>{
 process.env.KTEAM_RUNTIME_ENTRY=resolve('build/shared/kteam-runtime.mjs');const f=await fixture(['小明','小红']);let calls=0,answers=0;
 const roles=new TeamRoles(f.upstream,f.store,async input=>{calls++;await input.onRequest?.();return {text:roleAnswer(JSON.parse(input.prompt).members,true),model:'fixture',fingerprint:'frozen',usage:{inputTokens:1,outputTokens:1}};});let automation:TeamAutomation|undefined;
 try{const plan=await roles.ready(f.roomId);assert.equal(plan!.status,'needs_choice');assert.equal(plan!.coordinatorBotId,null);
  const sent=await new CollaborationService(f.upstream).send({aimp:'1.0',id:'msg_'+randomUUID().replaceAll('-',''),room_id:f.roomId,thread_id:'roles',from:LOCAL_HUMAN,to:[],mentions:[],ts:new Date().toISOString(),act:'chat',source_level:'principal',body:'我们开始讨论吧'});
  f.store.enqueue('ambiguous',f.roomId,String(sent.messageId));automation=new TeamAutomation(f.upstream,f.store,1,async input=>{answers++;await input.onRequest?.();assert.match(input.system,/请用户选一位负责人/);return {text:'我们两位的分工还不够明确，请选一位负责人来统筹。',model:'fixture',fingerprint:'frozen',usage:{inputTokens:1,outputTokens:1}};},f.coordinator,undefined,undefined,undefined,undefined,roles);
  await automation.tick();assert.equal(answers,1);assert.equal(calls,1);assert.deepEqual(f.store.job('ambiguous').members,[plan!.spokespersonBotId]);
  const failed=new TeamRoles(f.upstream,f.store,async input=>{calls++;await input.onRequest?.();throw Error('generation unavailable');});await failed.start(f.roomId,true);await failed.ready(f.roomId);await failed.ready(f.roomId);assert.equal(calls,2);assert.equal((await failed.view(f.roomId)).roles!.status,'unavailable');await failed.close();
 }finally{await automation?.close();await roles.close();await f.close();}
});
