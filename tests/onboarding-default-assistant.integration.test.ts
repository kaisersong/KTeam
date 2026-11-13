import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {readFileSync,existsSync} from 'node:fs';
import {ModelSettings} from '../src/service/model-settings.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TeamStore} from '../src/service/team-store.js';
import {TeamCoordinator} from '../src/service/coordination.js';
import {OnboardingService} from '../src/service/onboarding.js';
import {KTeamError} from '../src/errors.js';
import {realUpstreams} from './helpers/real-upstreams.js';
const models={catalog:async()=>({defaultModelId:'fixture'}),identity:async(modelId:string)=>{if(modelId==='missing')throw new KTeamError('model_binding_not_found');return {model:'fixture-model',fingerprint:'fixture'};}};
test('no configured model creates nothing; adding one prepares exactly one default assistant, including after skipping',async()=>{
 const f=await realUpstreams(),store=new TeamStore(f.root),coordinator=new TeamCoordinator(f.upstream,store,1,models),onboarding=new OnboardingService(store,coordinator,f.upstream);
 try{
  const before=(await f.upstream.listBots()).agents.length;
  assert.equal(onboarding.snapshot().assistantConfigured,false);await onboarding.finish({skipped:true});
  await assert.rejects(onboarding.create({modelId:'missing'}),/model_binding_not_found/);assert.equal((await f.upstream.listBots()).agents.length,before);assert.equal((await f.upstream.listTeams()).rooms.length,0);
  const refs=await Promise.all([onboarding.create({modelId:'fixture',expectedFingerprint:'fixture'}),onboarding.create({modelId:'fixture',expectedFingerprint:'fixture'})]);
  assert.equal(refs[0].roomId,refs[1].roomId);assert.equal((await f.upstream.getTeam(refs[0].roomId)).room.title,'小K助理');assert.equal(store.settings(refs[0].roomId)?.kind,'assistant');
  assert.equal(onboarding.snapshot().status,'done');assert.equal(onboarding.snapshot().assistantConfigured,true);
  const reopened=new OnboardingService(store,new TeamCoordinator(f.upstream,store,2,models),f.upstream);assert.equal((await reopened.create({modelId:'fixture'})).botId,refs[0].botId);
  reopened.update({step:'models',restart:true});assert.equal((await reopened.create({modelId:'fixture'})).roomId,refs[0].roomId);
  assert.equal((await f.upstream.listBots()).agents.length,before+1);assert.equal((await f.upstream.listTeams()).rooms.length,1);
 }finally{store.close();await f.close();}
});
test('interrupted assistant creation retains its identity and rejects a different model until receipts are recovered',async()=>{
 const f=await realUpstreams(),store=new TeamStore(f.root),coordinator=new TeamCoordinator(f.upstream,store,1,models),onboarding=new OnboardingService(store,coordinator,f.upstream);
 try{
  const before=(await f.upstream.listBots()).agents.length;
  const create=f.upstream.createBot.bind(f.upstream);let writes=0;f.upstream.createBot=async(input:any)=>{writes++;await create(input);throw new KTeamError('upstream_operation_unknown',503);};
  await assert.rejects(onboarding.create({modelId:'fixture'}),/operation_result_unknown/);assert.equal(onboarding.snapshot().status,'creating');
  await assert.rejects(onboarding.create({modelId:'other'}),/onboarding_creation_pending/);await assert.rejects(onboarding.finish({skipped:true}),/onboarding_creation_pending/);
  f.upstream.createBot=async()=>{throw Error('must not replay');};const restarted=new OnboardingService(store,new TeamCoordinator(f.upstream,store,2,models),f.upstream),result=await restarted.create({modelId:'fixture'});
  assert.equal(writes,1);assert.equal(restarted.snapshot().roomId,result.roomId);assert.equal(restarted.snapshot().assistantConfigured,true);assert.equal((await f.upstream.listBots()).agents.length,before+1);assert.equal((await f.upstream.listTeams()).rooms.length,1);
 }finally{store.close();await f.close();}
});

