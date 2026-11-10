import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createServer} from 'node:http';
import {sharedRuntime,nativeTurn} from '../src/runtime/native.js';

test('real original runtime sends a tool-free routing request without phantom tool_search',async()=>{
 process.env.KTEAM_RUNTIME_ENTRY=resolve('build/shared/xiaok-runtime.mjs');
 const root=realpathSync(mkdtempSync('/tmp/kteam-no-tools-')),previous=process.env.KTEAM_MODEL_CONFIG_DIR;process.env.KTEAM_MODEL_CONFIG_DIR=root;
 let calls=0,reservations=0;const server=createServer(async(req,res)=>{
  calls++;let text='';for await(const chunk of req)text+=chunk;const body=JSON.parse(text);
  assert.ok(!body.tools?.length,'A routing request advertised an execution/search tool');
  res.writeHead(200,{'content-type':'text/event-stream'});
  res.write('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',model:'fixture-model',choices:[{index:0,delta:{role:'assistant',content:'{"members":[],"reason":"纯致谢"}'},finish_reason:null}]})+'\n\n');
  res.write('data: '+JSON.stringify({id:'fixture',object:'chat.completion.chunk',model:'fixture-model',choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:3,completion_tokens:2}})+'\n\n');
  res.end('data: [DONE]\n\n');
 });await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 try{
  const core=await sharedRuntime(),config=await core.loadConfig();config.providers.openai={...(config.providers.openai??{}),protocol:'openai_legacy',apiKey:'fixture-key',baseUrl:'http://127.0.0.1:'+(server.address() as any).port+'/v1'};config.models['routing-test']={provider:'openai',model:'fixture-model'};config.defaultModelId='routing-test';writeFileSync(join(root,'config.json'),JSON.stringify(config));
  const reply=await nativeTurn({modelId:'routing-test',system:'只输出路由 JSON，不执行工具。',prompt:'谢谢',tools:[],maxIterations:1,onRequest:()=>{reservations++;},signal:AbortSignal.timeout(8000)});
  assert.deepEqual(JSON.parse(reply.text).members,[]);assert.equal(calls,1);assert.equal(reservations,1);
 }finally{await new Promise<void>(r=>server.close(()=>r()));if(previous===undefined)delete process.env.KTEAM_MODEL_CONFIG_DIR;else process.env.KTEAM_MODEL_CONFIG_DIR=previous;rmSync(root,{recursive:true,force:true});}
});
