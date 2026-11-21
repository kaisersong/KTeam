import assert from 'node:assert/strict';
import {test} from 'node:test';
import {join} from 'node:path';
import {mkdirSync} from 'node:fs';
import {realUpstreams} from './helpers/real-upstreams.js';
import {TeamStore} from '../src/service/team-store.js';
import {TeamCoordinator} from '../src/service/coordination.js';
import {planReviewPreset} from '../src/protocol/member-presets.js';

test('a reviewed preset provisions one quiet member, preserves edited instructions and recovers after a lost receipt',async()=>{
 const fixture=await realUpstreams();
 const root=join(fixture.root,'host');
 mkdirSync(root,{mode:0o700});
 const store=new TeamStore(root);
 const coordinator=new TeamCoordinator(fixture.upstream,store,1,{
  catalog:async()=>({defaultModelId:'fixture'}),
  identity:async()=>({model:'fixture',fingerprint:'fixture-v1'}),
 });
 const user={requestSource:'user'};
 const setup={presetId:planReviewPreset.id,description:'核对合成评审材料',instructions:'请列出合成材料的证据缺口。'};
 const input={name:'合成方案评审',modelId:'fixture',requestId:'review-preset',setup};
 const upstream=fixture.upstream;
 const register=upstream.createBot.bind(upstream);
 let creates=0;
 upstream.createBot=async (value:Record<string,unknown>)=>{
  creates++;
  const result=await register(value);
  if(creates===1)throw Error('lost_fixture_receipt');
  return result;
 };
 try {
  await assert.rejects(coordinator.createMember(input,{requestSource:'agent'}),/user_action_required/);
  await assert.rejects(coordinator.createMember({...input,setup:{...setup,workspace:'/tmp'}},user),/unknown_field/);
  assert.equal(creates,0);
  await assert.rejects(coordinator.createMember(input,user),/operation_result_unknown/);
  assert.equal(creates,1);
  await assert.rejects(coordinator.createMember({...input,setup:{...setup,instructions:'different'}},user),/bot_create_request_conflict/);

  const result=await coordinator.resumeCreation({id:'manual-member:'+input.requestId},user);
  assert.equal(result.presetId,planReviewPreset.id);
  assert.deepEqual(await coordinator.createMember(input,user),result);
  assert.equal(creates,1);
  const agent=(await upstream.listBots()).agents.find((agent:any)=>agent.id===result.bot.id);
  assert.equal(agent.description,setup.description);
  assert.equal(agent.instructions,setup.instructions);
  assert.deepEqual(agent.kteamProfile,{revision:1,participation:'mentions',workspace:'',followup:false});
  assert.deepEqual((await upstream.messages(result.roomId,0,20)).messages,[]);
  assert.deepEqual(store.jobs(result.roomId),[]);

  const custom={name:'合成自定义成员',modelId:'fixture',requestId:'plain-member'};
  const [plain,alternate]=await Promise.allSettled([
   coordinator.createMember(custom,user),
   coordinator.createMember({...custom,setup},user),
  ]);
  assert.equal(plain.status,'fulfilled');
  assert.equal(alternate.status,'rejected');
  assert.match(String(alternate.reason),/bot_create_request_conflict/);
  assert.equal(creates,2);
  assert.equal(plain.value.presetId,undefined);
 } finally {
  store.close();
  await fixture.close();
 }
});
