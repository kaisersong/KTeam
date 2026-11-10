import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,rmSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {TeamStore} from '../src/service/team-store.js';
import {appPreferences,saveAppPreferences} from '../src/service/app-preferences.js';
import {sharedRuntime} from '../src/runtime/native.js';
import {createHarness} from '../src/runtime/harness.js';
import {startHost} from '../src/service/server.js';
import {initConfig} from '../src/service/config.js';
import {hostRequest} from '../src/service/client.js';
import {createDesktopAPI,dispatchDesktop} from '../desktop/semantic-api.js';

test('preferences are bounded, versioned and durable; duplicate and stale writes do not override newer settings',()=>{
 const root=realpathSync(mkdtempSync('/tmp/kteam-settings-'));let store=new TeamStore(root);
 try{
  assert.equal(appPreferences(store).theme,'system');
  const first=saveAppPreferences(store,{expectedRevision:0,theme:'dark',sendShortcut:'modifier-enter',disabledSkills:['proof']});assert.equal(first.revision,1);
  assert.throws(()=>saveAppPreferences(store,{expectedRevision:0,theme:'light'}),/app_settings_changed/);
  assert.throws(()=>saveAppPreferences(store,{expectedRevision:1,fontSize:'16'}),/invalid_app_settings/);
  assert.throws(()=>saveAppPreferences(store,{expectedRevision:1,theme:['light']}),/invalid_app_settings/);
  assert.throws(()=>saveAppPreferences(store,{expectedRevision:1,disabledSkills:['proof','proof']}),/invalid_app_settings/);
  assert.throws(()=>saveAppPreferences(store,{expectedRevision:1,requestSource:'user'}),/unknown_field/);
  store.close();store=new TeamStore(root);assert.deepEqual(appPreferences(store),first);
  assert.equal(saveAppPreferences(store,{expectedRevision:1,density:'compact'}).theme,'dark');
 }finally{store.close();rmSync(root,{recursive:true,force:true});}
});

test('disabled skills are absent from catalog, executable skill and asset lookup; a live disable fences tools',async()=>{
 const root=realpathSync(mkdtempSync('/tmp/kteam-skill-settings-')),previous=process.env.KTEAM_MODEL_CONFIG_DIR;process.env.KTEAM_MODEL_CONFIG_DIR=root;
 try{
  mkdirSync(join(root,'skills/proof/references'),{recursive:true});writeFileSync(join(root,'skills/proof/SKILL.md'),'---\nname: proof\ndescription: Settings proof\n---\nSECRET_SKILL_CANARY');writeFileSync(join(root,'skills/proof/references/proof.txt'),'SECRET_ASSET_CANARY');
  const core=await sharedRuntime();let current=true;const harness=await createHarness({workspace:root,disabledSkills:['proof'],assertSkillsCurrent:()=>{if(!current)throw Error('harness_skills_changed');},signal:AbortSignal.timeout(5000),assertCurrent:async()=>{}});
  assert.ok(!harness.skills.some((s:any)=>s.name==='proof'));assert.ok(!harness.system.includes('SECRET_SKILL_CANARY'));
  const registry=new core.ToolRegistry(harness.registryOptions,harness.tools);
  try{assert.ok(!(await registry.executeTool('skill',{name:'proof'})).includes('SECRET_SKILL_CANARY'));assert.ok(!(await registry.executeTool('skillFetchAssets',{skillName:'proof',kind:'reference',paths:['proof.txt']})).includes('SECRET_ASSET_CANARY'));current=false;await assert.rejects(harness.assertCurrent(),/harness_skills_changed/);}finally{registry.dispose();}
 }finally{if(previous===undefined)delete process.env.KTEAM_MODEL_CONFIG_DIR;else process.env.KTEAM_MODEL_CONFIG_DIR=previous;rmSync(root,{recursive:true,force:true});}
});

test('real host binds settings to KTeam client and semantic API; model failure leaves preferences available',async()=>{
 const root=realpathSync(mkdtempSync('/tmp/kteam-settings-host-'));initConfig(root,{version:1,brokerUrl:'http://127.0.0.1:1',kswarmUrl:'http://127.0.0.1:1'});const host=await startHost({root,upstream:{brokerUrl:'http://127.0.0.1:1',kswarmUrl:'http://127.0.0.1:1'}});
 try{
  const api=createDesktopAPI((route,value)=>hostRequest(root,'kteam-main',route,value));const initial:any=await dispatchDesktop(api,'appPreferences',[]);assert.equal(initial.preferences.revision,0);
  const saved:any=await dispatchDesktop(api,'saveAppPreferences',[{expectedRevision:0,fontSize:16}]);assert.equal(saved.preferences.fontSize,16);
  const profile=await api.saveAppPreferences({expectedRevision:1,displayName:'测试伙伴',avatarDataUrl:''});assert.equal(profile.preferences.displayName,'测试伙伴');
  await assert.rejects(hostRequest(root,'xiaok-main','/v1/app/preferences',{expectedRevision:1,theme:'dark'}),/app_settings_forbidden/);
  await assert.rejects(hostRequest(root,'kteam-main','/v1/app/preferences',{expectedRevision:1,requestSource:'agent'}),/unknown_field/);
  const previous=process.env.KTEAM_MODEL_CONFIG_DIR;process.env.KTEAM_MODEL_CONFIG_DIR=join(root,'broken-models');
  try{mkdirSync(process.env.KTEAM_MODEL_CONFIG_DIR);writeFileSync(join(process.env.KTEAM_MODEL_CONFIG_DIR,'config.json'),'{invalid');await assert.rejects(api.modelSettings());assert.equal((await api.appPreferences()).preferences.fontSize,16);}finally{if(previous===undefined)delete process.env.KTEAM_MODEL_CONFIG_DIR;else process.env.KTEAM_MODEL_CONFIG_DIR=previous;}
  assert.equal((await api.appPreferences()).preferences.revision,2);
  await assert.rejects(hostRequest(root,'xiaok-main','/v1/app/integrations'),/app_settings_forbidden/);
  await assert.rejects(hostRequest(root,'xiaok-main','/v1/model-settings/discover',{}),/app_settings_forbidden/);
  await assert.rejects(hostRequest(root,'xiaok-main','/v1/model-settings/remove',{}),/app_settings_forbidden/);
  assert.deepEqual((await hostRequest(root,'kteam-main','/v1/app/tool-permissions')).permissions,[]);
  await assert.rejects(hostRequest(root,'xiaok-main','/v1/app/tool-permissions'),/app_settings_forbidden/);
  await assert.rejects(hostRequest(root,'xiaok-main','/v1/app/tool-permissions/revoke',{id:'forged'}),/app_settings_forbidden/);
  await assert.rejects(hostRequest(root,'xiaok-main','/v1/tool-approvals/decide',{id:'forged',expectedHash:'forged',decision:'allow_always'}),/app_settings_forbidden/);
  await assert.rejects(hostRequest(root,'kteam-main','/v1/app/tool-permissions/revoke',{id:'forged'}),/tool_permission_changed/);
  await assert.rejects(dispatchDesktop(api,'setConfig',[{apiKey:'forged'}]),/desktop_method_forbidden/);
 }finally{await host.close();rmSync(root,{recursive:true,force:true});}
});
