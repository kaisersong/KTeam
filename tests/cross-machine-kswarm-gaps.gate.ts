// Protocol-gap probes for locked KSwarm. Not part of npm test: these assertions fail until the upstream claim/redeem/permit protocol exists. Run with: node --test dist/tests/cross-machine-kswarm-gaps.gate.js
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {realUpstreams} from './helpers/real-upstreams.js';

/** Real isolated Hub + SQLite, never a replacement task service. Safety gates intentionally fail when absent. */
async function hubFixture(){
 const {createHub}=await import('kswarm/src/core/hub.js' as string);
 const root=mkdtempSync(join(tmpdir(),'kteam-shared-kswarm-'));
 const options={silent:true,dataDir:{backend:'sqlite',filePath:join(root,'state.sqlite'),legacyJsonPath:join(root,'state.json')}};
 let hub=createHub(options);
 try{
 hub.createProject({id:'probe',name:'共享许可探针',goal:'隔离文本',poAgent:'po',members:['worker'],autoAssignPo:false});
 const added=hub.handleHumanAddTasks('probe',[{id:'one',title:'隔离文本',assignedAgent:'worker',dependencies:[]}],{requestSource:'user'});
 assert.equal(added.ok,true);const taskId=added.taskIds[0];
 const approved=hub.handleApprove('probe');assert.equal(approved.ok,true);
 // Set up an admitted run through the real board's transition inside the Hub's durable boundary.
 // No model executor is installed or launched by this protocol probe.
 assert.equal(hub.mutateProjectState('probe',()=>hub.getBoard('probe').transition(taskId,'dispatched',{assignedAgent:'worker',assignedRuntimeInstance:'isolated-worker',leaseTimeoutMs:15_000})).ok,true);
 return {get hub(){return hub;},taskId,task(){return hub.getBoard('probe').getTask(taskId);},reopen(){hub.closePersistence();hub=createHub(options);},close(){hub.closePersistence();rmSync(root,{recursive:true,force:true});}};
 }catch(error){hub.closePersistence();rmSync(root,{recursive:true,force:true});throw error;}
}

test('KSwarm 真实隔离持久服务：runLease、旧运行拒绝及重开',async()=>{
 const f=await hubFixture();try{
  const task=f.task();assert.equal(task.status,'dispatched');assert.ok(task.activeRunId);assert.equal(task.runLease.runId,task.activeRunId);assert.equal(task.runLease.assignedAgent,'worker');assert.ok(task.runLease.leaseExpiresAt>task.runLease.createdAt);
  assert.equal(f.hub.handleAcceptTask('probe',f.taskId,'isolated-worker','stale-run').ok,false);
  assert.equal(f.hub.handleAcceptTask('probe',f.taskId,'other',task.activeRunId).ok,false);
  assert.equal(f.hub.handleAcceptTask('probe',f.taskId,'isolated-worker',task.activeRunId).ok,true);
  assert.equal(f.hub.handleProgress('probe',f.taskId,'started','isolated-worker',task.activeRunId).ok,true);
  const runId=task.activeRunId;f.reopen();assert.equal(f.task().activeRunId,runId);assert.equal(f.task().status,'in_progress');
 }finally{f.close();}
});

test('KSwarm 门槛：同版本 claim 与 withdraw 必须仅有一个成功',async()=>{
 const f=await hubFixture();try{
  const board=f.hub.getBoard('probe'),version=f.task().revision??0;
  const results=await Promise.all([
   Promise.resolve().then(()=>f.hub.mutateProjectState('probe',()=>board.transition(f.taskId,'accepted',{expectedTaskVersion:version}))),
   Promise.resolve().then(()=>f.hub.mutateProjectState('probe',()=>board.transition(f.taskId,'pending',{expectedTaskVersion:version}))),
  ]);
  assert.equal(results.filter((r:any)=>r.ok).length,1,'同一版本不能既认领又撤回；expectedTaskVersion 不能被忽略');
 }finally{f.close();}
});

