import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {realUpstreams} from './helpers/real-upstreams.js';
import {TeamStore} from '../src/service/team-store.js';
import {TeamCoordinator} from '../src/service/coordination.js';
import {WorkRecovery} from '../src/service/work-recovery.js';
import {CollaborationService,LOCAL_HUMAN} from '../src/service/collaboration.js';
import {createHarness} from '../src/runtime/harness.js';
import {saveBotProfile} from '../src/service/bot-profile.js';

test('legacy checkpoint-only fences reconcile after the real scope is drained; live owners and unknown processes remain blocked',async()=>{
 process.env.KTEAM_RUNTIME_ENTRY=resolve('build/shared/kteam-runtime.mjs');const f=await realUpstreams(),root=join(f.root,'host'),workspace=join(f.root,'workspace');mkdirSync(root);mkdirSync(workspace);const store=new TeamStore(root),models={catalog:async()=>({defaultModelId:'fixture'}),identity:async()=>({model:'fixture',fingerprint:'frozen'})},coordinator=new TeamCoordinator(f.upstream,store,1,models);let owner:any;
 try{
  const member=await coordinator.createMember({name:'保存恢复验证员',modelId:'fixture',requestId:'checkpoint'},{requestSource:'user'}),botId=member.bot.id,roomId=member.roomId;await saveBotProfile(f.upstream,store,{botId,expectedRevision:0,description:'合成资料',instructions:'继续已授权任务',participation:'auto',workspace,followup:false});
  const sent=await new CollaborationService(f.upstream).send({aimp:'1.0',id:'msg_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',room_id:roomId,thread_id:'checkpoint',from:LOCAL_HUMAN,to:[],mentions:[],ts:new Date().toISOString(),act:'chat',source_level:'principal',body:'继续核对原来的合成文件。'});
  const harness=await createHarness({scope:{root,roomId,botId,bindingRevision:1,fingerprint:'frozen',profileRevision:1},workspace,signal:new AbortController().signal,assertCurrent:async()=>{}});
  owner=await harness.prepare!({getModelName:()=> 'fixture',getModelPolicy:()=>({contextLimit:200000,compactThreshold:0.85})},'fixture','合成测试',[]);owner.session.appendUserText('PRESERVED_BEFORE_CHECKPOINT_FAILURE');await owner.persist();
  store.enqueue('legacy-checkpoint',roomId,String(sent.messageId));const job=store.job('legacy-checkpoint');Object.assign(job,{state:'blocked',reason:'harness_runtime_close_failed',activeBotId:botId,recoveryBindings:{[botId]:store.binding(botId)},harness:{cwd:workspace},toolTrace:[{type:'run_failed',code:'session_save_locked'}]});store.save(job);store.setState('harness-fence:'+botId,{reason:'harness_runtime_close_failed',jobId:job.id});const recovery=new WorkRecovery(f.upstream,store,coordinator);
  await recovery.wakeSafe();assert(store.state('harness-fence:'+botId),'live storage owner must not be bypassed');assert.equal(store.operation('work-recovery:'+job.id),null);
  await owner.close();owner=undefined;store.setState('harness-fence:'+botId,{reason:'native_stop_unconfirmed',processId:'unconfirmed'});await recovery.wakeSafe();assert.equal(store.state<any>('harness-fence:'+botId).reason,'native_stop_unconfirmed');
  store.setState('harness-fence:'+botId,{reason:'harness_runtime_close_failed',jobId:job.id});await recovery.wakeSafe();assert.equal(store.state('harness-fence:'+botId),null);assert(store.state('harness-checkpoint-reconciled:'+job.id));const receipt=store.operation('work-recovery:'+job.id);assert(receipt);assert.equal(store.job(receipt.jobId).state,'queued');assert.equal(store.job(receipt.jobId).recoveryOf,job.id);await recovery.wakeSafe();assert.equal(store.operationsWithPrefix('work-recovery:').length,1);
 }finally{await owner?.close();store.close();await f.close();}
});
