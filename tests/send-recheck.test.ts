import{test}from'node:test';
import assert from'node:assert/strict';
import{readFileSync}from'node:fs';
import{isUnknownSendReceipt,sendRecheckVerdict,createSendRecheck,SEND_RECHECK_DELAY_MS,type SendRecheckContext}from'../desktop/renderer/src/send-recheck.js';

const ctx:SendRecheckContext={roomId:'room_1',id:'msg_abc',text:'hello',replyToMessageId:'msg_parent'};
const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));

test('only an Error whose message is exactly upstream_operation_unknown is an unknown send receipt',()=>{
 assert.equal(isUnknownSendReceipt(new Error('upstream_operation_unknown')),true);
 assert.equal(isUnknownSendReceipt(new Error('upstream_operation_unknown ')),false);
 assert.equal(isUnknownSendReceipt(new Error('broker_unavailable')),false);
 assert.equal(isUnknownSendReceipt(new Error('native_result_unknown')),false);
 assert.equal(isUnknownSendReceipt('upstream_operation_unknown'),false);
 assert.equal(isUnknownSendReceipt({message:'upstream_operation_unknown'}),false);
 assert.equal(isUnknownSendReceipt(undefined),false);
 assert.equal(isUnknownSendReceipt(null),false);
});

test('verdict: id still pending means not delivered; a well-formed list without the id means delivered',()=>{
 assert.equal(sendRecheckVerdict('msg_abc',{pendingSubmissions:[{id:'msg_abc'}]}),'not_delivered');
 assert.equal(sendRecheckVerdict('msg_abc',{pendingSubmissions:[{id:'other'},{id:'msg_abc'}]}),'not_delivered');
 assert.equal(sendRecheckVerdict('msg_abc',{pendingSubmissions:[]}),'delivered');
 assert.equal(sendRecheckVerdict('msg_abc',{pendingSubmissions:[{id:'other'}]}),'delivered');
 assert.equal(sendRecheckVerdict('msg_abc',{pendingSubmissions:[{id:'other',roomId:'room_1',intentHash:'h'}]}),'delivered');
});

test('verdict: a malformed row makes absence untrustworthy, so the result is undetermined (never delivered)',()=>{
 assert.equal(sendRecheckVerdict('msg_abc',{pendingSubmissions:[null]}),'undetermined');
 assert.equal(sendRecheckVerdict('msg_abc',{pendingSubmissions:[{}]}),'undetermined');
 assert.equal(sendRecheckVerdict('msg_abc',{pendingSubmissions:[{envelope:{id:'msg_abc'}}]}),'undetermined');
 assert.equal(sendRecheckVerdict('msg_abc',{pendingSubmissions:[{id:123}]}),'undetermined');
 assert.equal(sendRecheckVerdict('msg_abc',{pendingSubmissions:[null,{id:'other'}]}),'undetermined');
 assert.equal(sendRecheckVerdict('msg_abc',{pendingSubmissions:[{id:'other'},{}]}),'undetermined');
});

test('verdict: a full pending page (LIMIT 100) is undetermined even when the id is absent or present',()=>{
 const full=Array.from({length:100},(_,i)=>({id:'row_'+i}));
 assert.equal(sendRecheckVerdict('msg_abc',{pendingSubmissions:full}),'undetermined');
 assert.equal(sendRecheckVerdict('msg_abc',{pendingSubmissions:[...full.slice(0,99),{id:'msg_abc'}]}),'undetermined');
 const over=Array.from({length:101},(_,i)=>({id:'row_'+i}));
 assert.equal(sendRecheckVerdict('msg_abc',{pendingSubmissions:over}),'undetermined');
 // 99 well-formed rows is below the cap, so absence is a real delivery signal.
 assert.equal(sendRecheckVerdict('msg_abc',{pendingSubmissions:full.slice(0,99)}),'delivered');
});

test('verdict: malformed or missing reconcile payloads stay undetermined, never delivered',()=>{
 assert.equal(sendRecheckVerdict('msg_abc',undefined),'undetermined');
 assert.equal(sendRecheckVerdict('msg_abc',null),'undetermined');
 assert.equal(sendRecheckVerdict('msg_abc',{}),'undetermined');
 assert.equal(sendRecheckVerdict('msg_abc',{pendingSubmissions:null}),'undetermined');
 assert.equal(sendRecheckVerdict('msg_abc',{pendingSubmissions:'nope'}),'undetermined');
 assert.equal(sendRecheckVerdict('msg_abc',{ok:true}),'undetermined');
});