test('KSwarm 门槛：runLease 必须绑定跨设备授权与一次性兑换',async()=>{
 const f=await hubFixture();try{
  const lease=f.task().runLease;
  const required=['workspaceId','sourceDeviceId','targetDeviceId','sourceDeviceGeneration','targetDeviceGeneration','coordinatorGeneration','permitId','redeemedAt'];
  assert.deepEqual(required.filter(k=>!Object.hasOwn(lease,k)),[],'租约不等同于跨设备启动许可');
 }finally{f.close();}
});

test('KSwarm 门槛：运行中或结果未知不能直接退回可重派 pending',async()=>{
 const f=await hubFixture();try{
  const runId=f.task().activeRunId;assert.equal(f.hub.handleAcceptTask('probe',f.taskId,'isolated-worker',runId).ok,true);assert.equal(f.hub.handleProgress('probe',f.taskId,'started','isolated-worker',runId).ok,true);
  const result=f.hub.mutateProjectState('probe',()=>f.hub.getBoard('probe').transition(f.taskId,'pending',{reason:'connection_lost'}));
  f.reopen();assert.equal(result.ok,false,'没有原运行停止或未启动证据，不得恢复派工资格');assert.equal(f.task().activeRunId,runId);
 }finally{f.close();}
});

test('KSwarm 门槛：取消意图不能充当物理停止证据',async()=>{
 const f=await hubFixture();try{
  const runId=f.task().activeRunId;f.hub.handleAcceptTask('probe',f.taskId,'isolated-worker',runId);f.hub.handleProgress('probe',f.taskId,'started','isolated-worker',runId);
  assert.equal(f.hub.mutateProjectState('probe',()=>f.hub.getBoard('probe').transition(f.taskId,'cancelled')).ok,true);
  f.reopen();assert.equal(f.task().recoveryStatus,'verification_required','未收到执行进程退出证据时，必须保留待核实与运行占用');
 }finally{f.close();}
});

test('KSwarm 门槛：派工四元组唯一，触发来源仅为属性，重启后不新增任务',async()=>{
 const f=await hubFixture();try{
  const dispatch={workspaceId:'workspace',roomId:'room',dispatchIntentId:'intent',targetBotId:'worker'};
  const submit=(id:string,triggerSource:string)=>f.hub.handleHumanAddTasks('probe',[{id,title:'同一派工',assignedAgent:'worker',dependencies:[],...dispatch,triggerSource}],{requestSource:'user'});
  const a=submit('entry-one','mention');assert.equal(a.ok,true);f.reopen();const b=submit('entry-two','handoff');assert.equal(b.ok,true);
  assert.deepEqual(b.taskIds,a.taskIds,'同一四元组跨入口必须返回同一权威任务，不得按触发类型再建任务');
  assert.equal(f.hub.getBoard('probe').getAllTasks().filter((t:any)=>t.dispatchIntentId==='intent').length,1);
 }finally{f.close();}
});

test('KSwarm 真实 HTTP 门槛：认证、claim/redeem/withdraw CAS 与精确许可回执', {timeout:30_000},async t=>{
 const f=await realUpstreams();try{
  await t.test('真实服务拒绝自报 user 的匿名任务写入',async()=>{
   const response=await f.kswarmRequest('/projects/missing/tasks/human','POST',{requestSource:'user',tasks:[]},false);assert.equal(response.status,401);
  });
  await t.test('已认证健康握手必须声明跨设备许可协议，才能发起竞争和回执查询',async()=>{
   const health=await f.kswarmRequest('/health');assert.equal(health.status,200);
   // No invented POST endpoints: the pinned service must first advertise its authoritative contract.
   assert.ok(health.body.capabilities?.includes('cross-device-run-permit-v1'),'缺少可协商的 claim/redeem/withdraw 与精确消费回执协议；禁止启动远端工作');
  });
 }finally{await f.close();}
});
