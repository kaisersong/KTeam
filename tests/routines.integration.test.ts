import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolve,join} from 'node:path';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {realUpstreams} from './helpers/real-upstreams.js';
import {TeamStore} from '../src/service/team-store.js';
import {TeamCoordinator} from '../src/service/coordination.js';
import {TeamAutomation} from '../src/service/automation.js';
import {Routines} from '../src/service/routines.js';
import {saveBotProfile} from '../src/service/bot-profile.js';
import {KTeamError} from '../src/errors.js';
import {ToolApprovals} from '../src/service/tool-approvals.js';
import {initConfig} from '../src/service/config.js';
import {startHost} from '../src/service/server.js';
import {hostRequest} from '../src/service/client.js';
const models={catalog:async()=>({defaultModelId:'fixture'}),identity:async()=>({model:'fixture',fingerprint:'fixture'})};
async function setup(){const f=await realUpstreams(),config=join(f.root,'config');mkdirSync(config);const previous=process.env.KTEAM_MODEL_CONFIG_DIR;process.env.KTEAM_MODEL_CONFIG_DIR=config;const dataRoot=join(f.root,'host-data');mkdirSync(dataRoot);const store=new TeamStore(dataRoot),coordinator=new TeamCoordinator(f.upstream,store,1,models),member=await coordinator.createMember({name:'周报负责人',modelId:'fixture',requestId:'routine-bot'},{requestSource:'user'});return {...f,store,coordinator,member,async end(){store.close();if(previous===undefined)delete process.env.KTEAM_MODEL_CONFIG_DIR;else process.env.KTEAM_MODEL_CONFIG_DIR=previous;await f.close();}};}
const input=(f:any,now:number,requestId='routine-one')=>({roomId:f.member.roomId,botId:f.member.bot.id,name:'核对材料形成周报',prompt:'阅读本会话资料并生成周报，结果回到本群。',schedule:{kind:'interval',startAt:now+60000,minutes:15},timeZone:'Asia/Shanghai',maxRuns:3,endAt:null,enabled:true,expectedRevision:0,requestId,overlap:'skip'});
test('named routines persist definitions, deduplicate saves and due keys, and never catch up missed runs',async()=>{
 const f=await setup();let now=Date.now(),changed=0;const routines=new Routines(f.upstream,f.store,()=>now,()=>changed++);
 try{const request=input(f,now),saved=await routines.save(request),row=saved.routine;
  assert.equal((await routines.save(request)).reused,true);assert.equal(changed,1);
  await assert.rejects(routines.save({...request,name:'different'}),/routine_request_conflict/);
  await assert.rejects(routines.save({...request,id:row.id,requestId:'stale',expectedRevision:0}),/routine_changed/);
  await routines.wake();assert.equal(f.store.jobs().length,0);
  now+=61000;await Promise.all([routines.wake(),routines.wake()]);assert.equal(f.store.jobs().length,1);assert.equal(f.store.operationsWithPrefix('routine-run:').length,1);
  const afterDue=f.store.operation(row.id);await routines.save(request);assert.equal(f.store.operation(row.id).nextAt,afterDue.nextAt);assert.equal(changed,1);
  const first=f.store.jobs()[0];first.state='delivered';f.store.save(first);
  now+=3600000;await routines.wake();assert.equal(f.store.jobs().length,1);assert.equal(f.store.operationsWithPrefix('routine-run:')[0].outcome,'missed');
  const listed=(await routines.list(f.member.roomId)).items[0]!;assert.ok(listed.nextAt>now);assert.equal(listed.runCount,1);
  const reopened=new TeamStore(f.store.root);try{assert.equal(new Routines(f.upstream,reopened,()=>now).assertJob({...first,trigger:undefined}),undefined);assert.equal((await new Routines(f.upstream,reopened).list(f.member.roomId)).items[0]!.runs.length,2);}finally{reopened.close();}
 }finally{await f.end();}
});
test('pause wins over an awaited due snapshot, and source read failures back off without advancing a successful cursor',async()=>{
 const f=await setup();let now=Date.now();const routines=new Routines(f.upstream,f.store,()=>now);
 try{const created=await routines.save(input(f,now)),before=f.store.operation(created.routine.id);now+=61000;
  const membership=f.upstream.membership.bind(f.upstream);let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(resolve=>release=resolve),seen=new Promise<void>(resolve=>entered=resolve);let held=false;
  f.upstream.membership=async(roomId:string)=>{if(!held){held=true;entered();await gate;}return membership(roomId);};
  const waking=routines.wake();await seen;await routines.save({...input(f,now),id:before.id,expectedRevision:before.revision,enabled:false,requestId:'pause-before-enqueue'});release();await waking;
  assert.equal(f.store.jobs().length,0);assert.equal(f.store.operation(before.id).enabled,false);
  f.upstream.membership=membership;const paused=f.store.operation(before.id);await routines.save({...input(f,now),id:paused.id,expectedRevision:paused.revision,requestId:'resume-new-future'});const resumed=f.store.operation(paused.id);now=resumed.nextAt+1;
  f.upstream.membership=async()=>{throw new KTeamError('upstream_unavailable',503);};await routines.wake();const failed=f.store.operation(paused.id);assert.equal(failed.nextAt,resumed.nextAt);assert.equal(failed.runCount,0);assert.ok(failed.retryAt>now);assert.equal(f.store.jobs().length,0);
  f.upstream.membership=membership;await routines.wake();assert.equal(f.store.jobs().length,0);now=failed.retryAt;await routines.wake();assert.equal(f.store.jobs().length,1);
 }finally{await f.end();}
});
test('routines skip overlapping work, freeze uncertain results, require explicit future resumption, and obey run limits',async()=>{
 const f=await setup();let now=Date.now();const routines=new Routines(f.upstream,f.store,()=>now);
 try{const saved=await routines.save({...input(f,now),maxRuns:2});now+=61000;await routines.wake();const first=f.store.jobs()[0];first.state='running';f.store.save(first);
  now+=15*60000;await routines.wake();assert.equal(f.store.jobs().length,1);assert.equal(f.store.operationsWithPrefix('routine-run:')[0].outcome,'overlap');
  first.state='unknown';f.store.save(first);now+=15*60000;await routines.wake();const frozen=f.store.operation(saved.routine.id);assert.equal(frozen.enabled,false);assert.equal(frozen.reason,'routine_result_needs_review');
  await routines.save({...input(f,now),id:frozen.id,expectedRevision:frozen.revision,maxRuns:2,requestId:'reviewed-future-only'});now+=61000;await routines.wake();assert.equal(f.store.jobs().length,2);assert.equal(f.store.operation(frozen.id).nextAt,null);assert.equal(f.store.operation(frozen.id).runCount,2);assert.equal(f.store.job(first.id).state,'unknown');
  const last=f.store.operation(frozen.id);await assert.rejects(routines.save({...input(f,now),id:last.id,expectedRevision:last.revision,maxRuns:2,requestId:'over-limit'}),/routine_limit_reached/);
 }finally{await f.end();}
});
test('a due routine uses the original AIMP queue and real file tool, delivers one answer, and rejects stale profiles',async()=>{
 process.env.KTEAM_RUNTIME_ENTRY=resolve('build/shared/kteam-runtime.mjs');const f=await setup();let now=Date.now(),turns=0;let automation:TeamAutomation|undefined;
 try{const workspace=join(f.root,'materials');mkdirSync(workspace);writeFileSync(join(workspace,'weekly.md'),'合成周报材料：本周完成两项核对，剩余一项待确认。');await saveBotProfile(f.upstream,f.store,{botId:f.member.bot.id,expectedRevision:0,description:'核对周报',instructions:'使用真实材料',participation:'mentions',workspace,followup:false});
  automation=new TeamAutomation(f.upstream,f.store,1,async turn=>{turns++;await turn.onRequest?.();assert.equal(JSON.parse(turn.prompt).routine.source,'用户在KTeam设置的例行任务');const tool=turn.tools!.find(tool=>tool.definition.name==='read');assert.ok(tool);const result=await tool.execute({file_path:join(workspace,'weekly.md')},{});assert.match(result,/合成周报材料/);return {text:'已核对周报材料：完成两项，剩余一项待确认。',model:'fixture',fingerprint:'fixture',usage:{inputTokens:1,outputTokens:1}};},f.coordinator,undefined,undefined,undefined,undefined,undefined,()=>now);
  await automation.routines.save({...input(f,now),schedule:{kind:'once',at:now+60000},maxRuns:1});now+=61000;await automation.tick();assert.equal(turns,1,JSON.stringify(f.store.jobs()));const job=f.store.jobs()[0];assert.equal(job.trigger,'routine');assert.equal(job.state,'delivered',JSON.stringify(job));assert.equal(job.toolTrace[0].name,'read');assert.ok(job.results[0].messageId);assert.match((await f.upstream.conversationMessage(f.member.roomId,job.results[0].messageId)).message.text,/完成两项/);await automation.tick();assert.equal(turns,1);
  await automation.routines.save(input(f,now,'profile-fence'));now+=61000;await automation.routines.wake();await saveBotProfile(f.upstream,f.store,{botId:f.member.bot.id,expectedRevision:1,description:'新职责',instructions:'不同范围',participation:'auto',workspace,followup:false});await automation.tick();assert.equal(turns,1);assert.equal(f.store.jobs()[0].reason,'routine_scope_changed');
 }finally{await automation?.close();await f.end();}
});
test('a group routine can consult a real member, requires an explicit write approval, and leaves an actual report',async()=>{
 process.env.KTEAM_RUNTIME_ENTRY=resolve('build/shared/kteam-runtime.mjs');const f=await setup(),approvals=new ToolApprovals(f.store);let now=Date.now(),automation:TeamAutomation|undefined,turns=0;
 try{const reviewer=await f.coordinator.createMember({name:'报告审阅员',modelId:'fixture',requestId:'routine-reviewer'},{requestSource:'user'}),group=await f.coordinator.createGroup({title:'合成周报团队',memberAgentIds:[f.member.bot.id,reviewer.bot.id],requestId:'routine-team'},{requestSource:'user'}),workspace=join(f.root,'reports');mkdirSync(workspace);
  await saveBotProfile(f.upstream,f.store,{botId:f.member.bot.id,expectedRevision:0,description:'周报',instructions:'按来源写报告',participation:'mentions',workspace,followup:false});
  const report=join(workspace,'weekly-report.html');
  automation=new TeamAutomation(f.upstream,f.store,1,async turn=>{await turn.onRequest?.();turns++;
   const prompt=JSON.parse(turn.prompt);if(prompt.sourceConversation?.routine){assert.equal(prompt.sourceConversation.userMessage,undefined);return {text:'审阅意见：请标明合成资料及待确认项。',model:'fixture',fingerprint:'fixture',usage:{inputTokens:1,outputTokens:1}};}
   const contact=turn.tools!.find(tool=>tool.definition.name==='contact_bot')!;assert.ok(contact);const reply=JSON.parse(await contact.execute({botId:reviewer.bot.id,message:'请审阅周报范围。',wait:true},{}));assert.equal(reply.completed,true);
   const adapter={getModelName:()=> 'fixture',getModelPolicy:()=>({contextLimit:200000,compactThreshold:0.85}),async*stream(){yield {type:'done'};}};const owner=await turn.prepareRuntime!(adapter,'fixture',turn.system,turn.tools!);try{const written=await owner.runOwned(()=>owner.registry.executeTool('write',{file_path:report,content:'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>合成项目周报</title><h1>合成项目周报</h1><p>本周已核对两项，剩余一项待确认。此为合成验收资料。</p></html>'}));assert.match(String(written),/已写入/,String(written));}finally{await owner.close();}
   return {text:'已结合审阅意见生成合成项目周报 weekly-report.html，待你验收。',model:'fixture',fingerprint:'fixture',usage:{inputTokens:1,outputTokens:1}};
  },f.coordinator,undefined,undefined,approvals,undefined,undefined,()=>now);
  await automation.routines.save({...input(f,now),roomId:group.room.roomId,maxRuns:1,schedule:{kind:'once',at:now+60000}});now+=61000;const work=automation.tick();
  const deadline=Date.now()+10000;while(!approvals.list().length&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));const pending=approvals.list()[0];assert.ok(pending,JSON.stringify(f.store.jobs()));assert.equal(pending.toolName,'write');assert.equal(pending.sourceRoomId,group.room.roomId);assert.notEqual(pending.roomId,group.room.roomId);assert.equal(approvals.permissions.list().length,0);
  await approvals.decide({id:pending.id,expectedHash:pending.hash,decision:'allow_once'});await work;assert.equal(turns,2);const job=f.store.jobs(group.room.roomId)[0];assert.equal(job.state,'delivered',JSON.stringify(job));assert.match(readFileSync(report,'utf8'),/合成项目周报/);assert.ok(job.results[0].messageId);assert.equal(approvals.permissions.list().length,0);
 }finally{approvals.close();await automation?.close();await f.end();}
});
test('routine semantic routes require the KTeam user client and real Room membership',async()=>{
 const f=await realUpstreams(),root=join(f.root,'host');initConfig(root,{version:1,brokerUrl:f.upstream.options.brokerUrl,kswarmUrl:f.upstream.options.kswarmUrl});const host=await startHost({root,upstream:f.upstream.options});
 try{await assert.rejects(hostRequest(root,'kteam-companion','/v1/routines?roomId=missing'),/user_action_required/);for(const route of ['/v1/routines','/v1/routines/remove','/v1/routines/pause'])await assert.rejects(hostRequest(root,'kteam-companion',route,{requestSource:'user'}),/user_action_required/);await assert.rejects(hostRequest(root,'kteam-main','/v1/routines?roomId=missing'),/routine_scope_denied/);await assert.rejects(hostRequest(root,'kteam-main','/v1/routines',{requestSource:'user'}),/unknown_field/);}
 finally{await host.close();await f.close();}
});
test('pausing a routine during its real approval stops the old write and rejects the late approval',async()=>{
 process.env.KTEAM_RUNTIME_ENTRY=resolve('build/shared/kteam-runtime.mjs');const f=await setup(),approvals=new ToolApprovals(f.store);let now=Date.now(),automation:TeamAutomation|undefined;
 try{const workspace=join(f.root,'pause-work');mkdirSync(workspace);await saveBotProfile(f.upstream,f.store,{botId:f.member.bot.id,expectedRevision:0,description:'暂停检查',instructions:'真实执行',participation:'auto',workspace,followup:false});
  automation=new TeamAutomation(f.upstream,f.store,1,async turn=>{await turn.onRequest?.();const adapter={getModelName:()=> 'fixture',getModelPolicy:()=>({contextLimit:200000,compactThreshold:0.85}),async*stream(){yield {type:'done'};}},owner=await turn.prepareRuntime!(adapter,'fixture',turn.system,turn.tools!);try{await owner.runOwned(()=>owner.registry.executeTool('write',{file_path:join(workspace,'must-not-exist.html'),content:'must not write'}));}finally{await owner.close();}return {text:'must not publish',model:'fixture',fingerprint:'fixture',usage:{inputTokens:1,outputTokens:1}};},f.coordinator,undefined,undefined,approvals,undefined,undefined,()=>now);
  const request=input(f,now),saved=await automation.routines.save(request);now+=61000;const work=automation.tick();const deadline=Date.now()+10000;while(!approvals.list().length&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));const pending=approvals.list()[0];assert.ok(pending);const row=f.store.operation(saved.routine.id);
  await automation.routines.pause({roomId:request.roomId,id:row.id,expectedRevision:row.revision});await work;
  assert.equal(f.store.jobs()[0].state,'stopped');assert.equal(approvals.list().length,0);await assert.rejects(approvals.decide({id:pending.id,expectedHash:pending.hash,decision:'allow_once'}),/tool_approval_expired/);assert.throws(()=>readFileSync(join(workspace,'must-not-exist.html')),/ENOENT/);assert.equal((await f.upstream.messages(f.member.roomId,0,100)).messages.some((message:any)=>message.text==='must not publish'),false);
 }finally{approvals.close();await automation?.close();await f.end();}
});
test('an occurrence that expires in the original queue stays quiet and does not freeze the next valid cycle',async()=>{
 process.env.KTEAM_RUNTIME_ENTRY=resolve('build/shared/kteam-runtime.mjs');const f=await setup();let now=Date.now(),turns=0,automation:TeamAutomation|undefined;
 try{const routines=new Routines(f.upstream,f.store,()=>now);await routines.save(input(f,now));now+=61000;await routines.wake();const first=f.store.jobs()[0];now+=600000;
  automation=new TeamAutomation(f.upstream,f.store,1,async turn=>{await turn.onRequest?.();turns++;return {text:'当前周期已核对。',model:'fixture',fingerprint:'fixture',usage:{inputTokens:1,outputTokens:1}};},f.coordinator,undefined,undefined,undefined,undefined,undefined,()=>now);
  await automation.tick();assert.equal(turns,0);assert.equal(f.store.job(first.id).state,'noop');assert.equal(f.store.job(first.id).reason,'routine_missed');
  now=f.store.operationsWithPrefix('routine:')[0].nextAt+1;await automation.tick();assert.equal(turns,1);assert.equal(f.store.jobs()[0].state,'delivered');
 }finally{await automation?.close();await f.end();}
});
