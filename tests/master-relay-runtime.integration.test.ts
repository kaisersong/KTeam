import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join,resolve} from 'node:path';
import {mkdirSync,writeFileSync} from 'node:fs';
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

test('original runtime and both clients observe one Master relay, separately executed target and verified final reply',async()=>{
 process.env.KTEAM_RUNTIME_ENTRY=resolve('build/shared/kteam-runtime.mjs');const f=await realUpstreams(),root=join(f.root,'host'),configRoot=join(f.root,'config'),before=process.env.KTEAM_MODEL_CONFIG_DIR;mkdirSync(configRoot);process.env.KTEAM_MODEL_CONFIG_DIR=configRoot;
 let host:{close:()=>Promise<void>}|undefined,targetId='',rootCalls=0,targetCalls=0;const user={requestSource:'user'};
 const provider=createServer(async(req,res)=>{try{let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw),isRoot=raw.includes('MASTER_ORIGIN_71');res.writeHead(200,{'content-type':'text/event-stream'});let delta:any,finish='stop';
  if(isRoot){rootCalls++;if(rootCalls===1){assert.ok(body.tools.some((t:any)=>t.function.name==='send_group_message'));assert.ok(body.tools.some((t:any)=>t.function.name==='contact_bot'));delta={role:'assistant',tool_calls:[{index:0,id:'master-contact-once',type:'function',function:{name:'contact_bot',arguments:JSON.stringify({botId:targetId,message:'RELAY_REQUEST_92',wait:true})}}]};finish='tool_calls';}else{assert.match(raw,/TARGET_REPLY_63/);delta={role:'assistant',content:'MASTER_FINAL_84'};}}
  else{targetCalls++;assert.match(raw,/RELAY_REQUEST_92/);assert.doesNotMatch(raw,/MASTER_PRIVATE_SECRET_35/);delta={role:'assistant',content:'TARGET_REPLY_63'};}
  res.write('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',model:'fixture-model',choices:[{index:0,delta,finish_reason:null}]})+'\n\n');res.write('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',model:'fixture-model',choices:[{index:0,delta:{},finish_reason:finish}],usage:{prompt_tokens:10,completion_tokens:5}})+'\n\n');res.end('data: [DONE]\n\n');
 }catch(error){res.destroy(error as Error);}});await new Promise<void>(resolve=>provider.listen(0,'127.0.0.1',resolve));
 try{
  const core=await sharedRuntime(),config=await core.loadConfig();config.providers.openai={protocol:'openai_legacy',apiKey:'fixture-key',baseUrl:'http://127.0.0.1:'+(provider.address() as any).port+'/v1'};config.models.fixture={provider:'openai',model:'fixture-model'};config.defaultModelId='fixture';writeFileSync(join(configRoot,'config.json'),JSON.stringify(config));
  initConfig(root,{version:1,brokerUrl:f.upstream.options.brokerUrl,kswarmUrl:f.upstream.options.kswarmUrl,brokerTokenFile:join(root,'broker-token'),kswarmTokenFile:join(root,'kswarm-token')});writeFileSync(join(root,'broker-token'),f.upstream.options.brokerToken,{mode:0o600});writeFileSync(join(root,'kswarm-token'),f.upstream.options.kswarmToken,{mode:0o600});
  const store=new TeamStore(root),coordinator=new TeamCoordinator(f.upstream,store,1,{catalog:async()=>({defaultModelId:'fixture'}),identity:modelIdentity}),master=await coordinator.bootstrap(user),target=await coordinator.createMember({name:'核实员',modelId:'fixture',requestId:'master-runtime-target'},user);targetId=target.bot.id;store.setState('assistant-proactivity',{enabled:false});store.close();
  await f.upstream.sendMessage(master.roomId,{text:'MASTER_PRIVATE_SECRET_35',kind:'text',threadId:'private',responsePolicy:'none',contextScope:{kind:'room_only'},idempotencyKey:'fixture-secret'});
  host=await startProofHost(root,configRoot,f.upstream.options);const api=createDesktopAPI((route,value)=>hostRequest(root,'kteam-main',route,value));await api.send({roomId:master.roomId,text:'MASTER_ORIGIN_71 请联系核实员，仅转交指定内容',id:'msg_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'});
  const route='/v1/teams/'+master.roomId+'/work',done=await until(async()=>{const view=await hostRequest(root,'kteam-main',route);const job=(view.jobs as any[])[0];if(['blocked','unknown'].includes(job?.state))throw Error('master_runtime_failed:'+JSON.stringify(job));return job?.state==='delivered'?view:undefined;});
  assert.equal(rootCalls,2);assert.equal(targetCalls,1);const companion=await hostRequest(root,'kteam-companion',route);assert.equal((companion.jobs as any[])[0].id,(done.jobs as any[])[0].id);assert.equal((companion.jobs as any[])[0].state,'delivered');assert.equal((await api.toolApprovals()).approvals.length,0);
  const transcript=(await f.upstream.messages(target.roomId,0,100)).messages;assert.equal(transcript.filter((m:any)=>m.sourceRef?.kind==='assistant_relay').length,1);assert.equal(transcript[0].sender.logicalAgentId,master.botId);assert.equal(transcript[1].sender.logicalAgentId,targetId);assert.equal(transcript[1].text,'TARGET_REPLY_63');assert.match(JSON.stringify((await f.upstream.messages(master.roomId,0,100)).messages),/MASTER_FINAL_84/);assert.equal((await f.upstream.membership(target.roomId)).members.some((m:any)=>m.subject?.logicalAgentId===master.botId),false);
 }finally{await host?.close();provider.closeAllConnections();await new Promise<void>(resolve=>provider.close(()=>resolve()));if(before===undefined)delete process.env.KTEAM_MODEL_CONFIG_DIR;else process.env.KTEAM_MODEL_CONFIG_DIR=before;await f.close();}
});
