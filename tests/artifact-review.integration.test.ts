import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer} from 'node:http';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {realUpstreams} from './helpers/real-upstreams.js';
import {sharedRuntime,modelIdentity} from '../src/runtime/native.js';
import {TeamStore} from '../src/service/team-store.js';
import {TeamCoordinator} from '../src/service/coordination.js';
import {saveBotProfile} from '../src/service/bot-profile.js';
import {initConfig} from '../src/service/config.js';
import {startHost} from '../src/service/server.js';
import {hostRequest} from '../src/service/client.js';
import {createDesktopAPI} from '../desktop/semantic-api.js';

async function until<T>(read:()=>Promise<T|undefined>, label:string){
 const deadline=Date.now()+30000*(process.platform==='win32'?3:1);
 while(Date.now()<deadline){const value=await read();if(value)return value;await new Promise(done=>setTimeout(done,30));}
 throw Error(label+'_timeout');
}

test('a verified delivery supports versioned notes, a single linked revision, and artifact-only acceptance',async()=>{
 const f=await realUpstreams();
 const root=join(f.root,'host'), configRoot=join(f.root,'config'), workspace=join(f.root,'workspace');
 for(const path of [root,configRoot,workspace])mkdirSync(path,{mode:0o700});
 const path=join(workspace,'delivery.ts');
 const before='export const count = 1;\nexport const unit = "item";\n';
 const after='export const count = 2;\nexport const unit = "item";\n';
 const previous=process.env.KTEAM_MODEL_CONFIG_DIR;
 process.env.KTEAM_MODEL_CONFIG_DIR=configRoot;
 process.env.KTEAM_RUNTIME_ENTRY=resolve('build/shared/kteam-runtime.mjs');
 let requests=0, feedbackSeen=false;
 const provider=createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;
  const n=++requests;
  if(raw.includes('将数量调整为 2'))feedbackSeen=true;
  const tool=n===1||n===3;
  const delta=tool?{role:'assistant',tool_calls:[{index:0,id:'review-write-'+n,type:'function',function:{
   name:'write',arguments:JSON.stringify({file_path:path,content:n===1?before:after}),
  }}]}:{role:'assistant',content:n===2?'第一版已生成。':'按照意见提交第二版。'};
  res.writeHead(200,{'content-type':'text/event-stream'});
  for(const data of [{choices:[{index:0,delta,finish_reason:null}]},{choices:[{index:0,delta:{},finish_reason:tool?'tool_calls':'stop'}],usage:{prompt_tokens:10,completion_tokens:5}}]){
   res.write('data: '+JSON.stringify({id:'review',model:'fixture',...data})+'\n\n');
  }
  res.end('data: [DONE]\n\n');
 });
 await new Promise<void>(done=>provider.listen(0,'127.0.0.1',done));
 let host:Awaited<ReturnType<typeof startHost>>|undefined;
 try{
  const core=await sharedRuntime(),config=await core.loadConfig();
  config.providers.fixture={protocol:'openai_legacy',apiKey:'fixture-key',baseUrl:'http://127.0.0.1:'+(provider.address() as any).port+'/v1'};
  config.models.fixture={provider:'fixture',model:'fixture'};config.defaultModelId='fixture';await core.saveConfig(config);
  initConfig(root,{version:1,brokerUrl:f.upstream.options.brokerUrl,kswarmUrl:f.upstream.options.kswarmUrl});
  const store=new TeamStore(root), coordinator=new TeamCoordinator(f.upstream,store,1,{catalog:async()=>({defaultModelId:'fixture'}),identity:modelIdentity});
  const member=await coordinator.createMember({name:'交付审阅验证员',modelId:'fixture',requestId:'delivery-review-fixture'},{requestSource:'user'});
  await saveBotProfile(f.upstream,store,{botId:member.bot.id,expectedRevision:0,description:'测试交付',instructions:'仅修改合成产物',workspace,participation:'auto',followup:false});
  store.setState('assistant-proactivity',{enabled:false});store.close();
  host=await startHost({root,upstream:f.upstream.options});
  const api=createDesktopAPI((route,value)=>hostRequest(root,'kteam-main',route,value));
  const {roomId}=member;
  const nextApproval=()=>until(async()=>(await api.toolApprovals()).approvals[0],'approval');
  const files=()=>api.generatedFiles({roomId});
  await api.send({roomId,text:'生成代码交付。'});
  const firstApproval=await nextApproval();
  await api.decideToolApproval({id:firstApproval.id,expectedHash:firstApproval.hash,decision:'allow_once'});
  const first=await until(async()=>(await files()).items.find((item:any)=>item.workState==='delivered'),'first_delivery');
  const original={roomId,toolCallId:first.toolCallId};
  const view=await api.artifactReview(original);
  assert.equal(view.sha256,first.sha256);
  assert.equal(view.lines[0].text,'export const count = 1;');
  assert.equal(view.baselineSha256,undefined);
  const returnReview={...original,expectedSha256:view.sha256,action:'request_changes',notes:[{start:1,end:1,text:'将数量调整为 2'}]};
  const route='/v1/teams/'+roomId+'/generated-file-review';
  await assert.rejects(hostRequest(root,'kteam-companion',route+'?toolCallId='+first.toolCallId),/generated_file_forbidden/);
  await assert.rejects(hostRequest(root,'kteam-companion',route,returnReview),/generated_file_forbidden/);
  await assert.rejects(api.submitArtifactReview({...returnReview,notes:[{start:99,end:99,text:'越界意见'}]}),/artifact_review_line_invalid/);
  writeFileSync(path,'externally changed');
  await assert.rejects(api.submitArtifactReview(returnReview),/generated_file_changed/);
  writeFileSync(path,before);
  const revision=await api.submitArtifactReview(returnReview);
  assert.equal(revision.decision.status,'queued');
  assert.equal((await api.submitArtifactReview(returnReview)).decision.messageId,revision.decision.messageId);
  await assert.rejects(api.submitArtifactReview({...returnReview,notes:[{start:1,end:1,text:'不同的提交'}]}),/artifact_review_changed/);
  const secondApproval=await nextApproval();
  assert.notEqual(secondApproval.id,firstApproval.id);
  assert.equal(secondApproval.jobId,revision.decision.followupJobId);
  await api.decideToolApproval({id:secondApproval.id,expectedHash:secondApproval.hash,decision:'allow_once'});
  const second=await until(async()=>(await files()).items.find((item:any)=>item.id!==first.id&&item.workState==='delivered'),'second_delivery');
  assert.equal(readFileSync(path,'utf8'),after);
  assert.equal(feedbackSeen,true);
  const newer={roomId,toolCallId:second.toolCallId};
  const revised=await api.artifactReview(newer);
  assert.equal(revised.baselineSha256,view.sha256);
  assert.deepEqual(revised.lines.filter((line:any)=>line.kind!=='context').map((line:any)=>[line.kind,line.text]),[
   ['removed','export const count = 1;'],['added','export const count = 2;'],
  ]);
  const historic=await api.artifactReview(original);
  assert.equal(historic.historical,true);
  assert.equal(historic.decision.status,'completed');
  const acceptance={...newer,expectedSha256:revised.sha256,action:'accept',notes:[]};
  assert.equal((await api.submitArtifactReview(acceptance)).decision.status,'accepted');
  await host.close();host=await startHost({root,upstream:f.upstream.options});
  assert.equal((await api.artifactReview(newer)).decision.status,'accepted');
  assert.equal((await api.submitArtifactReview(returnReview)).decision.messageId,revision.decision.messageId);
  const history=await api.messages({roomId});
  assert.equal(history.messages.filter((message:any)=>message.text.includes('将数量调整为 2')).length,1);
  assert.equal(requests,4);
 }finally{
  await host?.close();provider.closeAllConnections();await new Promise<void>(done=>provider.close(()=>done()));
  if(previous===undefined)delete process.env.KTEAM_MODEL_CONFIG_DIR;else process.env.KTEAM_MODEL_CONFIG_DIR=previous;
  await f.close();
 }
});
