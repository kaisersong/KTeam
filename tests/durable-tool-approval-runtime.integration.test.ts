import {processGroup} from '../src/runtime/platform-process.js';
import {nodeFixtureCommand} from './helpers/node-command.js';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join,resolve} from 'node:path';
import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {spawn,execFileSync} from 'node:child_process';
import {powershellPath} from '../src/runtime/platform-process.js';
import {createServer} from 'node:http';
import {realUpstreams} from './helpers/real-upstreams.js';
import {sharedRuntime,modelIdentity} from '../src/runtime/native.js';
import {TeamStore} from '../src/service/team-store.js';
import {TeamCoordinator} from '../src/service/coordination.js';
import {saveBotProfile} from '../src/service/bot-profile.js';
import {initConfig} from '../src/service/config.js';
import {hostRequest} from '../src/service/client.js';
import {createDesktopAPI} from '../desktop/semantic-api.js';
async function until<T>(read:()=>Promise<T|false|undefined>){const end=Date.now()+20000;while(Date.now()<end){const value=await read();if(value)return value;await new Promise(resolve=>setTimeout(resolve,20));}throw Error('artifact_fixture_timeout');}
async function proofHost(root:string,configRoot:string,upstream:any){const app=process.env.KTEAM_PACKAGED_APP;const build=app?join(app,'Contents/Resources/app.asar.unpacked/build'):resolve('dist/src');let output='';const child=spawn(app?join(app,'Contents/MacOS/KTeam'):process.execPath,app?[join(build,'host.cjs')]:[resolve('dist/src/cli.js'),'start'],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1',KTEAM_DATA_DIR:root,KTEAM_MODEL_CONFIG_DIR:configRoot,KTEAM_RUNTIME_ENTRY:app?join(build,'shared/kteam-runtime.mjs'):resolve('build/shared/kteam-runtime.mjs'),KTEAM_NATIVE_CHILD:app?join(build,'native-child.cjs'):resolve('dist/src/runtime/native-child.js')},stdio:['ignore','pipe','pipe']});child.stdout.on('data',data=>output=(output+data).slice(-8000));child.stderr.on('data',data=>output=(output+data).slice(-8000));const close=async()=>{if(child.exitCode!==null||child.signalCode!==null)return;child.kill('SIGTERM');await new Promise<void>(resolve=>{const timer=setTimeout(()=>child.kill('SIGKILL'),8000);child.once('exit',()=>{clearTimeout(timer);resolve();});});};try{await until(async()=>{if(child.exitCode!==null)throw Error('artifact_host_exited:'+output);try{await hostRequest(root,'kteam-main','/v1/handshake');return true;}catch{return false;}});return {close,crash:async()=>{if(child.exitCode!==null||child.signalCode!==null)return;child.kill('SIGKILL');await new Promise<void>(resolve=>child.once('exit',()=>resolve()));}};}catch(error){await close();throw error;}}
for(const scenario of ['allow_once','deny','allow_always','new-deny','profile','pause','expiry','model','crash'])test(`independent original host verifies durable ${scenario} after restart without replaying a completed file tool or permission hook`,async()=>{
 const decision=['allow_once','deny','allow_always'].includes(scenario)?scenario:'allow_once';
 process.env.KTEAM_RUNTIME_ENTRY=resolve('build/shared/kteam-runtime.mjs');
 const f=await realUpstreams(),root=join(f.root,'host'),configRoot=join(f.root,'config'),workspace=join(f.root,'workspace');
 for(const path of [root,configRoot,workspace])mkdirSync(path,{mode:0o700});
 const previous=process.env.KTEAM_MODEL_CONFIG_DIR;process.env.KTEAM_MODEL_CONFIG_DIR=configRoot;
 const first=join(workspace,'first.txt'),second=join(workspace,'second.txt'),hooks=join(workspace,'hooks.txt');
 let failure:unknown;let requests=0,history='',host:{close:()=>Promise<void>;crash:()=>Promise<void>}|undefined;
 const provider=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;requests++;history=raw;
  const call=(index:number,id:string,file_path:string,content:string)=>({index,id,type:'function',function:{name:'write',arguments:JSON.stringify({file_path,content})}});
  const delta=requests===1?{role:'assistant',tool_calls:[call(0,'first',first,'ACTUAL_FIRST'),call(1,'second',second,'ACTUAL_SECOND')]}:{role:'assistant',content:'已核对实际工具结果。'};
  res.writeHead(200,{'content-type':'text/event-stream'});
  for(const chunk of [{choices:[{index:0,delta,finish_reason:null}]},{choices:[{index:0,delta:{},finish_reason:requests===1?'tool_calls':'stop'}],usage:{prompt_tokens:10,completion_tokens:5}}])res.write('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',model:'fixture',...chunk})+'\n\n');res.end('data: [DONE]\n\n');
 });await new Promise<void>(resolve=>provider.listen(0,'127.0.0.1',resolve));
 try{
  const core=await sharedRuntime(),config=await core.loadConfig();config.providers.openai={protocol:'openai_legacy',apiKey:'fixture-key',baseUrl:'http://127.0.0.1:'+(provider.address() as any).port+'/v1'};config.models.fixture={provider:'openai',model:'fixture'};config.defaultModelId='fixture';writeFileSync(join(configRoot,'config.json'),JSON.stringify(config));
  writeFileSync(join(configRoot,'settings.json'),JSON.stringify({permissions:{allow:['write:'+first]}}));
  const plugin=join(workspace,'.kteam/plugins/approval-proof');mkdirSync(plugin,{recursive:true});const hookScript=join(plugin,'proof.cjs');writeFileSync(hookScript,"require('node:fs').appendFileSync(process.argv[2],process.argv[3]);if(process.argv[4]==='wait')setTimeout(()=>{},30000);");writeFileSync(join(plugin,'plugin.json'),JSON.stringify({name:'approval-proof',version:'1.0.0',hooks:[{events:['PreToolUse'],matcher:'write',command:nodeFixtureCommand(hookScript,hooks,'P')},{events:['PermissionRequest'],matcher:'write',command:nodeFixtureCommand(hookScript,hooks,'A',scenario==='crash'?'wait':'done')}]}));
  initConfig(root,{version:1,brokerUrl:f.upstream.options.brokerUrl,kswarmUrl:f.upstream.options.kswarmUrl,brokerTokenFile:join(root,'broker-token'),kswarmTokenFile:join(root,'kswarm-token')});writeFileSync(join(root,'broker-token'),f.upstream.options.brokerToken,{mode:0o600});writeFileSync(join(root,'kswarm-token'),f.upstream.options.kswarmToken,{mode:0o600});
  const store=new TeamStore(root),coordinator=new TeamCoordinator(f.upstream,store,1,{catalog:async()=>({defaultModelId:'fixture'}),identity:modelIdentity}),member=await coordinator.createMember({name:'持久批准验收员',modelId:'fixture',requestId:'durable-approval'},{requestSource:'user'});await saveBotProfile(f.upstream,store,{botId:member.bot.id,expectedRevision:0,description:'仅合成资料',instructions:'核对原工具结果',participation:'auto',workspace,followup:false});store.setState('assistant-proactivity',{enabled:false});store.close();
  host=await proofHost(root,configRoot,f.upstream.options);const api=createDesktopAPI((route,value)=>hostRequest(root,'kteam-main',route,value));await api.send({roomId:member.roomId,text:'先写第一个虚构文件，再审核第二个文件。',id:'msg_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'});
  const approval=await until(async()=>{const pending=(await api.toolApprovals()).approvals[0];if(pending)return pending;const job=(await api.work(member.roomId)).jobs[0];if(job&&['blocked','unknown','delivered','stopped'].includes(job.state))throw Error('durable_fixture_ended_before_approval:'+JSON.stringify({state:job.state,reason:job.reason,failure:job.failure,requests,first:existsSync(first),hooks:existsSync(hooks)?readFileSync(hooks,'utf8'):null}));return undefined;});
  await until(async()=>{const job=(await api.work(member.roomId)).jobs.find((j:any)=>j.id===approval.jobId);if(job&&['blocked','unknown'].includes(job.state))throw Error(JSON.stringify(job));return job?.state==='waiting';});
  assert.equal(requests,1);assert.equal(readFileSync(first,'utf8'),'ACTUAL_FIRST');assert.equal(existsSync(second),false);assert.equal(readFileSync(hooks,'utf8'),'P');
  const taskRef=(await f.upstream.aimp(member.roomId,'tasks')).tasks[0].taskRef;
  await host.close();host=await proofHost(root,configRoot,f.upstream.options);
  const restored=await until(async()=>(await api.toolApprovals()).approvals[0]);assert.equal(restored.id,approval.id);assert.equal(restored.hash,approval.hash);assert.equal(requests,1);
  await assert.rejects(hostRequest(root,'kteam-companion','/v1/tool-approvals/decide',{id:approval.id,expectedHash:approval.hash,decision}),/app_settings_forbidden/);
  await assert.rejects(api.decideToolApproval({id:approval.id,expectedHash:'stale',decision}),/tool_approval_changed/);
  if(['new-deny','profile','pause','expiry','model'].includes(scenario)){
   if(scenario==='new-deny')writeFileSync(join(configRoot,'settings.json'),JSON.stringify({permissions:{deny:['write'],allow:['write:'+first]}}));
   if(scenario==='profile')await api.saveBot({botId:member.bot.id,expectedRevision:1,description:'changed',instructions:'new scope',participation:'auto',workspace,followup:false});
   if(scenario==='pause')await api.pause(member.roomId);
   if(scenario==='expiry'){await host.close();const db=new DatabaseSync(join(root,'team-extensions.sqlite'));try{db.exec('PRAGMA busy_timeout=5000');db.prepare("UPDATE product_operations SET revision=revision+1,value_json=json_set(value_json,'$.revision',revision+1,'$.expiresAt',?) WHERE id=?").run(Date.now()-1,approval.id);}finally{db.close();}host=await proofHost(root,configRoot,f.upstream.options);}
   if(scenario==='model'){config.models.fixture.model='changed-model';writeFileSync(join(configRoot,'config.json'),JSON.stringify(config));}
   await assert.rejects(api.decideToolApproval({id:approval.id,expectedHash:approval.hash,decision:'allow_always'}),/tool_approval_changed|tool_approval_expired|handoff_scope_changed|model_binding_changed/);
   await host.close();host=await proofHost(root,configRoot,f.upstream.options);
   assert.equal(requests,1);assert.equal(readFileSync(first,'utf8'),'ACTUAL_FIRST');assert.equal(existsSync(second),false);assert.equal(readFileSync(hooks,'utf8'),'P');assert.equal((await api.toolPermissions()).permissions.length,0);return;
  }
  await api.decideToolApproval({id:approval.id,expectedHash:approval.hash,decision});assert.equal((await api.decideToolApproval({id:approval.id,expectedHash:approval.hash,decision})).reused,true);
  if(scenario==='crash'){
   await until(async()=>existsSync(hooks)&&readFileSync(hooks,'utf8')==='PA');
   const before=new DatabaseSync(join(root,'team-extensions.sqlite'),{readOnly:true});try{assert.equal(before.prepare("SELECT json_extract(value_json,'$.status') AS status FROM product_operations WHERE id=?").get(approval.id)?.status,'executing');}finally{before.close();}
   const processes=new DatabaseSync(join(root,'team-extensions.sqlite'),{readOnly:true});let ownedPids:number[]=[];try{const rows=processes.prepare("SELECT value_json FROM product_operations WHERE id LIKE 'harness-process:%'").all();const running=rows.map((row:any)=>JSON.parse(row.value_json)).filter((item:any)=>item.state==='running');assert.ok(running.length,'executing permission hook must have a recorded original process owner');ownedPids=[...new Set<number>(running.flatMap((item:any)=>processGroup(item.pid).map(member=>member.pid)))];assert.ok(ownedPids.length);}finally{processes.close();}
   await host.crash();
   const drained=Date.now()+10000;let remaining:number[]=[];do{remaining=ownedPids.filter(pid=>{try{process.kill(pid,0);return true;}catch(error){if((error as NodeJS.ErrnoException).code!=='ESRCH')throw error;return false;}});if(!remaining.length)break;await new Promise(resolve=>setTimeout(resolve,50));}while(Date.now()<drained);if(remaining.length&&process.platform==='win32'){const facts=execFileSync(powershellPath(),['-NoProfile','-NonInteractive','-Command',`Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -in @(${remaining.join(',')}) } | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress`],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:15000});assert.fail('host crash must physically reap the recorded hook tree: '+facts);}assert.deepEqual(remaining,[],'host crash must physically reap the recorded hook tree');
   host=await proofHost(root,configRoot,f.upstream.options);
   const job=await until(async()=>{const value=(await api.work(member.roomId)).jobs.find((j:any)=>j.id===approval.jobId);return value?.state==='unknown'?value:undefined;});
   assert.equal(job.reason,'host_restarted_result_unknown');assert.equal(requests,1);assert.equal(existsSync(second),false);assert.equal(readFileSync(hooks,'utf8'),'PA');assert.equal((await api.toolApprovals()).approvals.length,0);return;
  }
  await until(async()=>{const job=(await api.work(member.roomId)).jobs.find((j:any)=>j.id===approval.jobId);if(job&&['blocked','unknown','stopped'].includes(job.state))throw Error(JSON.stringify(job));return job?.state==='delivered';});
  assert.equal(requests,2);assert.equal(readFileSync(first,'utf8'),'ACTUAL_FIRST');assert.equal(existsSync(second),decision!=='deny');if(decision!=='deny')assert.equal(readFileSync(second,'utf8'),'ACTUAL_SECOND');assert.equal(readFileSync(hooks,'utf8'),decision==='deny'?'P':decision==='allow_always'?'PP':'PAP');
  const tasks=(await f.upstream.aimp(member.roomId,'tasks')).tasks;assert.equal(tasks.length,1);assert.equal(tasks[0].taskRef,taskRef);assert.match(history,/ACTUAL_FIRST|写入|wrote|成功/i);assert.equal((await api.toolApprovals()).approvals.length,0);
  await host.close();host=await proofHost(root,configRoot,f.upstream.options);assert.equal(requests,2);assert.equal(readFileSync(hooks,'utf8'),decision==='deny'?'P':decision==='allow_always'?'PP':'PAP');
 }catch(error){failure=error;throw error;}finally{try{await host?.close();provider.closeAllConnections();await new Promise<void>(resolve=>provider.close(()=>resolve()));if(previous===undefined)delete process.env.KTEAM_MODEL_CONFIG_DIR;else process.env.KTEAM_MODEL_CONFIG_DIR=previous;await f.close();}catch(cleanup){if(failure)throw new AggregateError([failure,cleanup],'artifact_test_and_cleanup_failed');throw cleanup;}}
});
