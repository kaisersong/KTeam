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
 const originalConfigDirectory=process.env.KTEAM_MODEL_CONFIG_DIR;process.env.KTEAM_MODEL_CONFIG_DIR=root;
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
 }finally{globalThis.fetch=originalFetch;if(originalConfigDirectory===undefined)delete process.env.KTEAM_MODEL_CONFIG_DIR;else process.env.KTEAM_MODEL_CONFIG_DIR=originalConfigDirectory;registry.dispose();rmSync(root,{recursive:true,force:true});}
});

test('production KTeam factory keeps K3 through an actual write approval and reopens its original private session',async()=>{
 const {createHarness}=await import('../src/runtime/harness.js'),{mkdirSync,writeFileSync,readFileSync,existsSync}=await import('node:fs');
 const root=realpathSync(privateTempDir(join(tmpdir(),'kteam-k3-factory-'))),config=join(root,'config'),workspace=join(root,'workspace');mkdirSync(config);mkdirSync(workspace);
 const prior={config:process.env.KTEAM_MODEL_CONFIG_DIR,plugins:process.env.KTEAM_DISABLE_GLOBAL_PLUGINS},fetchBefore=globalThis.fetch;process.env.KTEAM_MODEL_CONFIG_DIR=config;process.env.KTEAM_DISABLE_GLOBAL_PLUGINS='1';
 const core=await sharedRuntime(),configuration=await core.loadConfig();configuration.providers.kimi={type:'first_party',protocol:'openai_legacy',apiKey:'SYNTHETIC_TEST_KEY',baseUrl:'https://api.kimi.com/coding/v1'};configuration.models['k3-test']={provider:'kimi',model:'k3-256k'};configuration.defaultModelId='k3-test';configuration.defaultProvider='kimi';writeFileSync(join(config,'config.json'),JSON.stringify(configuration));
 const adapter=core.createAdapter(configuration),target=join(workspace,'receipt.txt');let requests=0,approved=false,owner:any;
 globalThis.fetch=async(input,init)=>{const request=input instanceof Request?input:new Request(input,init),body=JSON.parse(await request.text());assert.equal(new URL(request.url).hostname,'api.kimi.com');assert.equal(body.model,'k3-256k');requests++;const delta=requests===1?{role:'assistant',reasoning_content:'PRIVATE_FACTORY_REASONING',tool_calls:[{index:0,id:'write-receipt',type:'function',function:{name:'write',arguments:JSON.stringify({file_path:target,content:'ACTUAL_K3_FACTORY_RECEIPT'})}}]}:{role:'assistant',reasoning_content:'PRIVATE_FACTORY_FINAL',content:'K3_FACTORY_DONE'};return new Response([{choices:[{index:0,delta,finish_reason:null}]},{choices:[{index:0,delta:{},finish_reason:requests===1?'tool_calls':'stop'}],usage:{prompt_tokens:100,completion_tokens:20}}].map(chunk=>'data: '+JSON.stringify({id:'factory',object:'chat.completion.chunk',model:'k3-256k',...chunk})+'\n\n').join('')+'data: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});};
 const scope={root:join(root,'host'),botId:'k3-member',roomId:'k3-private-room',bindingRevision:1,fingerprint:'original-k3-fingerprint',profileRevision:1},port={ownerId:'original-k3-factory-job',async prepare(value:any){assert.equal(value.input.file_path,target);assert.equal(value.cwd,workspace);if(!approved)throw core.toolApprovalPause('tool-approval:k3-factory');return true;}};
 const open=async()=>{const harness=await createHarness({scope,workspace,signal:AbortSignal.timeout(30000),assertCurrent:async()=>{},toolApprovalPort:port});return harness.prepare!(adapter,'k3-256k','Synthetic fixture only.',[]);};
 const run=()=>owner.runOwned(()=>new core.AgentRuntime({adapter,registry:owner.registry,session:owner.session,toolApprovalPort:owner.toolApprovalPort,controller:new core.AgentRunController(),systemPrompt:owner.system,promptSnapshot:owner.promptSnapshot,checkpoint:owner.persist,maxIterations:3}).run('Synthetic fixture.',()=>{}));
 try{owner=await open();await run();assert.equal(existsSync(target),false);assert.equal(requests,1);assert.equal(owner.session.getToolBatch().state,'waiting_approval');const id=owner.session.exportSnapshot().sessionId;await owner.close();owner=undefined;approved=true;owner=await open();assert.equal(owner.session.exportSnapshot().sessionId,id);assert.doesNotMatch(JSON.stringify(owner.session.getMessages()),/PRIVATE_FACTORY_REASONING/);await run();assert.equal(requests,2);assert.equal(readFileSync(target,'utf8'),'ACTUAL_K3_FACTORY_RECEIPT');assert.equal(owner.session.getToolBatch(),undefined);}
 finally{await owner?.close();globalThis.fetch=fetchBefore;if(prior.config===undefined)delete process.env.KTEAM_MODEL_CONFIG_DIR;else process.env.KTEAM_MODEL_CONFIG_DIR=prior.config;if(prior.plugins===undefined)delete process.env.KTEAM_DISABLE_GLOBAL_PLUGINS;else process.env.KTEAM_DISABLE_GLOBAL_PLUGINS=prior.plugins;rmSync(root,{recursive:true,force:true});}
});
