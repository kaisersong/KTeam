import{privateTempDir as mkdtempSync}from'./helpers/private-temp.js';
import{tmpdir}from'node:os';
import{test}from'node:test';import assert from'node:assert/strict';import{realpathSync,mkdirSync,rmSync}from'node:fs';import{join}from'node:path';
import{TeamStore}from'../src/service/team-store.js';import{ToolApprovals}from'../src/service/tool-approvals.js';
const pause=()=>new Promise(r=>setTimeout(r,5));
async function fixture(){const root=realpathSync(mkdtempSync(join(tmpdir(),'kteam-approval-vis-'))),config=join(root,'config');mkdirSync(config);const before=process.env.KTEAM_MODEL_CONFIG_DIR;process.env.KTEAM_MODEL_CONFIG_DIR=config;const store=new TeamStore(root);const approvals=new ToolApprovals(store);const controller=new AbortController();
 return{root,store,approvals,controller,async pending(){const until=Date.now()+3000;while(!approvals.list().length){if(Date.now()>until)throw Error('expected approval');await pause();}return approvals.list()[0]!;},close(){controller.abort();approvals.close();store.close();if(before===undefined)delete process.env.KTEAM_MODEL_CONFIG_DIR;else process.env.KTEAM_MODEL_CONFIG_DIR=before;rmSync(root,{recursive:true,force:true});}};}

test('A6: aborted approval leaves a queryable cancelled record with timestamp and room; list stays empty and decide rejects',async()=>{const f=await fixture();try{
 const work=f.approvals.ask({roomId:'room',displayRoomId:'private',botId:'bot',jobId:'job'},'bash',{command:'git status'},f.controller.signal,async()=>{});
 const p=await f.pending();assert.equal(p.status,'pending');assert.equal(f.approvals.recent().length,0);
 f.controller.abort();assert.equal(await work,false);
 assert.equal(f.approvals.list().length,0);
 const recent=f.approvals.recent();assert.equal(recent.length,1);const r=recent[0]!;
 assert.equal(r.id,p.id);assert.equal(r.status,'cancelled');assert.equal(r.reason,'aborted');assert.equal(r.roomId,'private');assert.equal(r.sourceRoomId,'room');assert.equal(r.toolName,'bash');
 assert.ok(typeof r.cancelledAt==='number'&&r.cancelledAt<=Date.now());assert.ok(typeof r.createdAt==='number'&&r.createdAt<=r.cancelledAt);
 await assert.rejects(f.approvals.decide({id:p.id,expectedHash:p.hash,decision:'allow_once'}),/tool_approval_expired/);
 }finally{f.close();}});

test('A6: recent is room-scoped and excludes approvals the user already decided',async()=>{const f=await fixture();try{
 const first=f.approvals.ask({roomId:'room-a',botId:'bot',jobId:'job-1'},'bash',{command:'git status'},f.controller.signal,async()=>{});
 const p1=await f.pending();await f.approvals.decide({id:p1.id,expectedHash:p1.hash,decision:'allow_once'});assert.equal(await first,true);
 const second=f.approvals.ask({roomId:'room-b',displayRoomId:'private-b',botId:'bot',jobId:'job-2'},'bash',{command:'git log -3 --oneline'},f.controller.signal,async()=>{});
 await f.pending();f.controller.abort();assert.equal(await second,false);
 assert.equal(f.approvals.recent().length,1);
 assert.equal(f.approvals.recent('private-b').length,1);assert.equal(f.approvals.recent('room-b').length,0);assert.equal(f.approvals.recent('room-a').length,0);
 }finally{f.close();}});

test('A6: host restart cancels stale pending approvals with a timestamp and keeps them queryable',async()=>{const f=await fixture();try{
 const work=f.approvals.ask({roomId:'room',botId:'bot',jobId:'job'},'bash',{command:'git status'},f.controller.signal,async()=>{});
 const p=await f.pending();
 const revived=new ToolApprovals(f.store);
 assert.equal(revived.list().length,0);
 const recent=revived.recent();assert.equal(recent.length,1);assert.equal(recent[0]!.id,p.id);assert.equal(recent[0]!.reason,'host_restarted');assert.ok(typeof recent[0]!.cancelledAt==='number');
 f.controller.abort();assert.equal(await work,false);
 assert.equal(revived.recent()[0]!.reason,'host_restarted');
 }finally{f.close();}});

test('A6: durable approvals past expiry surface as expired history without becoming pending again',async()=>{const f=await fixture();try{
 const now=Date.now();f.store.saveOperation({id:'tool-approval:durable-expired',roomId:'room',displayRoomId:'private',botId:'bot',jobId:'job',toolName:'bash',display:'{"command":"git status"}',status:'pending',durable:true,createdAt:now-200000,expiresAt:now-1000},0);
 assert.equal(f.approvals.list().length,0);
 const recent=f.approvals.recent();assert.equal(recent.length,1);assert.equal(recent[0]!.status,'expired');assert.equal(recent[0]!.cancelledAt,now-1000);assert.equal(recent[0]!.roomId,'private');assert.equal(recent[0]!.sourceRoomId,'room');
 }finally{f.close();}});