interface HarnessOpts{current?:(c:SendRecheckContext)=>boolean;reconcile?:(roomId:string)=>Promise<unknown>;}
function harness(opts:HarnessOpts={}){
 const timers=new Map<number,{fn:()=>void;ms:number}>();let next=1;
 const calls:string[]=[];const settled:[string,SendRecheckContext][]=[];let checking=0;
 let current=opts.current??(()=>true);
 let reconcile=opts.reconcile??(async()=>({pendingSubmissions:[]}));
 const controller=createSendRecheck({
  reconcile:roomId=>{calls.push(roomId);return reconcile(roomId);},
  isCurrent:c=>current(c),
  onChecking:()=>{checking++;},
  onSettled:(v,c)=>{settled.push([v,c]);},
  delayMs:SEND_RECHECK_DELAY_MS,
  setTimer:(fn,ms)=>{const id=next++;timers.set(id,{fn,ms});return id as unknown as ReturnType<typeof setTimeout>;},
  clearTimer:handle=>{timers.delete(handle as unknown as number);},
 });
 const fire=()=>{const entries=[...timers.values()];timers.clear();for(const t of entries)t.fn();};
 return{controller,calls,settled,fire,timers,checking:()=>checking,setCurrent:(f:(c:SendRecheckContext)=>boolean)=>{current=f;},setReconcile:(f:(roomId:string)=>Promise<unknown>)=>{reconcile=f;}};
}

test('schedule announces checking immediately and issues exactly one read-only reconcile after the delay',async()=>{
 const h=harness();
 h.controller.schedule(ctx);
 assert.equal(h.checking(),1);
 assert.equal(h.calls.length,0,'no reconcile before the delay elapses');
 assert.equal(h.timers.size,1);
 assert.equal([...h.timers.values()][0]?.ms,SEND_RECHECK_DELAY_MS);
 h.fire();
 assert.equal(h.calls.length,1,'exactly one reconcile, never a replay');
 assert.deepEqual(h.calls,['room_1']);
 assert.equal(h.timers.size,0,'the check is not re-armed');
 await flush();
 assert.deepEqual(h.settled,[['delivered',ctx]]);
});

test('schedule for a non-current identity neither announces checking nor arms a timer (late rejection guard)',async()=>{
 const h=harness({current:()=>false});
 h.controller.schedule(ctx);
 assert.equal(h.checking(),0,'must not pollute another room with a checking state');
 assert.equal(h.timers.size,0);
 h.fire();await flush();
 assert.equal(h.calls.length,0);
 assert.equal(h.settled.length,0);
});

test('the three verdicts reach onSettled with the original context',async()=>{
 for(const[response,verdict]of[
  [{pendingSubmissions:[]},'delivered'],
  [{pendingSubmissions:[{id:'msg_abc'}]},'not_delivered'],
  [{pendingSubmissions:Array.from({length:100},()=>({id:'x'}))},'undetermined'],
 ]as const){
  const h=harness({reconcile:async()=>response});
  h.controller.schedule(ctx);h.fire();await flush();
  assert.deepEqual(h.settled,[[verdict,ctx]]);
 }
});

test('a rejected reconcile settles undetermined, never delivered or not_delivered',async()=>{
 const h=harness({reconcile:async()=>{throw new Error('broker_unavailable');}});
 h.controller.schedule(ctx);h.fire();await flush();
 assert.deepEqual(h.settled,[['undetermined',ctx]]);
});

test('cancel before the delay fires issues no reconcile and no verdict',async()=>{
 const h=harness();
 h.controller.schedule(ctx);
 h.controller.cancel();
 assert.equal(h.timers.size,0);
 h.fire();await flush();
 assert.equal(h.calls.length,0);
 assert.equal(h.settled.length,0);
});

test('a newer send reschedules: the cancelled check never fires, only the latest identity is reconciled',async()=>{
 const h=harness();
 const newer:SendRecheckContext={...ctx,id:'msg_new',text:'second'};
 h.controller.schedule(ctx);
 h.controller.schedule(newer);
 assert.equal(h.timers.size,1,'the previous timer was cleared');
 assert.equal(h.checking(),2);
 h.fire();await flush();
 assert.equal(h.calls.length,1);
 assert.deepEqual(h.settled,[['delivered',newer]]);
});

