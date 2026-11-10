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

test('the original HTTP runtime checkpoints a file condition and resumes actual approved report writing',async()=>{
 process.env.KTEAM_RUNTIME_ENTRY=resolve('build/shared/xiaok-runtime.mjs');const f=await realUpstreams(),configRoot=join(f.root,'config'),hostRoot=join(f.root,'host');mkdirSync(configRoot);mkdirSync(hostRoot);
 const previous={config:process.env.KTEAM_MODEL_CONFIG_DIR,plugins:process.env.XIAOK_DISABLE_GLOBAL_PLUGINS};process.env.KTEAM_MODEL_CONFIG_DIR=configRoot;process.env.XIAOK_DISABLE_GLOBAL_PLUGINS='1';
 let reportPath='',prematurePath='',parentRequests=0,restoredReceipt=false;const errors:string[]=[];
 const server=createServer(async(req,res)=>{try{
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw),content=body.messages?.filter((message:any)=>message.role==='user').at(-1)?.content;let prompt:any;
  try{prompt=JSON.parse(typeof content==='string'?content:'');}catch{}
  const parent=prompt?.currentMessage&&!prompt?.sourceConversation;
  const delegate=parent&&!prompt.handoff&&body.tools?.some((tool:any)=>tool.function?.name==='wait_for_condition');
  const writeReport=parent&&prompt.handoff&&!body.messages.some((message:any)=>message.role==='tool'&&String(message.content).includes('已写入:'));
  if(parent){parentRequests++;if(prompt.handoff)restoredReceipt=body.messages.some((message:any)=>message.role==='tool'&&String(message.content).includes('waiting'))&&body.messages.some((message:any)=>message.role==='assistant'&&message.tool_calls?.some((call:any)=>call.function.name==='wait_for_condition'));}
  res.writeHead(200,{'content-type':'text/event-stream'});
  const delta=delegate?{role:'assistant',tool_calls:[{index:0,id:'handoff-native-call',type:'function',function:{name:'wait_for_condition',arguments:JSON.stringify({condition:{kind:'file_exists',path:'input.txt'},reason:'合成输入文件到位后生成报告',timeoutMinutes:2})}},{index:1,id:'premature-write',type:'function',function:{name:'write',arguments:JSON.stringify({file_path:prematurePath,content:'must not execute before condition'})}}]}:writeReport?{role:'assistant',tool_calls:[{index:0,id:'handoff-native-write',type:'function',function:{name:'write',arguments:JSON.stringify({file_path:reportPath,content:'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>合成交接报告</title><h1>合成交接报告</h1><p>合成输入文件已到位，原工作已接续。</p></html>'})}}]}:{role:'assistant',content:prompt?.handoff?'已依据实际文件回执完成合成报告，待你核对。':prompt?.sourceConversation?'已独立核对合成资料，未发现额外缺口。':'已记录合成任务事实。'};
  res.write('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',model:'fixture-model',choices:[{index:0,delta,finish_reason:null}]})+'\n\n');
  res.write('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',model:'fixture-model',choices:[{index:0,delta:{},finish_reason:delegate||writeReport?'tool_calls':'stop'}],usage:{prompt_tokens:10,completion_tokens:5}})+'\n\n');res.end('data: [DONE]\n\n');
 }catch(error){errors.push(String(error));res.writeHead(500);res.end('fixture failure');}});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const store=new TeamStore(hostRoot),approvals=new ToolApprovals(store);let automation:TeamAutomation|undefined;
 try{
  const core=await sharedRuntime(),config=await core.loadConfig();config.providers.openai={...(config.providers.openai??{}),protocol:'openai_legacy',apiKey:'fixture-key',baseUrl:'http://127.0.0.1:'+(server.address() as any).port+'/v1'};config.models['handoff-test']={provider:'openai',model:'fixture-model'};config.defaultModelId='handoff-test';writeFileSync(join(configRoot,'config.json'),JSON.stringify(config));
  const coordinator=new TeamCoordinator(f.upstream,store,1,{catalog:async()=>({defaultModelId:'handoff-test'}),identity:modelIdentity}),bots=[];
  for(const name of ['负责人','资料员','审阅员']){const bot=(await coordinator.createMember({name,modelId:'handoff-test',requestId:'native-'+name},{requestSource:'user'})).bot,workspace=join(f.root,'workspace-'+bot.id);mkdirSync(workspace);await saveBotProfile(f.upstream,store,{botId:bot.id,expectedRevision:0,description:name+'的合成范围',instructions:'只处理合成验收材料。',participation:'auto',workspace,followup:false});bots.push(bot);}
  reportPath=join(f.root,'workspace-'+bots[0]!.id,'handoff-report.html');prematurePath=join(f.root,'workspace-'+bots[0]!.id,'premature.txt');const roomId=(await coordinator.createGroup({title:'原运行器交接验收',memberAgentIds:bots.map(bot=>bot.id),requestId:'native-handoff-team'},{requestSource:'user'})).room.roomId;
  const origin=await new CollaborationService(f.upstream).send({aimp:'1.0',id:'msg_dddddddddddddddddddddddddddddddd',room_id:roomId,thread_id:'native-source',from:LOCAL_HUMAN,to:[],mentions:[],ts:new Date().toISOString(),act:'chat',source_level:'principal',body:'@负责人 请等待合成输入文件到位，再生成合成报告并汇总。'});store.enqueue('native-handoff-root',roomId,String(origin.messageId));
  automation=new TeamAutomation(f.upstream,store,1,undefined,coordinator,undefined,undefined,approvals);
  await automation.tick();assert.equal(store.job('native-handoff-root').state,'waiting',JSON.stringify(store.job('native-handoff-root')));assert.equal(parentRequests,1,'yield must precede another parent HTTP request');const waitingRecord=activityRecords([store.job('native-handoff-root')],roomId)[0]!,steps=readableActivityEvents(waitingRecord);assert.equal(steps.filter(step=>step.name==='wait_for_condition').length,1);assert.ok(steps.some(step=>step.type==='run_aborted'&&step.state==='waiting'&&step.observedState==='failed'));assert.ok(waitingRecord.events.some(event=>event.type==='usage_updated'),'technical facts must stay available in Events/Raw');
  assert.equal(existsSync(prematurePath),false,'later tools in the same model response must not run while waiting');assert.equal(approvals.list().length,0);writeFileSync(join(f.root,'workspace-'+bots[0]!.id,'input.txt'),'合成输入文件');
  const continuation=automation.tick();const approvalDeadline=Date.now()+10000;while(!approvals.list().length&&Date.now()<approvalDeadline)await new Promise(resolve=>setTimeout(resolve,20));const pending=approvals.list()[0];assert.ok(pending,JSON.stringify(store.job('native-handoff-root')));assert.equal(pending.toolName,'write');assert.equal(existsSync(reportPath),false);await approvals.decide({id:pending.id,expectedHash:pending.hash,decision:'allow_once'});await continuation;const root=store.job('native-handoff-root');assert.equal(root.state,'delivered',JSON.stringify(root));assert.equal(root.handoffResume.readonly,false,JSON.stringify(store.jobs()));assert.equal(parentRequests,3);assert.match(readFileSync(reportPath,'utf8'),/合成交接报告/);assert.equal(restoredReceipt,true,'the original session lost its tool result across the waiting boundary');assert.equal(root.results.length,1);assert.equal(existsSync(prematurePath),false);assert.deepEqual(errors,[]);
 }finally{approvals.close();await automation?.close();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));store.close();for(const[key,value]of Object.entries({KTEAM_MODEL_CONFIG_DIR:previous.config,XIAOK_DISABLE_GLOBAL_PLUGINS:previous.plugins}))if(value===undefined)delete process.env[key];else process.env[key]=value;await f.close();}
});
