import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {realUpstreams} from './helpers/real-upstreams.js';
import {TeamStore} from '../src/service/team-store.js';
import {TeamCoordinator} from '../src/service/coordination.js';
import {TeamAutomation} from '../src/service/automation.js';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {sharedRuntime} from '../src/runtime/native.js';
import {kimJudgment,systemOneChoice} from '../src/runtime/decision.js';

const user={requestSource:'user'},models={catalog:async()=>({defaultModelId:'fixture'}),identity:async()=>({model:'fixture-model',fingerprint:'frozen'})};
for(const scenario of ['resume','quiet','revoked','budget','invalid'] as const)test('System One silence is reviewed with real services: '+scenario,async()=>{
 process.env.KTEAM_RUNTIME_ENTRY=resolve('build/shared/kteam-runtime.mjs');
 const f=await realUpstreams(),store=new TeamStore(f.root),coordinator=new TeamCoordinator(f.upstream,store,1,models);
 let automation:TeamAutomation|undefined,routerCalls=0,answerCalls=0;
 try{
  const a=await coordinator.createMember({name:'CTO',modelId:'fixture',requestId:randomUUID()},user),b=await coordinator.createMember({name:'开发',modelId:'fixture',requestId:randomUUID()},user);
  const group=await coordinator.createGroup({title:'产品团队',memberAgentIds:[a.bot.id,b.bot.id],requestId:randomUUID()},user),roomId=group.room.roomId;
  if(scenario==='budget'){const s=store.settings(roomId)!;store.configure({...s,maxRuns:1},s.revision);}
  const text=scenario==='quiet'?'谢谢，先这样。':'你现在可以干了吧';
  const sent=await f.upstream.sendMessage(roomId,{text,kind:'text',threadId:'route-review',responsePolicy:'none',contextScope:{kind:'room_only'},idempotencyKey:randomUUID()});
  store.enqueue('review-job',roomId,sent.message.messageId);
  const turn:any=async(input:any)=>{
   await input.onRequest?.();input.signal.throwIfAborted();
   if(input.maxIterations===1){routerCalls++;assert.equal(input.tools,undefined);assert.equal(JSON.parse(input.prompt).message,text);assert.equal(JSON.parse(input.prompt).history.some((m:any)=>m.messageId===sent.message.messageId),false);return {text:JSON.stringify({members:scenario==='quiet'?[]:scenario==='invalid'?['not-a-room-member']:[a.bot.id],reason:scenario==='quiet'?'纯致谢，无新事项':'用户要求继续，需要核对并回应'}),model:'fixture-model',usage:{inputTokens:1,outputTokens:1}};}
   answerCalls++;return {text:'已开始核对当前可用工具与项目事实。',model:'fixture-model',usage:{inputTokens:1,outputTokens:1}};
  };
  const decisions:any={judge:async()=>({state:'disabled'}),choose:async(input:any)=>{await input.guard();await input.onRequest();await input.guard();if(scenario==='revoked')store.pause(roomId);return {chosen:'none',model:'fast-decision',usage:{inputTokens:2,outputTokens:1}};}};
  automation=new TeamAutomation(f.upstream,store,1,turn,coordinator,undefined,undefined,undefined,decisions);
  await automation.tick();const job=store.jobs(roomId)[0];assert.equal(job.decisionReview.chosen,'none');
  const messages=(await f.upstream.messages(roomId,0,100)).messages;
  if(scenario==='resume'){assert.equal(job.state,'delivered',JSON.stringify(job));assert.equal(routerCalls,1);assert.equal(answerCalls,1);assert.equal(job.calls,3);assert.deepEqual(job.members,[a.bot.id]);assert.equal(messages.length,2);assert.equal(job.results.length,1);await automation.tick();assert.equal(answerCalls,1);}
  if(scenario==='quiet'){assert.equal(job.state,'noop');assert.equal(routerCalls,1);assert.equal(answerCalls,0);assert.equal(job.calls,2);assert.equal(messages.length,1);}
  if(scenario==='revoked'||scenario==='budget'){assert.equal(job.state,'blocked');assert.equal(routerCalls,0);assert.equal(answerCalls,0);assert.equal(job.calls,1);assert.equal(messages.length,1);}
  if(scenario==='invalid'){assert.equal(job.reason,'routing_response_invalid');assert.equal(answerCalls,0);assert.equal(messages.length,1);}
 }finally{await automation?.close();store.close();await f.close();}
});

for(const enabled of [false,true])test('real group routing completes without a deployed K-IM service; enabled='+enabled,async()=>{
 process.env.KTEAM_RUNTIME_ENTRY=resolve('build/shared/kteam-runtime.mjs');const f=await realUpstreams(),store=new TeamStore(f.root),coordinator=new TeamCoordinator(f.upstream,store,1,models),previous=process.env.KTEAM_MODEL_CONFIG_DIR,configDir=join(f.root,'config');mkdirSync(configDir);process.env.KTEAM_MODEL_CONFIG_DIR=configDir;
 let automation:TeamAutomation|undefined;
 try{const core=await sharedRuntime(),config=await core.loadConfig();delete config.systemOne;config.kimDecision={enabled,baseUrl:'http://127.0.0.1:1'};writeFileSync(join(configDir,'config.json'),JSON.stringify(config));
  const member=await coordinator.createMember({name:'CTO',modelId:'fixture',requestId:randomUUID()},user),group=await coordinator.createGroup({title:'无KIM验证',memberAgentIds:[member.bot.id],requestId:randomUUID()},user),roomId=group.room.roomId;
  const sent=await f.upstream.sendMessage(roomId,{text:'继续核对项目',kind:'text',threadId:'no-kim',responsePolicy:'none',contextScope:{kind:'room_only'},idempotencyKey:randomUUID()});store.enqueue('no-kim',roomId,sent.message.messageId);
  const turn:any=async(input:any)=>{await input.onRequest?.();return {text:input.maxIterations===1?JSON.stringify({members:[member.bot.id],reason:'按成员职责继续'}):'已核对当前项目事实。',model:'fixture',fingerprint:'frozen',usage:{inputTokens:1,outputTokens:1}};};
  automation=new TeamAutomation(f.upstream,store,1,turn,coordinator,undefined,undefined,undefined,{choose:systemOneChoice,judge:kimJudgment});await automation.tick();const job=store.job('no-kim');assert.equal(job.state,'delivered',JSON.stringify(job));assert.equal(job.kim.state,enabled?'unavailable':'disabled');assert.equal(job.calls,2);assert.deepEqual(job.members,[member.bot.id]);assert.equal((await f.upstream.messages(roomId,0,100)).messages.filter((m:any)=>m.sender.kind==='agent').length,1);
 }finally{await automation?.close();store.close();if(previous===undefined)delete process.env.KTEAM_MODEL_CONFIG_DIR;else process.env.KTEAM_MODEL_CONFIG_DIR=previous;await f.close();}
});
