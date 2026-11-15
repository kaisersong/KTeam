import {ConversationService} from '../src/service/conversation.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {join,resolve} from 'node:path';
import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {realUpstreams} from './helpers/real-upstreams.js';
import {sharedRuntime,modelIdentity} from '../src/runtime/native.js';
import {TeamStore} from '../src/service/team-store.js';
import {TeamCoordinator} from '../src/service/coordination.js';
import {ToolApprovals} from '../src/service/tool-approvals.js';
import {TeamAutomation} from '../src/service/automation.js';
import {saveBotProfile} from '../src/service/bot-profile.js';
import {activityRecords,readableActivityEvents} from '../src/protocol/activity-records.js';
import {CollaborationService,LOCAL_HUMAN} from '../src/service/collaboration.js';

test('a recovered product request delegates PM then development then quality before the CTO delivers through the real runtime',async()=>{
 process.env.KTEAM_RUNTIME_ENTRY=resolve('build/shared/kteam-runtime.mjs');const f=await realUpstreams(),configRoot=join(f.root,'config'),hostRoot=join(f.root,'host');mkdirSync(configRoot);mkdirSync(hostRoot);
 const previous={config:process.env.KTEAM_MODEL_CONFIG_DIR,plugins:process.env.KTEAM_DISABLE_GLOBAL_PLUGINS};process.env.KTEAM_MODEL_CONFIG_DIR=configRoot;process.env.KTEAM_DISABLE_GLOBAL_PLUGINS='1';
 let stages:string[]=[],targets:string[]=[],reportPath='',prematurePath='',parentRequests=0,restoredReceipt=false;const errors:string[]=[];
 const server=createServer(async(req,res)=>{try{
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw),content=body.messages?.filter((message:any)=>message.role==='user').at(-1)?.content;let prompt:any;
  try{prompt=JSON.parse(typeof content==='string'?content:'');}catch{}
  const parent=prompt?.currentMessage&&!prompt?.sourceConversation;
  const stage=parent?(prompt.handoff?targets.indexOf(prompt.handoff.results?.[0]?.botId)+1:0):-1;
  const delegate=parent&&stage<3&&body.tools?.some((tool:any)=>tool.function?.name==='delegate_work');
  if(parent){assert(body.tools.some((tool:any)=>tool.function?.name==='update_shared_context'),'recovery must retain shared context');assert(body.tools.some((tool:any)=>tool.function?.name==='contact_bot'),'recovery must retain member contact');assert(body.tools.some((tool:any)=>tool.function?.name==='ask_user'),'recovery must retain durable questions');if(delegate)stages.push(['PM','开发','质量'][stage]!);}
  const writeReport=parent&&stage===3&&prompt.handoff&&!body.messages.some((message:any)=>message.role==='tool'&&String(message.content).includes('已写入:'));
  if(parent){if(stage>0)assert.equal(prompt.memberWorkReceipts.length,stage,'all earlier member stages must survive approval and recovery boundaries');parentRequests++;if(prompt.handoff)restoredReceipt=body.messages.some((message:any)=>message.role==='tool'&&String(message.content).includes('waiting'))&&body.messages.some((message:any)=>message.role==='assistant'&&message.tool_calls?.some((call:any)=>call.function.name==='delegate_work'));}
  res.writeHead(200,{'content-type':'text/event-stream'});
  const delta=delegate?{role:'assistant',tool_calls:[{index:0,id:'handoff-native-call-'+stage,type:'function',function:{name:'delegate_work',arguments:JSON.stringify({requests:[{botId:targets[stage],message:['梳理需求与验收标准。','按 PM 分解实现并返回验证。','独立核对开发产物并返回验收证据。'][stage]}],doneWhen:['PM 分解返回。','开发产物返回。','质量验收返回。'][stage]})}},{index:1,id:'premature-write-'+stage,type:'function',function:{name:'write',arguments:JSON.stringify({file_path:prematurePath,content:'must not execute before member results'})}}]}:writeReport?{role:'assistant',tool_calls:[{index:0,id:'handoff-native-write',type:'function',function:{name:'write',arguments:JSON.stringify({file_path:reportPath,content:'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>合成交接报告</title><h1>合成交接报告</h1><p>三位成员已独立核对合成资料，结果交回原工作。</p></html>'})}}]}:{role:'assistant',content:prompt?.handoff?'已依据三位成员的实际结果完成汇总，待你核对。':prompt?.sourceConversation?'已独立核对合成资料，未发现额外缺口。':'已记录合成任务事实。'};
  res.write('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',model:'fixture-model',choices:[{index:0,delta,finish_reason:null}]})+'\n\n');
  res.write('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',model:'fixture-model',choices:[{index:0,delta:{},finish_reason:delegate||writeReport?'tool_calls':'stop'}],usage:{prompt_tokens:10,completion_tokens:5}})+'\n\n');res.end('data: [DONE]\n\n');
 }catch(error){errors.push(String(error));res.writeHead(200,{'content-type':'text/event-stream'});res.end('data: '+JSON.stringify({id:'fixture-error',choices:[{index:0,delta:{role:'assistant',content:'Fixture failed.'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');}});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const store=new TeamStore(hostRoot),approvals=new ToolApprovals(store);let automation:TeamAutomation|undefined;
 try{
  const core=await sharedRuntime(),config=await core.loadConfig();config.providers.openai={...(config.providers.openai??{}),protocol:'openai_legacy',apiKey:'fixture-key',baseUrl:'http://127.0.0.1:'+(server.address() as any).port+'/v1'};config.models['handoff-test']={provider:'openai',model:'fixture-model'};config.defaultModelId='handoff-test';writeFileSync(join(configRoot,'config.json'),JSON.stringify(config));
  const coordinator=new TeamCoordinator(f.upstream,store,1,{catalog:async()=>({defaultModelId:'handoff-test'}),identity:modelIdentity}),bots=[];
  for(const name of ['CTO','PM','开发','质量']){const bot=(await coordinator.createMember({name,modelId:'handoff-test',requestId:'native-'+name},{requestSource:'user'})).bot,workspace=join(f.root,'workspace-'+bot.id);mkdirSync(workspace);await saveBotProfile(f.upstream,store,{botId:bot.id,expectedRevision:0,description:name+'的合成范围',instructions:'只处理合成验收材料。',participation:'auto',workspace,followup:false});bots.push(bot);}
  targets=bots.slice(1).map(bot=>bot.id);reportPath=join(f.root,'workspace-'+bots[0]!.id,'handoff-report.html');prematurePath=join(f.root,'workspace-'+bots[0]!.id,'premature.txt');const roomId=(await coordinator.createGroup({title:'原运行器交接验收',memberAgentIds:bots.map(bot=>bot.id),requestId:'native-handoff-team'},{requestSource:'user'})).room.roomId;
  const origin=await new CollaborationService(f.upstream).send({aimp:'1.0',id:'msg_dddddddddddddddddddddddddddddddd',room_id:roomId,thread_id:'native-source',from:LOCAL_HUMAN,to:[],mentions:[],ts:new Date().toISOString(),act:'chat',source_level:'principal',body:'@CTO 请先 PM 分解，再开发实现、质量验收，最后核对并汇总。'});store.enqueue('native-handoff-root',roomId,String(origin.messageId));const recovery=store.job('native-handoff-root');Object.assign(recovery,{trigger:'recovery',recoveryBotIds:[bots[0]!.id],recoveryBindings:{[bots[0]!.id]:store.binding(bots[0]!.id)},recoveryContext:{originalJobId:'prior-work',reason:'host_restarted'}});store.save(recovery);
  automation=new TeamAutomation(f.upstream,store,1,undefined,coordinator,undefined,new ConversationService(hostRoot,f.upstream,store),approvals);
  await automation.tick();assert.equal(store.job('native-handoff-root').state,'waiting',JSON.stringify(store.job('native-handoff-root')));assert.equal(parentRequests,1,'yield must precede another parent HTTP request');const waitingRecord=activityRecords([store.job('native-handoff-root')],roomId)[0]!,steps=readableActivityEvents(waitingRecord);assert.equal(steps.filter(step=>step.name==='delegate_work').length,1);assert.ok(steps.some(step=>step.type==='run_aborted'&&step.state==='waiting'&&step.observedState==='failed'));assert.ok(waitingRecord.events.some(event=>event.type==='usage_updated'),'technical facts must stay available in Events/Raw');
  assert.equal(existsSync(prematurePath),false,'later tools in the same model response must not run while waiting');assert.equal(approvals.list().length,0);for(let step=0;step<3;step++){
   const until=Date.now()+20000;while(store.jobs().some(job=>job.trigger==='peer'&&!['delivered','blocked','unknown','stopped'].includes(job.state))&&Date.now()<until)await new Promise(resolve=>setTimeout(resolve,20));
   assert.equal(store.jobs().filter(job=>job.trigger==='peer'&&job.state==='delivered').length,step+1,JSON.stringify(store.jobs()));
   const continuation=automation.tick();if(step===2){const deadline=Date.now()+10000;while(!approvals.list().length&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));const pending=approvals.list()[0];assert(pending,JSON.stringify(store.job('native-handoff-root')));assert.equal(pending.toolName,'write');assert(!existsSync(reportPath));await approvals.decide({id:pending.id,expectedHash:pending.hash,decision:'allow_once'});}
   await continuation;
  }
  await automation.tick();const root=store.job('native-handoff-root');assert.equal(root.state,'delivered',JSON.stringify(root));assert.equal(root.handoffResume.readonly,false);assert.deepEqual(stages,['PM','开发','质量']);assert.equal(parentRequests,5);assert.match(readFileSync(reportPath,'utf8'),/合成交接报告/);assert(restoredReceipt);assert.equal(root.results.length,1);assert(!existsSync(prematurePath));assert.deepEqual(errors,[]);
 }finally{approvals.close();await automation?.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));store.close();for(const[key,value]of Object.entries({KTEAM_MODEL_CONFIG_DIR:previous.config,KTEAM_DISABLE_GLOBAL_PLUGINS:previous.plugins}))if(value===undefined)delete process.env[key];else process.env[key]=value;await f.close();}
});
