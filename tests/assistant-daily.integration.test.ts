import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {join,resolve} from 'node:path';
import {test} from 'node:test';
import {createDesktopAPI,dispatchDesktop} from '../desktop/semantic-api.js';
import {sharedRuntime} from '../src/runtime/native.js';
import {hostRequest} from '../src/service/client.js';
import {initConfig} from '../src/service/config.js';
import {startHost} from '../src/service/server.js';
import {realUpstreams} from './helpers/real-upstreams.js';

test('conversation drafts reach the authenticated desktop bridge and persist only after user confirmation',async()=>{
 const upstream=await realUpstreams();
 const root=join(upstream.root,'host');
 const modelRoot=join(upstream.root,'model');
 mkdirSync(root,{mode:0o700});
 mkdirSync(modelRoot,{mode:0o700});
 process.env.KTEAM_RUNTIME_ENTRY=resolve('build/shared/kteam-runtime.mjs');
 process.env.KTEAM_MODEL_CONFIG_DIR=modelRoot;
 let host:Awaited<ReturnType<typeof startHost>>|undefined;
 const calls:{propose:boolean;hasResult:boolean;changingEvening:boolean}[]=[];
 const provider=createServer(async(req,res)=>{
  let raw='';
  for await(const chunk of req)raw+=chunk;
  const request=JSON.parse(raw);
  const propose=request.tools?.some((tool:any)=>tool.function?.name==='propose_daily_work_plan');
  const userIndex=request.messages.findLastIndex((message:any)=>message.role==='user');
  const hasResult=request.messages.slice(userIndex+1).some((message:any)=>message.role==='tool'&&String(message.content).includes('awaitingConfirmation'));
  const call=propose&&!hasResult;
  const changingEvening=String(request.messages[userIndex]?.content).includes('长期把晚报');
  calls.push({propose:Boolean(propose),hasResult,changingEvening});
  const args=changingEvening?{schedule:{evening:'17:30'}}:{schedule:{morning:'09:15'}};
  const delta=call?{role:'assistant',tool_calls:[{index:0,id:changingEvening?'daily-evening':'daily-morning',type:'function',function:{name:'propose_daily_work_plan',arguments:JSON.stringify(args)}}]}:{role:'assistant',content:'请确认每日工作方案。'};
  res.writeHead(200,{'content-type':'text/event-stream'});
  for(const [data,finish] of [[delta,null],[{},call?'tool_calls':'stop']]) {
   res.write('data: '+JSON.stringify({id:'daily-fixture',object:'chat.completion.chunk',model:'daily-fixture',choices:[{index:0,delta:data,finish_reason:finish}]})+'\n\n');
  }
  res.end('data: [DONE]\n\n');
 });
 await new Promise<void>(done=>provider.listen(0,'127.0.0.1',done));
 try{
  const core=await sharedRuntime(),config=await core.loadConfig(),port=(provider.address() as {port:number}).port;
  config.providers.openai={protocol:'openai_legacy',apiKey:'fixture-key',baseUrl:'http://127.0.0.1:'+port+'/v1'};
  config.models.fixture={provider:'openai',model:'daily-fixture'};
  config.defaultModelId='fixture';
  writeFileSync(join(modelRoot,'config.json'),JSON.stringify(config),{mode:0o600});
  const options=upstream.upstream.options;
  initConfig(root,{version:1,brokerUrl:options.brokerUrl,kswarmUrl:options.kswarmUrl,brokerTokenFile:join(root,'broker-token'),kswarmTokenFile:join(root,'kswarm-token')});
  writeFileSync(join(root,'broker-token'),options.brokerToken,{mode:0o600});
  writeFileSync(join(root,'kswarm-token'),options.kswarmToken,{mode:0o600});
  host=await startHost({root,upstream:options});
  const api=createDesktopAPI((route,value)=>hostRequest(root,'kteam-main',route,value));
  const assistant=await api.ensureAssistant();
  assert.ok(assistant.roomId,JSON.stringify(assistant));
  async function draft(text:string,previousRevision:number) {
   await api.send({roomId:assistant.roomId,text,id:'msg_'+String(previousRevision+1).repeat(32)});
   const end=Date.now()+30000;
   while(Date.now()<end){
    const plan:any=await dispatchDesktop(api,'dailyWorkPlan',[]);
    const {messages}=await api.messages({roomId:assistant.roomId});
    if(plan.draft?.previousRevision===previousRevision&&messages.filter((message:any)=>message.sender.kind==='agent').length>previousRevision)return plan;
    await new Promise(done=>setTimeout(done,100));
   }
   assert.fail('No draft received through the actual desktop semantic API: '+JSON.stringify(calls));
  }
  const first=await draft('请帮我将早报改成九点十五。',0);
  assert.equal(first.config,null);
  assert.equal(first.draft.config.schedule.morning,'09:15');
  const approve={id:first.draft.id,expectedRevision:0,sources:[]};
  await assert.rejects(hostRequest(root,'kteam-companion','/v1/assistant/daily/confirm',approve),/assistant_scope_required/);
  assert.equal((await api.confirmDailyWork(approve)).appliedRevision,1);
  assert.equal((await api.confirmDailyWork(approve)).appliedRevision,1);
  const later=await draft('长期把晚报改到十七点半。',1);
  assert.equal(later.config.schedule.evening,'18:00');
  assert.equal(later.draft.config.schedule.evening,'17:30');
  await api.confirmDailyWork({id:later.draft.id,expectedRevision:1,sources:[]});
  await host.close();
  host=await startHost({root,upstream:options});
  const today=await api.dailyWorkToday();
  assert.equal(today.revision,2);
  assert.equal(today.config.schedule.morning,'09:15');
  assert.equal(today.config.schedule.evening,'17:30');
  assert.equal(today.draft,undefined);
 }finally{
  await host?.close();
  provider.closeAllConnections();
  await new Promise<void>(done=>provider.close(()=>done()));
  await upstream.close();
 }
});
