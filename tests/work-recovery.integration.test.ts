import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {TeamStore} from '../src/service/team-store.js';
import {TeamCoordinator} from '../src/service/coordination.js';
import {CollaborationService,LOCAL_HUMAN} from '../src/service/collaboration.js';
import {WorkRecovery} from '../src/service/work-recovery.js';
import {realUpstreams} from './helpers/real-upstreams.js';
import {mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createServer} from 'node:http';
import {startHost} from '../src/service/server.js';
import {initConfig} from '../src/service/config.js';
import {hostRequest} from '../src/service/client.js';
import {createDesktopAPI} from '../desktop/semantic-api.js';
import {sharedRuntime} from '../src/runtime/native.js';

const models={catalog:async()=>({defaultModelId:'fixture'}),identity:async(modelId:string)=>({modelId,model:'fixture-model',fingerprint:'frozen'})};
const user={requestSource:'user' as const};
test('real host shutdown and restart expose recovery and complete one linked run through the original streaming model adapter',{timeout:process.platform==='win32'?120000:30000},async()=>{
 const f=await realUpstreams(),root=join(f.root,'host'),config=join(f.root,'model-config'),previous=process.env.KTEAM_MODEL_CONFIG_DIR;
 mkdirSync(config);process.env.KTEAM_MODEL_CONFIG_DIR=config;process.env.KTEAM_RUNTIME_ENTRY=resolve('build/shared/kteam-runtime.mjs');
 let first=true,requested!:()=>void;const waiting=new Promise<void>(done=>{requested=done;});
 const model=createServer((req,res)=>{req.resume();req.on('end',()=>{
  if(first){first=false;requested();return;}
  res.writeHead(200,{'content-type':'text/event-stream'});
  res.write('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',model:'fixture-model',choices:[{index:0,delta:{role:'assistant',content:'已核对测试记录，保留已有结果，完成未交付答复。'},finish_reason:null}]})+'\n\n');
  res.write('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',model:'fixture-model',choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:3,completion_tokens:5}})+'\n\n');res.end('data: [DONE]\n\n');
 });});
 await new Promise<void>(done=>model.listen(0,'127.0.0.1',done));let host:Awaited<ReturnType<typeof startHost>>|undefined;
 try {
  const core=await sharedRuntime(),settings=await core.loadConfig();settings.providers={fixture:{protocol:'openai_legacy',baseUrl:'http://127.0.0.1:'+(model.address() as any).port+'/v1',apiKey:'FICTIONAL_RECOVERY_FIXTURE'}};settings.models={fixture:{provider:'fixture',model:'fixture-model'}};settings.defaultModelId='fixture';settings.defaultProvider='fixture';await core.saveConfig(settings);
  initConfig(root,{version:1,brokerUrl:f.upstream.options.brokerUrl,kswarmUrl:f.upstream.options.kswarmUrl});host=await startHost({root,upstream:f.upstream.options});const api=createDesktopAPI((route,value)=>hostRequest(root,'kteam-main',route,value));
  const bot=await api.createBot({name:'真实恢复验证员',modelId:'fixture',requestId:'real-recovery'});await api.send({roomId:bot.roomId,text:'完成测试答复'});await waiting;await host.close();host=undefined;
  host=await startHost({root,upstream:f.upstream.options});await api.reconcile(bot.roomId);const before=await api.work(bot.roomId),source=before.jobs[0];assert.equal(source.state,'stopped');assert.equal(source.failure.message,'host_shutdown');assert.equal(before.recovery.canContinue,true);assert.equal(before.recovery.hostInterrupted,true);assert.equal(source.interruption.reason,'host_shutdown');
  const visibleBefore=(await api.messages({roomId:bot.roomId})).messages;assert.deepEqual(visibleBefore.map((m:any)=>m.text),['完成测试答复']);
  assert.equal((await api.teams()).rooms.find((room:any)=>room.roomId===bot.roomId).lastMessage.text,'完成测试答复');
  const raw=await f.upstream.request('broker','/rooms/'+bot.roomId+'/messages?afterSequence=0&limit=100');const stop=raw.messages.find((m:any)=>m.sourceRef?.kind==='aimp_event');assert.ok(stop);
  const internalPage=await f.upstream.messages(bot.roomId,stop.roomSequence-1,1);assert.equal(internalPage.messages.length,1);assert.equal(internalPage.messages[0].sourceRef.kind,'aimp_event');const visibleInternal=await api.messages({roomId:bot.roomId,after:stop.roomSequence-1,limit:1});assert.equal(visibleInternal.messages.length,0);assert.equal(visibleInternal.nextSequence,stop.roomSequence);assert.equal(visibleInternal.previousSequence,stop.roomSequence);
  assert.equal((await f.upstream.getTeam(bot.roomId)).messages.some((m:any)=>m.sourceRef?.kind==='aimp_event'),true);
  const continued=await api.recoverWork({roomId:bot.roomId,jobId:source.id,requestId:'resume-click'});assert.equal((await api.recoverWork({roomId:bot.roomId,jobId:source.id,requestId:'double-click'})).jobId,continued.jobId);
  let work:any;for(let n=0;n<300;n++){work=await api.work(bot.roomId);if(work.jobs[0]?.state==='delivered')break;await new Promise(done=>setTimeout(done,20));}
  assert.equal(work.jobs[0].state,'delivered',JSON.stringify(work.jobs[0]));assert.equal(work.jobs[0].recoveryOf,source.id);assert.equal(work.jobs[1].state,'stopped');
  const messages=(await api.messages({roomId:bot.roomId})).messages;assert.equal(messages.filter((m:any)=>m.sender.kind==='agent').length,1);
  await assert.rejects(hostRequest(root,'kteam-companion','/v1/teams/'+bot.roomId+'/recover',{jobId:source.id,requestId:'forbidden-client'}),/recovery_forbidden/);
 } finally {await host?.close();model.closeAllConnections();await new Promise<void>(done=>model.close(()=>done()));if(previous===undefined)delete process.env.KTEAM_MODEL_CONFIG_DIR;else process.env.KTEAM_MODEL_CONFIG_DIR=previous;await f.close();}
});
test('real team reconnect preserves a stopped write; explicit continuation is linked, idempotent, scoped and survives restart',async()=>{
 const f=await realUpstreams();let store=new TeamStore(f.root);
 let coordinator=new TeamCoordinator(f.upstream,store,1,models),recovery=new WorkRecovery(f.upstream,store,coordinator);
 try {
  const bot=await coordinator.createMember({name:'恢复验证员',modelId:'fixture',requestId:'recovery-member'},user),roomId=bot.roomId;
  const sent=await new CollaborationService(f.upstream).send({aimp:'1.0',id:'msg_'+randomBytes(16).toString('hex'),room_id:roomId,thread_id:'thread-'+roomId,from:LOCAL_HUMAN,to:[],mentions:[],ts:new Date().toISOString(),act:'chat',source_level:'principal',body:'核对测试目录并完成文档'});
  store.enqueue('interrupted',roomId,String(sent.messageId));const old=store.job('interrupted');
  Object.assign(old,{state:'stopped',reason:'team_stopped',activeBotId:bot.bot.id,members:[bot.bot.id],partialText:'已完成部分测试草稿',failure:{code:'team_stopped',phase:'tool',message:'host_shutdown',evidence:'captured',at:new Date().toISOString()},toolTrace:[{type:'tool_started',name:'write',input:'fixture.txt'}]});store.save(old);
  const original=JSON.stringify(store.job(old.id));
  for(let n=0;n<3;n++){assert.equal(recovery.view(roomId,[])?.canContinue,true);assert.equal(store.jobs(roomId).length,1);}
  await assert.rejects(recovery.continue('wrong-room',{jobId:old.id,requestId:'wrong'}));
  store.pause(roomId);assert.equal(recovery.view(roomId,[])?.reason,'team_paused');await assert.rejects(recovery.continue(roomId,{jobId:old.id,requestId:'paused'}),/team_paused/);store.resume(roomId);
  const results=await Promise.all(Array.from({length:8},(_,n)=>recovery.continue(roomId,{jobId:old.id,requestId:'click-'+n})));
  assert.equal(new Set(results.map(r=>r.jobId)).size,1);assert.equal(store.jobs(roomId).length,2);
  assert.equal(JSON.stringify(store.job(old.id)),original);
  const next=store.job(results[0]!.jobId);assert.equal(next.trigger,'recovery');assert.equal(next.recoveryOf,old.id);assert.equal(next.originId,old.originId);assert.equal(next.recoveryContext.draft,old.partialText);assert.equal(next.calls,0);assert.equal(next.toolTrace,undefined);assert.equal(next.task,undefined);assert.deepEqual(next.recoveryBotIds,[bot.bot.id]);
  assert.equal((await f.upstream.messages(roomId,0,100)).messages.length,1);
  store.close();store=new TeamStore(f.root);coordinator=new TeamCoordinator(f.upstream,store,2,models);recovery=new WorkRecovery(f.upstream,store,coordinator);
  assert.equal((await recovery.continue(roomId,{jobId:old.id,requestId:'after-restart'})).jobId,next.id);assert.equal(store.jobs(roomId).length,2);
 } finally {store.close();await f.close();}
});

