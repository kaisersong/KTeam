import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createServer} from 'node:http';
import {sharedRuntime} from '../src/runtime/native.js';
import {systemOneChoice,kimJudgment,decisionModels} from '../src/runtime/decision.js';
async function fixture(){process.env.KTEAM_RUNTIME_ENTRY=resolve('build/shared/xiaok-runtime.mjs');const root=realpathSync(mkdtempSync('/tmp/kteam-decision-')),previous=process.env.XIAOK_CONFIG_DIR;process.env.XIAOK_CONFIG_DIR=root;const core=await sharedRuntime();const config=await core.loadConfig();const write=()=>writeFileSync(join(root,'config.json'),JSON.stringify(config));return {root,config,write,close(){if(previous===undefined)delete process.env.XIAOK_CONFIG_DIR;else process.env.XIAOK_CONFIG_DIR=previous;rmSync(root,{recursive:true,force:true});}};}
test('configured original System One is a decision-only endpoint, validates choices, and checks source before sending',async()=>{
 const f=await fixture();let requests=0,chosen='pick';const bodies:any[]=[];const server=createServer(async(req,res)=>{requests++;let body='';for await(const c of req)body+=c;bodies.push(JSON.parse(body));assert.equal(req.url,'/v1/systemone');res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({model:'fixture-system-one',answers:{next:{type:'choice',choice:chosen}},usage:{input_tokens:3,output_tokens:1}}));});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 try{f.config.systemOne={apiKey:'fixture-key',baseUrl:'http://127.0.0.1:'+(server.address() as any).port,model:'fixture-system-one'};f.write();let current=true,budget=0;const input={state:{message:'选择相关成员'},choices:[{id:'pick',description:'合适成员'},{id:'none',description:'保持安静'}],guard:async()=>{if(!current)throw Error('source_revoked');},signal:AbortSignal.timeout(5000),onRequest:()=>{budget++;}};
  const result=await systemOneChoice(input);assert.equal(result?.chosen,'pick');assert.equal(result?.model,'fixture-system-one');assert.equal(budget,1);assert.equal(bodies[0].questions.next.type,'choice');assert.deepEqual(Object.keys(bodies[0].questions.next.criteria),['pick','none']);assert.equal((await decisionModels()).systemOne.configured,true);
  current=false;await assert.rejects(systemOneChoice(input),/source_revoked/);assert.equal(requests,1);current=true;chosen='unregistered_execution';await assert.rejects(systemOneChoice(input),/decision_response_invalid/);
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));f.close();}
});
test('original K-IM runs only against its configured loopback and reports an unavailable service without remote fallback',async()=>{
 const f=await fixture();let fail=false,requests=0;const ordinal={dist:[0,0,1,0,0],expected:3},score={category:{'求助/提问':1,'任务/待办':0,'决策/结论':0,'信息分享':0,'讨论观点':0,'闲聊寒暄':0,'无关/其他':0},category_top:'求助/提问',sentiment:{'积极':0,'中性':1,'消极':0},sentiment_top:'中性',importance:ordinal,urgency:ordinal,intensity:ordinal,needs_attention:0.9,has_todo:0.8};
 const server=createServer(async(req,res)=>{requests++;let body='';for await(const c of req)body+=c;assert.equal(req.url,'/decide_batch');assert.match(JSON.parse(body).texts[0],/S0001/);res.writeHead(fail?500:200,{'content-type':'application/json'});res.end(JSON.stringify({results:[score]}));});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 try{f.config.kimDecision={enabled:true,baseUrl:'http://127.0.0.1:'+(server.address() as any).port,attentionThreshold:0.65};f.write();const input={window:{group:'fixture',target:{sender:'synthetic-person',text:'请核对交付'}},guard:async()=>{},signal:AbortSignal.timeout(5000)};const result=await kimJudgment(input);assert.equal(result.state,'ready');assert.equal(result.scores.needs_attention,0.9);fail=true;assert.equal((await kimJudgment(input)).state,'unavailable');assert.equal(requests,2);
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));f.close();}
});
