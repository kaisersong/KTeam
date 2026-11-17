import {test} from 'node:test';
import assert from 'node:assert/strict';
import {realpathSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {privateTempDir} from './helpers/private-temp.js';
import {sharedRuntime} from '../src/runtime/native.js';

// Real registered K3 adapter and SDK; only the external transport is synthetic.
for(const approved of [true,false])test(`strict K3 durable ${approved?'allow':'deny'} resumes public context without reasoning replay or repeating the completed prefix`,async()=>{
 const core=await sharedRuntime(),root=realpathSync(privateTempDir(join(tmpdir(),'kteam-k3-approval-')));
 const originalFetch=globalThis.fetch,requests:any[]=[];let first=0,second=0,grant:boolean|undefined;
 globalThis.fetch=async(input,init)=>{
  const request=input instanceof Request?input:new Request(input,init);assert.equal(new URL(request.url).hostname,'api.kimi.com');
  const body=JSON.parse(await request.text());requests.push(body);assert.equal(body.model,'k3-256k');
  const delta=requests.length===1?{role:'assistant',reasoning_content:'PRIVATE_K3_REASONING_NEVER_DURABLE',tool_calls:[{index:0,id:'first',type:'function',function:{name:'fixture_first',arguments:'{}'}},{index:1,id:'second',type:'function',function:{name:'fixture_second',arguments:'{}'}}]}:{role:'assistant',reasoning_content:'PRIVATE_K3_FINAL_REASONING',content:'K3_FINAL'};
  const chunks=[{choices:[{index:0,delta,finish_reason:null}]},{choices:[{index:0,delta:{},finish_reason:requests.length===1?'tool_calls':'stop'}],usage:{prompt_tokens:30,completion_tokens:10}}];
  return new Response(chunks.map(chunk=>'data: '+JSON.stringify({id:'k3-fixture',object:'chat.completion.chunk',model:'k3-256k',...chunk})+'\n\n').join('')+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
 };
 const adapter=core.createAdapter({schemaVersion:2,defaultProvider:'kimi',defaultModelId:'k3-256k',providers:{kimi:{type:'first_party',protocol:'openai_legacy',apiKey:'SYNTHETIC_TEST_KEY',baseUrl:'https://api.kimi.com/coding/v1'}},models:{'k3-256k':{provider:'kimi',model:'k3-256k'}}});
 assert.equal(adapter.getOwnedHarnessProfileId(),'kimi-k3-256k-coding-openai');
 const registry=new core.ToolRegistry({},[{permission:'safe',definition:{name:'fixture_first',description:'fixture',inputSchema:{type:'object'}},async execute(_input:any,context:any){assert.equal(context.session.toolBatch,undefined);assert.doesNotMatch(JSON.stringify(context.messages),/PRIVATE_K3/);first++;return 'ACTUAL_FIRST_PUBLIC_RESULT';}},{permission:'confirm',definition:{name:'fixture_second',description:'fixture',inputSchema:{type:'object'}},async execute(_input:any,context:any){assert.equal(context.session.toolBatch,undefined);assert.doesNotMatch(JSON.stringify(context.messages),/PRIVATE_K3/);second++;return 'ACTUAL_SECOND_PUBLIC_RESULT';}}]);
 const store=new core.FileSessionStore(join(root,'sessions'));let session=new core.AgentSessionState();session.restoreSnapshot({...session.exportSnapshot(),sessionId:'k3-durable',cwd:root});
 const port={ownerId:'original-k3-job',resumeProfile:'k3-public-context-v1',async prepare(value:any){if(value.name==='fixture_second'&&value.decision==='prompt'){if(grant===undefined)throw core.toolApprovalPause('tool-approval:k3-fixture');return grant;}return undefined;}};
 const open=(approvalPort:any=port)=>new core.AgentRuntime({adapter,registry,session,toolApprovalPort:approvalPort,controller:new core.AgentRunController(),systemPrompt:'Synthetic verification only.',checkpoint:()=>store.save({...session.exportSnapshot(),model:'k3-256k'}),maxIterations:3});
 try{
  await assert.rejects(open({...port,resumeProfile:undefined}).run('must fail closed',()=>{}),/tool_batch_profile_unavailable/);assert.equal(requests.length,0);
  const events:any[]=[];await open().run('ORIGINAL_K3_TASK',(event:any)=>events.push(event));
  assert.equal(first,1);assert.equal(second,0);assert.equal(requests.length,1);assert(events.some(event=>event.type==='run_suspended'));
  const saved=await store.load('k3-durable');assert.equal(saved.toolBatch.resumeProfile,'k3-public-context-v1');assert.doesNotMatch(JSON.stringify(saved),/PRIVATE_K3|reasoningProvenance/);
  session=new core.AgentSessionState();session.restoreSnapshot(saved);
  await assert.rejects(open({...port,ownerId:'other-job'}).run('wrong owner',()=>{}),/tool_batch_execution_unknown/);assert.equal(second,0);
  const batch=session.getToolBatch();assert.throws(()=>session.setToolBatch({...batch,resumeProfile:'generic-fallback'}),/tool_batch_checkpoint_invalid/);session.setToolBatch({...batch,resumeProfile:undefined});await assert.rejects(open().run('missing profile',()=>{}),/tool_batch_profile_unavailable/);session.setToolBatch(batch);
  grant=approved;await open().run('MUST_NOT_APPEND_DUPLICATE_TASK',()=>{});
  assert.equal(first,1);assert.equal(second,approved?1:0);assert.equal(requests.length,2);assert.equal(session.getToolBatch(),undefined);
  const resumed=JSON.stringify(requests[1]);assert.match(resumed,/synthesized-durable-resume-context/);assert.match(resumed,/ACTUAL_FIRST_PUBLIC_RESULT/);assert.match(resumed,approved?/ACTUAL_SECOND_PUBLIC_RESULT/:/权限不足/);assert.doesNotMatch(resumed,/PRIVATE_K3_REASONING_NEVER_DURABLE|MUST_NOT_APPEND_DUPLICATE_TASK/);assert.equal(requests[1].messages.filter((message:any)=>message.role==='assistant').length,0);
  // A further process/session reload keeps K3 and does not feed stripped raw history back.
  session=new core.AgentSessionState();session.restoreSnapshot(await store.load('k3-durable'));await open().run('FOLLOWUP_SAME_K3',()=>{});assert.equal(requests.length,3);assert.match(JSON.stringify(requests[2]),/K3_FINAL|FOLLOWUP_SAME_K3/);assert.equal(first,1);assert.equal(second,approved?1:0);
 }finally{globalThis.fetch=originalFetch;registry.dispose();rmSync(root,{recursive:true,force:true});}
});