test('recovery does not continue a revoked member, unknown live execution, newer work or unconfirmed process',async()=>{
 const f=await realUpstreams(),store=new TeamStore(f.root),coordinator=new TeamCoordinator(f.upstream,store,1,models),recovery=new WorkRecovery(f.upstream,store,coordinator);
 try {
  const bot=await coordinator.createMember({name:'范围验证员',modelId:'fixture',requestId:'scope-member'},user),roomId=bot.roomId;
  const sent=await new CollaborationService(f.upstream).send({aimp:'1.0',id:'msg_'+randomBytes(16).toString('hex'),room_id:roomId,thread_id:'thread-'+roomId,from:LOCAL_HUMAN,to:[],mentions:[],ts:new Date().toISOString(),act:'chat',source_level:'principal',body:'范围测试'});
  store.enqueue('old',roomId,String(sent.messageId));const job=store.job('old');Object.assign(job,{state:'unknown',reason:'host_restarted_result_unknown',activeBotId:bot.bot.id,members:[bot.bot.id],task:{taskRef:'unknown-live'}});store.save(job);
  assert.equal(recovery.view(roomId,[{taskRef:'unknown-live',state:'working'}])?.canContinue,false);
  store.setState('harness-fence:'+bot.bot.id,{reason:'native_stop_unconfirmed'});await assert.rejects(recovery.continue(roomId,{jobId:'old',requestId:'fenced'}),/native_stop_unconfirmed/);store.setState('harness-fence:'+bot.bot.id,null);
  const binding=store.binding(bot.bot.id)!;store.switchSource(bot.bot.id,null);await assert.rejects(recovery.continue(roomId,{jobId:'old',requestId:'unbound'}),/recovery_member_changed/);store.switchSource(bot.bot.id,binding);
  store.enqueue('newer',roomId,String(sent.messageId));await assert.rejects(recovery.continue(roomId,{jobId:'old',requestId:'superseded'}),/recovery_superseded/);
 } finally {store.close();await f.close();}
});

