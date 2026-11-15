import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {join,resolve} from 'node:path';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {realUpstreams} from './helpers/real-upstreams.js';
import {sharedRuntime,modelIdentity} from '../src/runtime/native.js';
import {TeamStore} from '../src/service/team-store.js';
import {TeamCoordinator} from '../src/service/coordination.js';
import {ToolApprovals} from '../src/service/tool-approvals.js';
import {TeamAutomation} from '../src/service/automation.js';
import {saveBotProfile} from '../src/service/bot-profile.js';
import {CollaborationService,LOCAL_HUMAN} from '../src/service/collaboration.js';

test('one real task survives twelve separate tool approvals without a lifetime handoff limit or duplicate writes',async()=>{
 process.env.KTEAM_RUNTIME_ENTRY=resolve('build/shared/kteam-runtime.mjs');const f=await realUpstreams(),root=join(f.root,'host'),configRoot=join(f.root,'config'),workspace=join(f.root,'workspace');for(const dir of [root,configRoot,workspace])mkdirSync(dir);
 const previous=process.env.KTEAM_MODEL_CONFIG_DIR;process.env.KTEAM_MODEL_CONFIG_DIR=configRoot;let requests=0,automation:TeamAutomation|undefined;const store=new TeamStore(root),approvals=new ToolApprovals(store);
 const server=createServer(async(req,res)=>{for await(const _ of req){}requests++;const tool=requests<=12;const delta=tool?{role:'assistant',tool_calls:[{index:0,id:'continuous-'+requests,type:'function',function:{name:'write',arguments:JSON.stringify({file_path:join(workspace,'step-'+requests+'.txt'),content:'APPROVED_'+requests})}}]}:{role:'assistant',content:'十二步工作已完成。'};res.writeHead(200,{'content-type':'text/event-stream'});for(const chunk of [{choices:[{index:0,delta,finish_reason:null}]},{choices:[{index:0,delta:{},finish_reason:tool?'tool_calls':'stop'}],usage:{prompt_tokens:10,completion_tokens:5}}])res.write('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',model:'fixture',...chunk})+'\n\n');res.end('data: [DONE]\n\n');});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 try{
  const core=await sharedRuntime(),config=await core.loadConfig();config.providers.openai={protocol:'openai_legacy',apiKey:'FICTIONAL_CONTINUOUS_KEY',baseUrl:'http://127.0.0.1:'+(server.address() as any).port+'/v1'};config.models.fixture={provider:'openai',model:'fixture'};config.defaultModelId='fixture';writeFileSync(join(configRoot,'config.json'),JSON.stringify(config));
  const coordinator=new TeamCoordinator(f.upstream,store,1,{catalog:async()=>({defaultModelId:'fixture'}),identity:modelIdentity}),member=await coordinator.createMember({name:'连续工作验证员',modelId:'fixture',requestId:'continuous'},{requestSource:'user'});
  await saveBotProfile(f.upstream,store,{botId:member.bot.id,expectedRevision:0,description:'合成资料',instructions:'完成所有已授权步骤',participation:'auto',workspace,followup:false});
  const sent=await new CollaborationService(f.upstream).send({aimp:'1.0',id:'msg_abcdefabcdefabcdefabcdefabcdefab',room_id:member.roomId,thread_id:'continuous',from:LOCAL_HUMAN,to:[],mentions:[],ts:new Date().toISOString(),act:'chat',source_level:'principal',body:'按批准逐步完成十二个合成文件。'});store.enqueue('continuous-job',member.roomId,String(sent.messageId));automation=new TeamAutomation(f.upstream,store,1,undefined,coordinator,undefined,undefined,approvals);
  for(let step=1;step<=12;step++){
   await automation.tick();const approval=approvals.list()[0];assert(approval,'approval '+step+': '+JSON.stringify({job:store.job('continuous-job')?.reason,state:store.job('continuous-job')?.state,requests}));assert.equal(store.job('continuous-job').handoffVersion,step);assert.equal(approvals.list().length,1);await approvals.decide({id:approval.id,expectedHash:approval.hash,decision:'allow_once'});
  }
  await automation.tick();assert.equal(store.job('continuous-job').state,'delivered',JSON.stringify({job:store.job('continuous-job')?.reason,requests}));assert.equal(requests,13);for(let step=1;step<=12;step++)assert.equal(readFileSync(join(workspace,'step-'+step+'.txt'),'utf8'),'APPROVED_'+step);assert.equal(store.operationsWithPrefix('tool-approval:').filter(row=>row.status==='completed').length,12);
 }finally{await automation?.close();approvals.close();store.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));if(previous===undefined)delete process.env.KTEAM_MODEL_CONFIG_DIR;else process.env.KTEAM_MODEL_CONFIG_DIR=previous;await f.close();}
});
