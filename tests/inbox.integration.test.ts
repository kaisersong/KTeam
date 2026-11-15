import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {rmSync,mkdirSync} from 'node:fs';
import {privateTempDir} from './helpers/private-temp.js';
import {TeamStore} from '../src/service/team-store.js';
import {InboxState,projectInbox} from '../src/service/inbox.js';
import {realUpstreams} from './helpers/real-upstreams.js';
import {TeamCoordinator} from '../src/service/coordination.js';
import {startHost} from '../src/service/server.js';
import {initConfig} from '../src/service/config.js';
import {hostRequest} from '../src/service/client.js';

test('inbox presentation receipts are persistent, versioned, atomic and cannot replay deleted notices',()=>{
 const root=privateTempDir(join(tmpdir(),'kteam-inbox-'));let store=new TeamStore(root);
 try{
  store.saveOperation({id:'tool-approval:proof',status:'pending',hash:'approval-hash'},0);let state=new InboxState(store);const source={jobs:[{id:'job',roomId:'room',state:'blocked',reason:'needs_input'}],approvals:[{id:'tool-approval:proof',hash:'approval-hash'}]};
  const view=()=>projectInbox(state,source);assert.equal(view().unreadCount,2);const original=view().jobs[0].inbox;
  assert.equal(state.change({action:'read',items:[original]},view().jobs).changed,1);assert.equal(view().unreadCount,1);
  assert.equal(state.change({action:'read',items:[original]},view().jobs).changed,0);
  assert.throws(()=>state.change({action:'unread',items:[original]},view().jobs),/inbox_changed/);
  const latest=view().jobs[0].inbox;state.change({action:'unread',items:[latest]},view().jobs);assert.equal(view().unreadCount,2);
  assert.throws(()=>state.change({action:'read',items:[view().jobs[0].inbox,{...view().approvals[0].inbox,version:'a'.repeat(64)}]},[...view().jobs,...view().approvals]),/inbox_changed/);assert.equal(view().unreadCount,2);
  assert.throws(()=>state.change({action:'read',items:[original,original]},view().jobs),/inbox_invalid/);
  assert.throws(()=>state.change({action:'approve',items:[original]},view().jobs),/inbox_invalid/);
  const deleting=view().jobs[0].inbox;state.change({action:'delete',items:[deleting]},view().jobs);assert.equal(view().jobs.length,0);assert.equal(source.jobs.length,1);
  const deleted=state.project('job',source.jobs[0]);assert.equal(state.change({action:'read',items:[deleting]},[deleted]).changed,0);assert.equal(state.change({action:'delete',items:[deleting]},[deleted]).changed,0);
  const approval=view().approvals[0].inbox;state.change({action:'read',items:[approval]},view().approvals);store.close();store=new TeamStore(root);state=new InboxState(store);assert.equal(view().jobs.length,0);assert.equal(view().unreadCount,0);
  state.change({action:'delete',items:[view().approvals[0].inbox]},view().approvals);assert.equal(store.operation('tool-approval:proof').status,'pending');
  source.jobs[0]!.reason='new_problem';assert.equal(view().jobs.length,1);assert.equal(view().unreadCount,1);assert.throws(()=>state.change({action:'delete',items:[deleting]},view().jobs),/inbox_changed/);
 }finally{store.close();rmSync(root,{recursive:true,force:true});}
});

test('real host reads and deletes inbox notices without modifying the canonical work, and preserves receipts after restart',async()=>{
 const f=await realUpstreams(),root=join(f.root,'host');let host:any;mkdirSync(root,{mode:0o700});const store=new TeamStore(root);
 try{
  const coordinator=new TeamCoordinator(f.upstream,store,1,{catalog:async()=>({defaultModelId:'fixture'}),identity:async()=>({model:'fixture',fingerprint:'fixture'})});const room=await coordinator.bootstrap({requestSource:'user'});
  store.enqueue('inbox-job',room.roomId,'fictional-origin');const job=store.jobs(room.roomId)[0];job.state='blocked';job.reason='needs_input';store.save(job);store.close();initConfig(root,{version:1,brokerUrl:f.upstream.options.brokerUrl,kswarmUrl:f.upstream.options.kswarmUrl});
  host=await startHost({root,upstream:f.upstream.options});const read=()=>hostRequest(root,'kteam-main','/v1/inbox');const first=await read();assert.equal(first.unreadCount,1);const token=(first.jobs as any[])[0].inbox;
  await assert.rejects(hostRequest(root,'kteam-companion','/v1/inbox/change',{action:'delete',items:[token]}),/inbox_client_forbidden/);
  await hostRequest(root,'kteam-main','/v1/inbox/change',{action:'read',items:[token]});assert.equal((await read()).unreadCount,0);
  const current=await read();await hostRequest(root,'kteam-main','/v1/inbox/change',{action:'delete',items:[(current.jobs as any[])[0].inbox]});assert.equal((await read()).jobs instanceof Array,true);assert.equal(((await read()).jobs as any[]).length,0);
  await host.close();host=await startHost({root,upstream:f.upstream.options});assert.equal(((await read()).jobs as any[]).length,0);
  const inspect=new TeamStore(root);try{assert.equal(inspect.jobs(room.roomId)[0].state,'blocked');assert.equal(inspect.jobs(room.roomId)[0].reason,'needs_input');}finally{inspect.close();}
 }finally{await host?.close();try{store.close();}catch{}await f.close();}
});