test('safe automatic recovery checks current profile, storage exclusion and unknown approvals; persists one attempt per stale batch',{timeout:30000},async()=>{
 const f=await realUpstreams(),store=new TeamStore(f.root),coordinator=new TeamCoordinator(f.upstream,store,1,models),recovery=new WorkRecovery(f.upstream,store,coordinator);
 try{
  const {harnessWorkspace}=await import('../src/runtime/harness.js'),{harnessLocation,acquireHarnessStorage,beginMemoryReview}=await import('../src/runtime/harness-storage.js');
  process.env.KTEAM_RUNTIME_ENTRY=resolve('build/shared/kteam-runtime.mjs');const core=await sharedRuntime();
  const member=await coordinator.createMember({name:'自动恢复验证员',modelId:'fixture',requestId:'auto-recovery'},user),roomId=member.roomId,botId=member.bot.id;
  const bot=((await f.upstream.listBots()).agents as any[]).find(bot=>bot.id===botId),revision=bot.kteamProfile?.revision??0,cwd=harnessWorkspace(bot.kteamProfile?.workspace);
  const sent=await new CollaborationService(f.upstream).send({aimp:'1.0',id:'msg_'+randomBytes(16).toString('hex'),room_id:roomId,thread_id:'thread-'+roomId,from:LOCAL_HUMAN,to:[],mentions:[],ts:new Date().toISOString(),act:'chat',source_level:'principal',body:'继续完成虚构测试事项'});
  store.enqueue('original',roomId,String(sent.messageId));const original=store.job('original');Object.assign(original,{state:'blocked',reason:'handoff_wait_expired',activeBotId:botId,members:[botId]});store.save(original);
  store.enqueueFollowup({id:'sixth-recovery',roomId,originId:String(sent.messageId),trigger:'recovery'});const latest=store.job('sixth-recovery');Object.assign(latest,{state:'blocked',reason:'harness_session_busy',activeBotId:botId,members:[botId]});store.save(latest);
  const binding=store.binding(botId)!,scope={root:store.root,roomId,botId,bindingRevision:binding.revision,fingerprint:binding.fingerprint,profileRevision:revision};
  const {identity,directory}=harnessLocation(scope,cwd),session=new core.AgentSessionState(),calls=[{type:'tool_use',id:'pending',name:'write',input:{file_path:join(f.root,'never-written')}}];
  session.restoreSnapshot({...session.exportSnapshot(),sessionId:'kteam_'+identity,cwd,lineage:['kteam_'+identity]});session.appendAssistantBlocks(calls);
  const batch={version:1,id:'batch_'+'b'.repeat(32),ownerId:'original',state:'waiting_approval',approvalId:'tool-approval:auto-fixture',calls,results:[]};session.setToolBatch(batch);
  await new core.FileSessionStore(join(directory,'sessions')).save(session.exportSnapshot());
  const approval={id:batch.approvalId,roomId,botId,jobId:'original',bindingRevision:binding.revision,profileRevision:revision,modelFingerprint:binding.fingerprint,cwd,durable:true,batchId:batch.id,index:0,toolName:'write',input:calls[0]!.input,status:'cancelled'};
  const save=(changes:any)=>{const prior=store.operation(approval.id);store.saveOperation({...approval,...changes},prior?.revision??0);};save({profileRevision:revision+1});await recovery.wakeSafe();assert.equal(store.jobs(roomId).length,2);
  save({status:'executing'});await recovery.wakeSafe();assert.equal(store.jobs(roomId).length,2);
  save({});const release=acquireHarnessStorage(directory);try{await recovery.wakeSafe();assert.equal(store.jobs(roomId).length,2);}finally{release();}
  const endReview=beginMemoryReview(store.root,roomId);try{await recovery.wakeSafe();assert.equal(store.jobs(roomId).length,2);}finally{endReview();}
  store.pause(roomId);await recovery.wakeSafe();assert.equal(store.jobs(roomId).length,2);store.resume(roomId);
  store.enqueueFollowup({id:'legitimate-wait',roomId,originId:'different',trigger:'peer'});const wait=store.job('legitimate-wait');wait.state='waiting';store.save(wait);
  await recovery.wakeSafe();assert.equal(store.jobs(roomId).length,3);wait.state='delivered';store.save(wait);
  await recovery.wakeSafe();const next=store.jobs(roomId)[0];assert.equal(next.recoveryOf,latest.id);assert.equal(next.recoveryAutomatic,true);assert.equal(store.jobs(roomId).length,4);
  Object.assign(next,{state:'blocked',reason:'harness_session_busy',activeBotId:botId});store.save(next);
  await recovery.wakeSafe();await recovery.wakeSafe();assert.equal(store.jobs(roomId).length,4);
  store.close();const reopened=new TeamStore(f.root);try{await new WorkRecovery(f.upstream,reopened,coordinator).wakeSafe();assert.equal(reopened.jobs(roomId).length,4);}finally{reopened.close();}
 }finally{try{store.close();}catch{}await f.close();}
});
