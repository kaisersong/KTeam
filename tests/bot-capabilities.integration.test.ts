import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {mkdirSync,writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {realUpstreams} from './helpers/real-upstreams.js';
import {TeamStore} from '../src/service/team-store.js';
import {TeamCoordinator} from '../src/service/coordination.js';
import {BotCapabilities,effectiveDisabledSkills} from '../src/service/bot-capabilities.js';
import {Followups} from '../src/service/followups.js';
import {profile,saveBotProfile} from '../src/service/bot-profile.js';
import {appPreferences,saveAppPreferences} from '../src/service/app-preferences.js';
import {createHarness} from '../src/runtime/harness.js';
import {sharedRuntime} from '../src/runtime/native.js';
import {TeamAutomation} from '../src/service/automation.js';
import {CollaborationService,LOCAL_HUMAN} from '../src/service/collaboration.js';
import {initConfig} from '../src/service/config.js';
import {startHost} from '../src/service/server.js';
import {hostRequest} from '../src/service/client.js';

const models={catalog:async()=>({defaultModelId:'fixture'}),identity:async()=>({model:'fixture',fingerprint:'fixture'})};
async function fixture(){const f=await realUpstreams(),store=new TeamStore(f.root),coordinator=new TeamCoordinator(f.upstream,store,1,models);return {...f,store,coordinator,async close(){try{store.close();}catch{}await f.close();}};}
async function member(f:any,name:string){return f.coordinator.createMember({name,modelId:'fixture',requestId:name},{requestSource:'user'});}

test('per-bot skills persist in the real KSwarm profile, preserve other attributes, and cannot re-enable global exclusions',async()=>{
 const f=await fixture(),previous=process.env.KTEAM_MODEL_CONFIG_DIR;process.env.KTEAM_MODEL_CONFIG_DIR=join(f.root,'config');mkdirSync(process.env.KTEAM_MODEL_CONFIG_DIR);
 try{
  const a=await member(f,'技能甲'),b=await member(f,'技能乙'),capabilities=new BotCapabilities(f.upstream,f.store);
  const skills=join(process.env.KTEAM_MODEL_CONFIG_DIR,'skills/proof/references');mkdirSync(skills,{recursive:true});writeFileSync(join(skills,'../SKILL.md'),'---\nname: proof\ndescription: Fictional test skill\n---\nPRIVATE_SKILL_BODY');writeFileSync(join(skills,'proof.txt'),'PRIVATE_ASSET_BODY');
  assert.ok((await capabilities.view(a.bot.id)).skills.some((skill:any)=>skill.name==='proof'));
  const first=await capabilities.save({botId:a.bot.id,expectedRevision:0,disabledSkills:['proof']});assert.deepEqual(first.profile.disabledSkills,['proof']);
  await assert.rejects(capabilities.save({botId:a.bot.id,expectedRevision:0,disabledSkills:[]}),/bot_profile_changed/);
  await assert.rejects(capabilities.save({botId:a.bot.id,expectedRevision:1,disabledSkills:['proof','proof']}),/bot_skills_invalid/);
  await assert.rejects(capabilities.save({botId:a.bot.id,expectedRevision:1,disabledSkills:[],requestSource:'user'}),/unknown_field/);
  await assert.rejects(saveBotProfile(f.upstream,f.store,{botId:a.bot.id,expectedRevision:1,description:'',instructions:'',participation:'auto',workspace:'',followup:false,disabledSkills:[]}),/unknown_field/);
  assert.equal((await capabilities.view(a.bot.id)).skills.find((s:any)=>s.name==='proof').enabled,false);assert.equal((await capabilities.view(b.bot.id)).skills.find((s:any)=>s.name==='proof').enabled,true);
  const actual=(await f.upstream.listBots()).agents.find((bot:any)=>bot.id===a.bot.id);
  const h=await createHarness({workspace:f.root,signal:AbortSignal.timeout(5000),assertCurrent:async()=>{},disabledSkills:effectiveDisabledSkills([],actual)}),core=await sharedRuntime(),registry=new core.ToolRegistry(h.registryOptions,h.tools);
  try{assert.ok(!h.skills.some((skill:any)=>skill.name==='proof'));assert.doesNotMatch(await registry.executeTool('skill',{name:'proof'}),/PRIVATE_SKILL_BODY/);assert.doesNotMatch(await registry.executeTool('skillFetchAssets',{skillName:'proof',kind:'references',paths:['references/proof.txt']}),/PRIVATE_ASSET_BODY/);}finally{registry.dispose();}
  await saveBotProfile(f.upstream,f.store,{botId:a.bot.id,expectedRevision:1,description:'保留技能选择',instructions:'只核对事实',participation:'mentions',workspace:'',followup:false});
  assert.deepEqual(profile((await f.upstream.listBots()).agents.find((bot:any)=>bot.id===a.bot.id)).disabledSkills,['proof']);
  saveAppPreferences(f.store,{expectedRevision:appPreferences(f.store).revision,disabledSkills:['proof']});await capabilities.save({botId:a.bot.id,expectedRevision:2,disabledSkills:[]});
  const global=(await capabilities.view(a.bot.id)).skills.find((skill:any)=>skill.name==='proof');assert.equal(global.enabled,false);assert.equal(global.globallyDisabled,true);
  f.store.bind({...f.store.binding(a.bot.id)!,kind:'local-native',modelId:'local-agent:codex',revision:2});assert.equal((await capabilities.view(a.bot.id)).supported,false);await assert.rejects(capabilities.save({botId:a.bot.id,expectedRevision:3,disabledSkills:[]}),/bot_skills_external/);
 }finally{if(previous===undefined)delete process.env.KTEAM_MODEL_CONFIG_DIR;else process.env.KTEAM_MODEL_CONFIG_DIR=previous;await f.close();}
});

test('cancelled followups cannot be enqueued from a stale scheduler snapshot; cancellation remains durable and Room scoped',async()=>{
 const f=await fixture();let automation:TeamAutomation|undefined;
 try{
  const a=await member(f,'跟进甲'),b=await member(f,'跟进乙');await saveBotProfile(f.upstream,f.store,{botId:a.bot.id,expectedRevision:0,description:'',instructions:'',participation:'auto',workspace:'',followup:true});
  const sent=await new CollaborationService(f.upstream).send({aimp:'1.0',id:'msg_'+randomBytes(16).toString('hex'),room_id:a.roomId,thread_id:'thread-'+a.roomId,from:LOCAL_HUMAN,to:[],mentions:[],ts:new Date().toISOString(),act:'chat',source_level:'principal',body:'虚构的后续核对任务'});
  const binding=f.store.binding(a.bot.id)!,operation=f.store.saveOperation({id:'followup:race-proof',status:'pending',botId:a.bot.id,roomId:a.roomId,originId:sent.messageId,settingsRevision:f.store.settings(a.roomId)!.revision,profileRevision:1,bindingRevision:binding.revision,bindingModelId:binding.modelId,bindingFingerprint:binding.fingerprint,dueAt:Date.now()-1000,reason:'核对示例结果'},0);
  const follows=new Followups(f.upstream,f.store);assert.equal((await follows.list(a.bot.id)).items[0]!.canCancel,true);
  await assert.rejects(follows.cancel({botId:b.bot.id,id:operation.id,expectedRevision:1}),/followup_not_found/);await assert.rejects(follows.cancel({botId:a.bot.id,id:operation.id,expectedRevision:99}),/followup_changed/);
  let entered!:()=>void,release!:()=>void;const held=new Promise<void>(resolve=>{entered=resolve;}),resume=new Promise<void>(resolve=>{release=resolve;});let once=true,calls=0;
  const membership=f.upstream.membership.bind(f.upstream);f.upstream.membership=async(roomId:string)=>{const value=await membership(roomId);if(once){once=false;entered();await resume;}return value;};
  automation=new TeamAutomation(f.upstream,f.store,1,async()=>{calls++;throw Error('must_not_run');},f.coordinator);
  const running=automation.tick();await held;await follows.cancel({botId:a.bot.id,id:operation.id,expectedRevision:1});release();await running;
  assert.equal(calls,0);assert.equal(f.store.job('job-'+operation.id),null);assert.equal((await follows.list(a.bot.id)).items[0]!.reason,'核对示例结果');assert.equal((await follows.list(a.bot.id)).items[0]!.state,'cancelled');assert.equal((await follows.cancel({botId:a.bot.id,id:operation.id,expectedRevision:1})).reused,true);
  await automation.close();automation=undefined;f.store.close();const reopened=new TeamStore(f.root);try{assert.equal(reopened.operation(operation.id).status,'cancelled');}finally{reopened.close();}
 }finally{await automation?.close();await f.close();}
});

test('the real host reserves bot capability and followup controls for KTeam, rejecting forged identities',async()=>{
 const f=await realUpstreams(),root=join(f.root,'host');initConfig(root,{version:1,brokerUrl:f.upstream.options.brokerUrl,kswarmUrl:f.upstream.options.kswarmUrl});const host=await startHost({root,upstream:f.upstream.options});
 try{for(const route of ['/v1/bot-capabilities?botId=missing','/v1/bot-followups?botId=missing']){await assert.rejects(hostRequest(root,'xiaok-main',route),/app_settings_forbidden/);await assert.rejects(hostRequest(root,'kteam-main',route),/bot_not_managed/);}for(const route of ['/v1/bot-skills','/v1/bot-followups/cancel'])await assert.rejects(hostRequest(root,'xiaok-main',route,{requestSource:'user'}),/app_settings_forbidden/);}
 finally{await host.close();await f.close();}
});