test('completed assistant receipt overrides stale creating onboarding even after a different default was selected',async()=>{
 const f=await realUpstreams(),store=new TeamStore(f.root),coordinator=new TeamCoordinator(f.upstream,store,1,models);
 try{const ref=await coordinator.bootstrap({requestSource:'user'}),before=(await f.upstream.listBots()).agents.length;store.saveOperation({id:'onboarding:v1',status:'creating',step:'create',modelId:'different-model'},0);
  const onboarding=new OnboardingService(store,coordinator,f.upstream,async()=>{throw Error('must not inspect another model or probe existing assistant');});assert.equal(onboarding.snapshot().status,'done');
  assert.equal((await onboarding.ensureConfigured()).roomId,ref.roomId);assert.equal(store.operation('onboarding:v1').status,'done');assert.equal((await onboarding.create({modelId:'different-model',expectedFingerprint:'different-model-proof'})).botId,ref.botId);assert.equal((await f.upstream.listBots()).agents.length,before);
 }finally{store.close();await f.close();}
});
test('valid saved default provisions one assistant without a connection probe or an open renderer',async()=>{
 const f=await realUpstreams(),store=new TeamStore(f.root),coordinator=new TeamCoordinator(f.upstream,store,1,models),onboarding=new OnboardingService(store,coordinator,f.upstream,async()=>({defaultModelId:'fixture',models:[{id:'fixture'}]}));
 try{const before=(await f.upstream.listBots()).agents.length,results=await Promise.all(Array.from({length:5},()=>onboarding.ensureConfigured()));assert.ok(results.every(result=>result.state==='ready'));assert.equal(new Set(results.map(result=>result.roomId)).size,1);assert.equal((await f.upstream.listBots()).agents.length,before+1);assert.equal(onboarding.snapshot().status,'done');}finally{store.close();await f.close();}
});
test('missing assistant Room recovers the existing Bot from receipts without replaying unknown creation or losing other Rooms',async()=>{
 const f=await realUpstreams(),store=new TeamStore(f.root),coordinator=new TeamCoordinator(f.upstream,store,1,models),db=new DatabaseSync(join(f.root,'broker.sqlite'));
 db.function('solpi_disclosure_write_guard_v1',()=>0);
 try{const ref=await coordinator.bootstrap({requestSource:'user'}),before=(await f.upstream.listBots()).agents.length;
  const originalSettings=store.settings(ref.roomId)!;store.configure({...originalSettings,paused:true,quiet:true},originalSettings.revision);db.exec('PRAGMA foreign_keys=OFF');db.prepare('DELETE FROM aimp_sessions WHERE room_id=?').run(ref.roomId);db.prepare('DELETE FROM room_members WHERE room_id=?').run(ref.roomId);db.prepare('DELETE FROM rooms WHERE room_id=?').run(ref.roomId);await assert.rejects(f.upstream.membership(ref.roomId),/room_not_found/);
  const create=f.upstream.createTeam.bind(f.upstream);let writes=0;f.upstream.createTeam=async(input:any)=>{writes++;await create(input);throw new KTeamError('upstream_operation_unknown',503);};
  const onboarding=new OnboardingService(store,coordinator,f.upstream);await assert.rejects(onboarding.ensureConfigured(),/operation_result_unknown/);f.upstream.createTeam=async()=>{throw Error('must not replay creation');};
  const results=await Promise.all([onboarding.ensureConfigured(),onboarding.ensureConfigured()]);assert.equal(writes,1);assert.equal(results[0].roomId,results[1].roomId);assert.notEqual(results[0].roomId,ref.roomId);assert.equal(results[0].botId,ref.botId);assert.equal(store.settings(results[0].roomId)?.paused,true);assert.equal(store.settings(results[0].roomId)?.quiet,true);assert.equal((await f.upstream.listBots()).agents.length,before);assert.equal((await f.upstream.listTeams()).rooms.length,1);assert.equal((await f.upstream.messages(results[0].roomId,0,100)).messages.length,0);
 }finally{db.close();store.close();await f.close();}
});
test('assistant readiness fails closed on changed membership and upstream failures instead of creating another Room',async()=>{
 const f=await realUpstreams(),store=new TeamStore(f.root),coordinator=new TeamCoordinator(f.upstream,store,1,models),db=new DatabaseSync(join(f.root,'broker.sqlite'));
 db.function('solpi_disclosure_write_guard_v1',()=>0);
 try{const ref=await coordinator.bootstrap({requestSource:'user'}),onboarding=new OnboardingService(store,coordinator,f.upstream);
  db.prepare("UPDATE room_members SET role='member' WHERE room_id=? AND subject_kind='user'").run(ref.roomId);await assert.rejects(onboarding.ensureConfigured(),/conversation_identity_changed/);assert.equal((await f.upstream.listTeams()).rooms.length,1);
  db.prepare("UPDATE room_members SET role='owner' WHERE room_id=? AND subject_kind='user'").run(ref.roomId);f.upstream.membership=async()=>{throw new KTeamError('upstream_unavailable',503);};await assert.rejects(onboarding.ensureConfigured(),/upstream_unavailable/);assert.equal((await f.upstream.listTeams()).rooms.length,1);
 }finally{db.close();store.close();await f.close();}
});

test('real SDK identity recovers keyless local-model onboarding and creates exactly one assistant without probing the model',async()=>{
 const f=await realUpstreams(),store=new TeamStore(f.root),previous=process.env.KTEAM_MODEL_CONFIG_DIR;
 process.env.KTEAM_MODEL_CONFIG_DIR=join(f.root,'runtime');
 const http=await import('node:http');let requests=0;const server=http.createServer((_req,res)=>{requests++;res.writeHead(500);res.end();});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 try{
  const settings=new ModelSettings(),initial=await settings.view(),saved=await settings.save({expectedRevision:initial.revision,label:'本机免密',model:'local-model',protocol:'openai_legacy',baseUrl:'http://127.0.0.1:'+(server.address() as any).port+'/v1',makeDefault:true});
  store.saveOperation({id:'onboarding:v1',status:'creating',step:'create',modelId:saved.defaultModelId},0);
  const before=(await f.upstream.listBots()).agents.length,onboarding=new OnboardingService(store,new TeamCoordinator(f.upstream,store,1),f.upstream);
  const results=await Promise.all(Array.from({length:5},()=>onboarding.ensureConfigured()));assert.ok(results.every(result=>result.state==='ready'));assert.equal(new Set(results.map(result=>result.roomId)).size,1);
  assert.equal((await f.upstream.listBots()).agents.length,before+1);assert.equal((await f.upstream.listTeams()).rooms.length,1);assert.equal(onboarding.snapshot().status,'done');assert.equal(requests,0);
  const reopened=new OnboardingService(store,new TeamCoordinator(f.upstream,store,2),f.upstream);assert.equal((await reopened.ensureConfigured()).botId,results[0].botId);assert.equal((await f.upstream.listBots()).agents.length,before+1);
  assert.equal((await settings.view()).models[0]!.hasKey,false);assert(!readFileSync(join(f.root,'runtime/config.json'),'utf8').includes('kteam-local-unauthenticated'));assert.equal(existsSync(join(f.root,'runtime/credentials/store.json')),false);
 }finally{if(previous===undefined)delete process.env.KTEAM_MODEL_CONFIG_DIR;else process.env.KTEAM_MODEL_CONFIG_DIR=previous;server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));store.close();await f.close();}
});
