import {fixtureLink as symlinkSync} from './helpers/fixture-link.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {mkdirSync,writeFileSync,unlinkSync} from 'node:fs';
import {captureGeneratedFile} from '../src/runtime/generated-files.js';
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
  await assert.rejects(hostRequest(root,'kteam-companion',route(a.roomId)),/generated_file_forbidden/);
  await assert.rejects(hostRequest(root,'kteam-main',route(b.room.roomId)),/generated_file_not_found/);
  await assert.rejects(hostRequest(root,'kteam-main',route(a.roomId,'forged')),/generated_file_not_found/);
  await host.close();host=await startHost({root,upstream:f.upstream.options});assert.equal((await hostRequest(root,'kteam-main',route(a.roomId))).path,path);
  writeFileSync(path,'changed');await assert.rejects(hostRequest(root,'kteam-main',route(a.roomId)),/generated_file_changed/);
  unlinkSync(path);symlinkSync(join(root,'host.log'),path);await assert.rejects(hostRequest(root,'kteam-main',route(a.roomId)),/generated_file_changed/);
  writeFileSync(join(root,'private.html'),'private');assert.throws(()=>captureGeneratedFile(join(root,'private.html'),root,a.roomId),/generated_file_forbidden/);
 }finally{await host?.close();try{store.close();}catch{}await f.close();}
});