test('a room switch (isCurrent false) before firing suppresses the reconcile entirely',async()=>{
 const h=harness();
 h.controller.schedule(ctx);
 h.setCurrent(()=>false);
 h.fire();await flush();
 assert.equal(h.calls.length,0);
 assert.equal(h.settled.length,0);
});

test('a stale in-flight response is discarded when the identity is no longer current',async()=>{
 let resolveReconcile:(v:unknown)=>void=()=>{};
 const h=harness({reconcile:()=>new Promise(r=>{resolveReconcile=r;})});
 h.controller.schedule(ctx);
 h.fire();
 assert.equal(h.calls.length,1);
 h.setCurrent(()=>false);
 resolveReconcile({pendingSubmissions:[]});
 await flush();
 assert.equal(h.settled.length,0,'a late response must not settle a superseded send');
});

test('cancel after firing but before the response discards the late verdict (unmount semantics)',async()=>{
 let resolveReconcile:(v:unknown)=>void=()=>{};
 const h=harness({reconcile:()=>new Promise(r=>{resolveReconcile=r;})});
 h.controller.schedule(ctx);
 h.fire();
 h.controller.cancel();
 resolveReconcile({pendingSubmissions:[{id:'msg_abc'}]});
 await flush();
 assert.equal(h.settled.length,0);
});

test('a stale response is also discarded when a newer send replaced the identity mid-flight',async()=>{
 let resolveFirst:(v:unknown)=>void=()=>{};
 const h=harness({reconcile:()=>new Promise(r=>{resolveFirst=r;})});
 h.controller.schedule(ctx);
 h.fire();
 const newer:SendRecheckContext={...ctx,id:'msg_new'};
 h.setReconcile(async()=>({pendingSubmissions:[]}));
 h.controller.schedule(newer);
 resolveFirst({pendingSubmissions:[]});
 await flush();
 assert.equal(h.settled.length,0,'the first response is stale once a newer send scheduled');
 h.fire();await flush();
 assert.deepEqual(h.settled,[['delivered',newer]]);
});

test('main.tsx schedules only for a still-current managed send and never replays it',()=>{
 const main=readFileSync('desktop/renderer/src/main.tsx','utf8');
 assert.match(main,/import \{createSendRecheck,isUnknownSendReceipt\} from '\.\/send-recheck';/);
 // stillCurrent binds lifecycle, a cancellable recheck epoch, navigation generation, room and identity.
 assert.match(main,/const stillCurrent=\(\)=>mounted\.current&&recheckEpoch\.current===epoch&&navigation\.current===generation&&activeRoom\.current===target&&sendIdentity\.current\.get\(target\)\?\.id===id;/);
 assert.match(main,/const scheduleIfManaged=\(managed:boolean\)=>\{if\(managed&&stillCurrent\(\)\)sendRecheck\.current!\.schedule\(\{roomId:target,id,text,replyToMessageId\}\);\};/);
 // The catch resolves managed (closure settings or a read-only re-query), schedules, then rethrows ONLY while still current.
 assert.match(main,/catch\(error\)\{if\(!uploadIds\.length&&!choice&&isUnknownSendReceipt\(error\)&&stillCurrent\(\)\)\{if\(settings\)scheduleIfManaged\(true\);else void api\.settings\(target\)\.then\(s=>scheduleIfManaged\(!!s\?\.settings\)\)\.catch\(\(\)=>\{\}\);\}if\(stillCurrent\(\)\)throw error;return;\}/);
 // A new send cancels any pending check (bumping the epoch) and captures the fresh epoch.
 assert.match(main,/follow\.current=true;latestAfterSend\.current=true;cancelRecheck\(\);const generation=navigation\.current,epoch=recheckEpoch\.current;/);
 // The controller reconciles through the whitelisted read-only API and guards on room + identity.
 assert.match(main,/reconcile:target=>api\.reconcile\(target\)/);
 assert.match(main,/isCurrent:context=>activeRoom\.current===context\.roomId&&sendIdentity\.current\.get\(context\.roomId\)\?\.id===context\.id/);
});

test('a stale send rejection does not pollute another room banner: the error is rethrown only while still current',()=>{
 const main=readFileSync('desktop/renderer/src/main.tsx','utf8');
 // Conditional rethrow: a late rejection after a room switch / unmount is swallowed instead of reaching act.setError.
 assert.match(main,/if\(stillCurrent\(\)\)throw error;return;/);
 assert.doesNotMatch(main,/catch\(error\)\{if\(!uploadIds\.length&&!choice&&isUnknownSendReceipt\(error\)&&stillCurrent\(\)\)\{[^}]*\}throw error;\}/);
});

