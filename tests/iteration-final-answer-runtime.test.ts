import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {privateTempDir} from './helpers/private-temp.js';
import {nativeTurn,sharedRuntime} from '../src/runtime/native.js';

const finalAnswer = '已有查证结果，剩余部分待核实。';
const toolCall = {
 index:0,id:'call_fixture',type:'function',
 function:{name:'read_fixture',arguments:'{}'},
};

for(const scenario of ['answer','tool','empty','truncated','denied','early-answer'] as const){
 test('last iteration of a hosted turn: '+scenario,async()=>{
  const root=privateTempDir(join(tmpdir(),'kteam-final-answer-'));
  const previousConfig=process.env.KTEAM_MODEL_CONFIG_DIR;
  process.env.KTEAM_MODEL_CONFIG_DIR=root;
  const requests:any[]=[];
  const onText:string[]=[];
  let executions=0,admissions=0;
  const provider=createServer(async(req,res)=>{
   let raw='';
   for await(const chunk of req)raw+=chunk;
   requests.push(JSON.parse(raw));
   const first=requests.length===1;
   const asksForTool=scenario==='tool'||first&&scenario!=='early-answer';
   const content=first&&asksForTool?'中间进度。':!first&&scenario==='empty'?undefined:finalAnswer;
   const reason=asksForTool?'tool_calls':!first&&scenario==='truncated'?'length':'stop';
   res.writeHead(200,{'content-type':'text/event-stream'});
   const send=(delta:unknown,finish_reason:string|null)=>res.write('data: '+JSON.stringify({
    id:'fixture-'+requests.length,choices:[{index:0,delta,finish_reason}],
   })+'\n\n');
   send({role:'assistant',content,...(asksForTool?{tool_calls:[toolCall]}:{})},null);
   send({},reason);
   res.end('data: [DONE]\n\n');
  });
  await new Promise<void>(ready=>provider.listen(0,'127.0.0.1',ready));
  try{
   const address=provider.address();
   assert(address&&typeof address!=='string');
   const config=await (await sharedRuntime()).loadConfig();
   config.providers.openai={protocol:'openai_legacy',apiKey:'fixture',baseUrl:'http://127.0.0.1:'+address.port+'/v1'};
   config.models.fixture={provider:'openai',model:'fixture'};
   config.defaultModelId='fixture';
   writeFileSync(join(root,'config.json'),JSON.stringify(config));
   const turn=nativeTurn({
    modelId:'fixture',system:'根据工具回执回答。',prompt:'读一次并交付查证结果。',maxIterations:2,finalAnswerOnLimit:true,
    tools:[{
     permission:'safe',
     definition:{name:'read_fixture',description:'Read a fixture',inputSchema:{type:'object',properties:{}}},
     execute:async()=>{executions++;return 'VERIFIED_SOURCE_RECEIPT';},
    }],
    onRequest:()=>{
     admissions++;
     if(scenario==='denied'&&admissions>=2)throw Object.assign(Error('fixture_admission_denied'),{status:403});
    },
    onText:text=>onText.push(text),signal:AbortSignal.timeout(10000),
   });
   if(scenario==='answer'||scenario==='early-answer')assert.equal((await turn).text,finalAnswer);
   else if(scenario==='denied')await assert.rejects(turn,(error:Error)=>/fixture_admission_denied/.test(String(error.cause??error)));
   else if(scenario==='truncated')await assert.rejects(turn,/provider_incomplete|incomplete/i);
   else await assert.rejects(turn,/iteration_budget_exhausted/);

   assert.equal(executions,scenario==='early-answer'?0:1);
   if(scenario==='denied')assert(admissions>=2);
   else assert.equal(admissions,scenario==='early-answer'?1:2);
   assert.equal(requests.length,['early-answer','denied'].includes(scenario)?1:2);
   assert(requests[0].tools.some((entry:any)=>entry.function?.name==='read_fixture'));
   if(requests[1]){
    assert.equal((requests[1].tools??[]).length,0);
    assert.match(JSON.stringify(requests[1].messages),/本轮工具执行已到轮次上限/);
    assert.match(JSON.stringify(requests[1].messages),/VERIFIED_SOURCE_RECEIPT/);
    assert(onText.includes(''));
   }
  }finally{
   provider.closeAllConnections();
   await new Promise<void>(closed=>provider.close(()=>closed()));
   if(previousConfig===undefined)delete process.env.KTEAM_MODEL_CONFIG_DIR;
   else process.env.KTEAM_MODEL_CONFIG_DIR=previousConfig;
   rmSync(root,{recursive:true,force:true});
  }
 });
}
