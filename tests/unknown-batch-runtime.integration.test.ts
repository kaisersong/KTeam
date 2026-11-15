import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join,resolve} from 'node:path';
import {mkdirSync,writeFileSync,existsSync,readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {realUpstreams} from './helpers/real-upstreams.js';
import {sharedRuntime,modelIdentity} from '../src/runtime/native.js';
import {TeamStore} from '../src/service/team-store.js';
import {TeamCoordinator} from '../src/service/coordination.js';
import {initConfig} from '../src/service/config.js';
import {startHost} from '../src/service/server.js';
import {hostRequest} from '../src/service/client.js';
import {createDesktopAPI} from '../desktop/semantic-api.js';
async function until<T>(read:()=>Promise<T|false|undefined>){const deadline=Date.now()+20000;while(Date.now()<deadline){const value=await read();if(value)return value;await new Promise(resolve=>setTimeout(resolve,20));}throw Error('work_input_fixture_timeout');}
async function startProofHost(root:string,configRoot:string,upstream:any):Promise<{close:()=>Promise<void>}>{
 const app=process.env.KTEAM_PACKAGED_APP;if(!app)return startHost({root,upstream});
 const build=join(app,'Contents/Resources/app.asar.unpacked/build');let output='';
 const child=spawn(join(app,'Contents/MacOS/KTeam'),[join(build,'host.cjs')],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1',KTEAM_DATA_DIR:root,KTEAM_MODEL_CONFIG_DIR:configRoot,KTEAM_RUNTIME_ENTRY:join(build,'shared/kteam-runtime.mjs'),KTEAM_NATIVE_CHILD:join(build,'native-child.cjs')},stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',chunk=>output=(output+chunk).slice(-8000));child.stderr.on('data',chunk=>output=(output+chunk).slice(-8000));
 const close=async()=>{if(child.exitCode!==null||child.signalCode!==null)return;child.kill('SIGTERM');await new Promise<void>(resolve=>{const timer=setTimeout(()=>child.kill('SIGKILL'),8000);child.once('exit',()=>{clearTimeout(timer);resolve();});});};
 try{await until(async()=>{if(child.exitCode!==null)throw Error('packaged_host_exited:'+output);try{await hostRequest(root,'kteam-main','/v1/handshake');return true;}catch{return false;}});return {close};}catch(error){await close();throw error;}
}

import {harnessLocation} from '../src/runtime/harness-storage.js';
import {saveBotProfile} from '../src/service/bot-profile.js';

test('ended unknown tool batches auto-reconcile in the original runtime, keep known results and never replay calls',async()=>{
 process.env.KTEAM_RUNTIME_ENTRY=resolve('build/shared/kteam-runtime.mjs');const f=await realUpstreams(),root=join(f.root,'host'),configRoot=join(f.root,'config'),workspace=join(f.root,'workspace'),before=process.env.KTEAM_MODEL_CONFIG_DIR;mkdirSync(configRoot);mkdirSync(workspace);process.env.KTEAM_MODEL_CONFIG_DIR=configRoot;
 let host:{close:()=>Promise<void>}|undefined,calls=0,seen!:()=>void;const first=new Promise<void>(r=>seen=r),marker=join(workspace,'must-not-replay'),evidence=join(workspace,'evidence.txt');writeFileSync(evidence,'REAL_EXISTING_RESULT_62');
 const provider=createServer(async(req,res)=>{try{let raw='';for await(const chunk of req)raw+=chunk;calls++;if(calls===1){seen();return;}
  assert.match(raw,/REAL_EXISTING_RESULT_62/);assert.match(raw,/run-interrupted/);res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',model:'fixture-model',choices:[{index:0,delta:{role:'assistant',content:'RESULT_RECONCILED_WITHOUT_REPLAY_75'},finish_reason:null}]})+'\n\n');res.write('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',model:'fixture-model',choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:5}})+'\n\n');res.end('data: [DONE]\n\n');
 }catch(error){res.destroy(error as Error);}});await new Promise<void>(resolve=>provider.listen(0,'127.0.0.1',resolve));
 try{
  const core=await sharedRuntime(),config=await core.loadConfig();config.providers.openai={protocol:'openai_legacy',apiKey:'fixture-key',baseUrl:'http://127.0.0.1:'+(provider.address() as any).port+'/v1'};config.models.fixture={provider:'openai',model:'fixture-model'};config.defaultModelId='fixture';writeFileSync(join(configRoot,'config.json'),JSON.stringify(config));
  initConfig(root,{version:1,brokerUrl:f.upstream.options.brokerUrl,kswarmUrl:f.upstream.options.kswarmUrl,brokerTokenFile:join(root,'broker-token'),kswarmTokenFile:join(root,'kswarm-token')});writeFileSync(join(root,'broker-token'),f.upstream.options.brokerToken,{mode:0o600});writeFileSync(join(root,'kswarm-token'),f.upstream.options.kswarmToken,{mode:0o600});
  let store=new TeamStore(root);const coordinator=new TeamCoordinator(f.upstream,store,1,{catalog:async()=>({defaultModelId:'fixture'}),identity:modelIdentity}),bot=await coordinator.createMember({name:'结果核对员',modelId:'fixture',requestId:'unknown-result'}, {requestSource:'user'});await saveBotProfile(f.upstream,store,{botId:bot.bot.id,expectedRevision:0,description:'合成数据',instructions:'只核对已有结果',participation:'auto',workspace,followup:false});store.setState('assistant-proactivity',{enabled:false});store.close();
  host=await startProofHost(root,configRoot,f.upstream.options);const api=createDesktopAPI((route,value)=>hostRequest(root,'kteam-main',route,value));await api.send({roomId:bot.roomId,text:'核对本地合成资料并交付'});await first;await host.close();host=undefined;
  store=new TeamStore(root);const old=store.jobs(bot.roomId)[0];assert.equal(old.state,'stopped');const binding=store.binding(bot.bot.id)!,scope={root,roomId:bot.roomId,botId:bot.bot.id,bindingRevision:binding.revision,fingerprint:binding.fingerprint},location=harnessLocation(scope,workspace),sessions=new core.FileSessionStore(join(location.directory,'sessions')),snapshot=await sessions.load('kteam_'+location.identity);assert.ok(snapshot);const session=new core.AgentSessionState();session.restoreSnapshot(snapshot);
  const batch={version:1,id:'batch_1234567890abcdef1234567890abcdef',ownerId:old.id,state:'executing',calls:[{type:'tool_use',id:'known-read',name:'read',input:{file_path:evidence}},{type:'tool_use',id:'unknown-write',name:'write',input:{file_path:marker,content:'MUST_NOT_REPLAY'}}],results:[{type:'tool_result',tool_use_id:'known-read',content:readFileSync(evidence,'utf8')}]};session.appendAssistantBlocks(batch.calls);session.setToolBatch(batch);await sessions.save(session.exportSnapshot());store.close();
  host=await startProofHost(root,configRoot,f.upstream.options);const work=await until(async()=>{const view=await api.work(bot.roomId);return view.jobs[0]?.state==='delivered'?view:undefined;});assert.equal(work.jobs[0].recoveryOf,old.id);assert.equal(work.jobs[0].recoveryAutomatic,true);assert.equal(work.recovery,null);assert.equal(existsSync(marker),false);assert.equal((await api.toolApprovals()).approvals.length,0);assert.equal(calls,2);
  store=new TeamStore(root);const record=store.operation('quarantined-tool-batch:'+batch.id);assert.equal(record.status,'unknown');assert.deepEqual(record.batch,batch);store.close();await host.close();host=await startProofHost(root,configRoot,f.upstream.options);assert.equal((await api.work(bot.roomId)).jobs.length,2);assert.equal(calls,2);assert.equal(existsSync(marker),false);
 }finally{await host?.close();provider.closeAllConnections();await new Promise<void>(resolve=>provider.close(()=>resolve()));if(before===undefined)delete process.env.KTEAM_MODEL_CONFIG_DIR;else process.env.KTEAM_MODEL_CONFIG_DIR=before;await f.close();}
});