test('main.tsx cancels the check (invalidating in-flight re-queries) on room switch, unmount and manual reconcile',()=>{
 const main=readFileSync('desktop/renderer/src/main.tsx','utf8');
 // cancelRecheck bumps the epoch so a pending settings re-query cannot revive a cancelled check.
 assert.match(main,/const cancelRecheck=\(\)=>\{recheckEpoch\.current\+\+;sendRecheck\.current\?\.cancel\(\);setSendOutcome\(''\);setSendRechecking\(false\);\};/);
 assert.match(main,/useEffect\(\(\)=>\{mounted\.current=true;return\(\)=>\{mounted\.current=false;recheckEpoch\.current\+\+;sendRecheck\.current\?\.cancel\(\);\};\},\[\]\);/);
 assert.match(main,/useEffect\(\(\)=>\{cancelRecheck\(\);peerReturn\.current=undefined;/);
 assert.match(main,/const reconcileNow=\(\)=>\{const target=activeRoom\.current;if\(!target\)return;cancelRecheck\(\);void act\(\(\)=>api\.reconcile\(target\)\);\};/);
 assert.match(main,/\{pending>0&&<div className="pending-note">\{pending\} 条消息发送结果待核对<button disabled=\{busy\} onClick=\{reconcileNow\}>核对结果<\/button><\/div>\}/);
});

test('main.tsx suppresses the unknown banner while checking and shows a plain-language conclusion for each verdict',()=>{
 const main=readFileSync('desktop/renderer/src/main.tsx','utf8');
 assert.match(main,/error&&!\(sendRechecking&&error===explain\('upstream_operation_unknown'\)\)&&<div className="error-banner"/);
 assert.match(main,/\{sendRechecking&&<div className="send-recheck-note" role="status">正在自动核对发送结果…<\/div>\}/);
 assert.match(main,/\{sendOutcome==='delivered'&&<div className="send-recheck-note" role="status">已自动核对：刚才的消息已送达。<\/div>\}/);
 assert.match(main,/\{sendOutcome==='not_delivered'&&<div className="send-recheck-note" role="status">已自动核对：暂未看到这条消息送达，可直接重试。<\/div>\}/);
 // undetermined carries its own reconcile entry, independent of the work-driven pending count.
 assert.match(main,/\{sendOutcome==='undetermined'&&<div className="send-recheck-note" role="status"><span>发送结果暂未确认，自动核对后仍无法确认。<\/span><button disabled=\{busy\} onClick=\{reconcileNow\}>核对结果<\/button><\/div>\}/);
});

test('every verdict drops only the unknown banner; delivered clears draft/reply/identity and refreshes, not_delivered keeps the draft, undetermined keeps a retry entry',()=>{
 const main=readFileSync('desktop/renderer/src/main.tsx','utf8');
 // The banner clear is guarded so a concurrent unrelated error is never clobbered (applies to all three verdicts).
 assert.match(main,/setError\(previous=>previous===explain\('upstream_operation_unknown'\)\?'':previous\);/);
 assert.match(main,/if\(verdict==='delivered'\)\{\s*if\(replyRef\.current\?\.messageId===context\.replyToMessageId\)setReply\(undefined\);\s*setDrafts\(d=>d\[context\.roomId\]===context\.text\?\{\.\.\.d,\[context\.roomId\]:''\}:d\);\s*if\(sendIdentity\.current\.get\(context\.roomId\)\?\.id===context\.id\)sendIdentity\.current\.delete\(context\.roomId\);\s*setSendOutcome\('delivered'\);\s*void refreshRef\.current\(\);\s*\}else if\(verdict==='not_delivered'\)\{\s*setSendOutcome\('not_delivered'\);\s*\}else\{\s*setSendOutcome\('undetermined'\);\s*\}/);
 // undetermined must not overwrite the global error banner with a send-specific string.
 assert.doesNotMatch(main,/setError\('发送结果暂未确认/);
});

test('the shared unknown-receipt reason copy is left untouched (other mutations reuse the code)',()=>{
 const api=readFileSync('desktop/renderer/src/api.ts','utf8');
 assert.match(api,/upstream_operation_unknown/);
 const main=readFileSync('desktop/renderer/src/main.tsx','utf8');
 // The renderer does not redefine the global reasons map; it only adds the send-specific conclusion lines.
 assert.doesNotMatch(main,/upstream_operation_unknown'\s*:\s*'/);
});