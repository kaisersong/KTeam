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
