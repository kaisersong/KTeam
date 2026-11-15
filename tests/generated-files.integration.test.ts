import {fixtureLink as symlinkSync} from './helpers/fixture-link.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {mkdirSync,writeFileSync,unlinkSync} from 'node:fs';
import {captureGeneratedFile,generatedFilePreview} from '../src/runtime/generated-files.js';
import {realUpstreams} from './helpers/real-upstreams.js';
import {TeamStore} from '../src/service/team-store.js';
import {TeamCoordinator} from '../src/service/coordination.js';
import {startHost} from '../src/service/server.js';
import {initConfig} from '../src/service/config.js';
import {hostRequest} from '../src/service/client.js';

test('real authenticated host opens only unchanged generated HTML receipts in the current Room, including after restart',async()=>{
 const f=await realUpstreams(),root=join(f.root,'host'),path=join(f.root,'fictional-report.html');mkdirSync(root,{mode:0o700});writeFileSync(path,'<!doctype html><title>虚构测试报告</title>');
 const store=new TeamStore(root),coordinator=new TeamCoordinator(f.upstream,store,1,{catalog:async()=>({defaultModelId:'fixture'}),identity:async()=>({model:'fixture',fingerprint:'fixture'})});let host:any;
 try{
  const a=await coordinator.bootstrap({requestSource:'user'}),b=await coordinator.createGroup({title:'隔离测试群',memberAgentIds:[a.botId],requestId:'other-room'},{requestSource:'user'});
  store.enqueue('generated-proof',a.roomId,'fictional-origin');const job=store.jobs(a.roomId)[0];job.state='delivered';job.toolTrace=[{id:'render-proof',name:'mcp__report-renderer__render_report',state:'completed',file:captureGeneratedFile(path,root,a.roomId)}];store.save(job);store.close();
  initConfig(root,{version:1,brokerUrl:f.upstream.options.brokerUrl,kswarmUrl:f.upstream.options.kswarmUrl});host=await startHost({root,upstream:f.upstream.options});
  const route=(room:string,id='render-proof')=>`/v1/teams/${encodeURIComponent(room)}/generated-file-open?toolCallId=${id}`;
  assert.equal((await hostRequest(root,'kteam-main',route(a.roomId))).path,path);
  const previewRoute=route(a.roomId).replace('generated-file-open','generated-file-preview');const preview=await hostRequest(root,'kteam-main',previewRoute);assert.equal(preview.kind,'html');assert.equal(preview.content,'<!doctype html><title>虚构测试报告</title>');assert.equal(preview.name,'fictional-report.html');assert.equal('path' in preview,false);assert.equal('content' in captureGeneratedFile(path,root,a.roomId),false);
  await assert.rejects(hostRequest(root,'kteam-companion',previewRoute),/generated_file_forbidden/);await assert.rejects(hostRequest(root,'kteam-main',route(b.room.roomId).replace('generated-file-open','generated-file-preview')),/generated_file_not_found/);
  await assert.rejects(hostRequest(root,'kteam-companion',route(a.roomId)),/generated_file_forbidden/);
  await assert.rejects(hostRequest(root,'kteam-main',route(b.room.roomId)),/generated_file_not_found/);
  await assert.rejects(hostRequest(root,'kteam-main',route(a.roomId,'forged')),/generated_file_not_found/);
  await host.close();host=await startHost({root,upstream:f.upstream.options});assert.equal((await hostRequest(root,'kteam-main',route(a.roomId))).path,path);
  const again=await hostRequest(root,'kteam-main',previewRoute);assert.equal(again.content,preview.content);
  writeFileSync(path,'changed');await assert.rejects(hostRequest(root,'kteam-main',previewRoute),/generated_file_changed/);await assert.rejects(hostRequest(root,'kteam-main',route(a.roomId)),/generated_file_changed/);
  unlinkSync(path);symlinkSync(join(root,'host.log'),path);await assert.rejects(hostRequest(root,'kteam-main',route(a.roomId)),/generated_file_changed/);
  writeFileSync(join(root,'private.html'),'private');assert.throws(()=>captureGeneratedFile(join(root,'private.html'),root,a.roomId),/generated_file_forbidden/);
 }finally{await host?.close();try{store.close();}catch{}await f.close();}
});


test('verified previews preserve UTF-8 and image bytes while large or unsupported formats retain external opening',async()=>{
 const f=await realUpstreams(),root=join(f.root,'preview-host');mkdirSync(root,{mode:0o700});const store=new TeamStore(root);
 try{
  const samples=[{name:'分析.md',content:Buffer.from('# 中文分析\n已完成'),kind:'markdown'}, {name:'result.json',content:Buffer.from('{"result":"正确"}'),kind:'text'}, {name:'chart.png',content:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB','base64'),kind:'image'}, {name:'large.html',content:Buffer.from('x'.repeat(1600*1024)),kind:'unsupported'}, {name:'report.pdf',content:Buffer.from('%PDF-1.7'),kind:'unsupported'}];
  for(const [index,sample]of samples.entries()){
   const path=join(f.root,sample.name),toolCallId='preview-'+index;writeFileSync(path,sample.content);store.enqueue('job-'+index,'room','origin-'+index);const job=store.job('job-'+index);job.state='delivered';job.toolTrace=[{id:toolCallId,name:'write',state:'completed',file:captureGeneratedFile(path,root,'room')}];store.save(job);
   const preview=generatedFilePreview(store,'room',toolCallId);assert.equal(preview.kind,sample.kind);assert.equal(preview.name,sample.name);assert.equal(preview.bytes,sample.content.length);assert.equal('path'in preview,false);
   if(sample.kind==='image')assert.deepEqual(Buffer.from(preview.content,'base64'),sample.content);else if(sample.kind==='unsupported')assert.equal(preview.content,'');else assert.equal(preview.content,sample.content.toString('utf8'));
   if(sample.name==='large.html')assert.equal('reason'in preview?preview.reason:undefined,'preview_too_large');
  }
 }finally{store.close();await f.close();}
});
