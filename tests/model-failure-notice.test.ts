import {test} from 'node:test';
import assert from 'node:assert/strict';
import {currentModelFailure,modelFailureMessage} from '../src/protocol/model-failure-notice.js';
const failed={id:'routing',roomId:'group',originId:'message',trigger:'group-discussion',state:'blocked',failure:{code:'model_authentication_failed',phase:'routing',httpStatus:401,botId:'cto',model:'model'}};
test('group routing authentication failures remain visible without a recoverable work projection',()=>{
 const notice=currentModelFailure('group',[failed,{id:'source',roomId:'group',originId:'message',state:'queued'}]);
 assert.equal(notice?.job.id,'routing');assert.equal(notice?.failure.httpStatus,401);
 assert.match(modelFailureMessage(notice!.failure.code,notice!.failure.phase).guidance,/后续成员尚未开始/);
});
test('new requests, successful retries and conversation changes suppress historical model failures',()=>{
 for(const state of ['queued','routing','running','delivered'])assert.equal(currentModelFailure('group',[{...failed,id:'new',state},failed]),undefined);
 assert.equal(currentModelFailure('group',[{...failed,id:'new',state:'delivered',originId:'new-message'},failed]),undefined);
 assert.equal(currentModelFailure('other',[failed]),undefined);assert.equal(currentModelFailure(undefined,[failed]),undefined);
 assert.equal(currentModelFailure('group',[{...failed,state:'delivered'}]),undefined);
});
test('background replies do not hide the current request failure and unrelated errors keep their own recovery',()=>{
 assert.equal(currentModelFailure('group',[{...failed,id:'peer',trigger:'peer',state:'delivered'},failed])?.job.id,failed.id);
 assert.equal(currentModelFailure('group',[{...failed,failure:{code:'native_result_unknown'}}]),undefined);
});
test('credential and quota explanations describe actionable causes without raw provider exceptions',()=>{
 assert.match(modelFailureMessage('model_authentication_failed','routing').reason,/凭据无效/);
 assert.match(modelFailureMessage('model_quota_exhausted','model').reason,/额度|限流/);
 assert.match(modelFailureMessage('model_service_unavailable','model').guidance,/工作记录已保留/);
});
test('real failure component exposes the member, model, cause and settings action without a technical-details detour',async()=>{
 const {build}=await import('esbuild'),{renderToStaticMarkup}=await import('react-dom/server'),{createElement}=await import('react'),{mkdtempSync,writeFileSync,rmSync}=await import('node:fs'),{join}=await import('node:path'),{pathToFileURL}=await import('node:url');
 const output=await build({stdin:{contents:"export {ModelFailureNotice} from './desktop/renderer/src/execution-failure';",resolveDir:process.cwd(),loader:'tsx'},bundle:true,platform:'node',format:'esm',write:false,packages:'external'});
 const directory=mkdtempSync(join(process.cwd(),'node_modules/.kteam-failure-notice-')),file=join(directory,'render.mjs'),previous=(globalThis as any).window;(globalThis as any).window={kteam:{}};
 try{writeFileSync(file,output.outputFiles[0]!.text);const {ModelFailureNotice}=await import(pathToFileURL(file).href);let opened=false;
 const element=ModelFailureNotice({notice:currentModelFailure('group',[failed]),bots:[{id:'cto',name:'CTO'}],onSettings(){opened=true;},onDetails(){}}),html=renderToStaticMarkup(createElement(()=>element));
 for(const content of ['role="alert"','CTO','model','HTTP 401','凭据无效','打开模型设置','查看失败详情'])assert(html.includes(content),content);
 const settings=element.props.children.find((child:any)=>child?.props?.children==='打开模型设置');settings.props.onClick();assert(opened);
 }finally{rmSync(directory,{recursive:true,force:true});if(previous===undefined)delete (globalThis as any).window;else (globalThis as any).window=previous;}
});
test('one group member failure stays visible beside another member reply and clears after its own successful retry',()=>{
 const member={...failed,id:'member',trigger:'group-response',failure:{...failed.failure,phase:'model'},activeBotId:'cto'},reply={...failed,id:'reply',trigger:'group-response',state:'delivered',failure:undefined,activeBotId:'qa'};
 assert.equal(currentModelFailure('group',[reply,member])?.job.id,'member');
 assert.equal(currentModelFailure('group',[{...reply,id:'retry',activeBotId:'cto'},reply,member]),undefined);
 assert.equal(currentModelFailure('group',[{...reply,originId:'new-message'},member]),undefined);
});

test('invalid planning has a visible plain-language routing explanation',()=>{const notice=currentModelFailure('group',[{...failed,failure:{...failed.failure,code:'group_plan_invalid'}}]);assert.equal(notice?.failure.code,'group_plan_invalid');assert.match(modelFailureMessage('group_plan_invalid','routing').reason,/分工方案未通过校验/);});

test('invalid provider control output explains that no new tool ran and preserves completed results',()=>{const notice=modelFailureMessage('model_response_protocol_invalid','model');assert.match(notice.reason,/未执行的工具请求/);assert.match(notice.guidance,/工具结果已保留/);});
