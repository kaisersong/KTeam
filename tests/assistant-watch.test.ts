import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {AssistantDailySources} from '../src/service/assistant-daily-sources.js';
import {AssistantWatch} from '../src/service/assistant-watch.js';
import {TeamStore} from '../src/service/team-store.js';
import {watchDisplay} from '../src/protocol/assistant-watch.js';
import type {DailyItem} from '../src/protocol/assistant-daily-types.js';

test('manual checks survive restart, distinguish missed and completed, and reject conflicting edits',async()=>{
 const root=mkdtempSync(join(tmpdir(),'kteam-watch-'));
 let store=new TeamStore(root),now=Date.parse('2026-11-23T09:00:00Z'),room='assistant-a';
 const start=()=>new AssistantWatch(store,async()=>{},()=>assert.fail('manual item must never read a connector'),()=>room,()=>now);
 let watches=start();
 const id=randomUUID(),hour=3600000;
 const input={action:'create',id,draft:{title:'接口清单',condition:'核对已确认的最终版',kind:'waiting',checkAt:now+hour,stopAt:now+4*hour}};
 try{
  assert.equal((await watches.change(input)).items[0]?.status,'scheduled');
  assert.equal((await watches.change(input)).items.length,1);
  await assert.rejects(watches.change({...input,draft:{...input.draft,itemId:'forged'}}),/watch_invalid/);
  await assert.rejects(watches.change({...input,draft:{...input.draft,link:'https://test:secret@example.test'}}),/watch_invalid/);
  await assert.rejects(watches.change({...input,draft:{...input.draft,title:'新标题'}}),/watch_changed/);
  now+=hour;
  assert.equal((await watches.view()).items[0]?.status,'due');
  assert.equal((await watches.change({action:'snooze',id,expectedRevision:1})).items[0]?.status,'scheduled');
  now+=2*hour;
  assert.equal((await watches.view()).items[0]?.status,'due');
  assert.equal((await watches.change({action:'check',id,expectedRevision:2})).items[0]?.status,'unconfirmed');
  const edits=await Promise.allSettled([watches.change({action:'done',id,expectedRevision:3}),watches.change({action:'stop',id,expectedRevision:3})]);
  assert.equal(edits.filter(edit=>edit.status==='fulfilled').length,1);
  assert.equal(edits.filter(edit=>edit.status==='rejected').length,1);
  const final=(await watches.view()).items[0]!.state;
  const missed={...input,id:randomUUID(),draft:{...input.draft,checkAt:now+hour,stopAt:now+2*hour}};
  await watches.change(missed);
  store.close();
  store=new TeamStore(root);
  watches=start();
  now+=3*hour;
  assert.equal((await watches.view()).items.find(item=>item.id===missed.id)?.status,'missed');
  assert.equal((await watches.view()).items.find(item=>item.id===id)?.state,final);
  await assert.rejects(watches.change({action:'check',id:missed.id,expectedRevision:1}),/watch_changed/);
  room='assistant-b';
  assert.deepEqual((await watches.view()).items,[]);
 }finally{store.close();rmSync(root,{recursive:true,force:true});}
});

test('a changed, missing or revoked source cannot disclose linked details or silently reopen the item',async()=>{
 const root=mkdtempSync(join(tmpdir(),'kteam-watch-source-'));
 const store=new TeamStore(root);
 const at=Date.parse('2026-11-23T09:00:00Z'),id=randomUUID(),itemId='a'.repeat(64);
 let accessible=true,detail='匹配已授权的练习消息';
 const evidence=async():Promise<DailyItem>=>{
  if(!accessible)throw Error('forbidden');
  return {id:itemId,source:{kind:'yzj-message',id:'synthetic',label:'会话',account:'test',revision:'1'},title:'消息',detail,observedAt:at,urgent:false,originalId:'source-msg',url:'https://example.test/message'};
 };
 const watches=new AssistantWatch(store,async()=>{},evidence,()=> 'assistant-fixture',()=>at);
 try{
  const create={action:'create',id,draft:{title:'私下跟进',condition:'查回音',kind:'waiting',checkAt:at+1000,stopAt:at+60000,itemId}};
  const first=(await watches.change(create)).items[0]!;
  assert.equal(first.details?.originalLink,'https://example.test/message');
  assert.equal(watchDisplay(first,at,at+30000).details,undefined);
  assert.doesNotMatch(JSON.stringify(store.operations()),/匹配已授权的练习消息|example\.test/);
  accessible=false;
  assert.equal((await watches.view()).items[0]?.details,undefined);
  await assert.rejects(watches.change({action:'check',id,expectedRevision:1}),/forbidden/);
  const stopped=(await watches.change({action:'stop',id,expectedRevision:1})).items[0]!;
  assert.equal(stopped.state,'stopped');
  assert.equal(stopped.status,'source-unavailable');
  accessible=true;detail='消息修订';
  assert.equal((await watches.view()).items[0]?.state,'stopped');
  assert.equal((await watches.view()).items[0]?.details,undefined);
  await assert.rejects(watches.change({action:'resume',id,expectedRevision:2}),/daily_source_changed/);
 }finally{store.close();rmSync(root,{recursive:true,force:true});}
});

test('calendar coverage ignores expected exclusions but reports malformed or explicitly paginated results',async()=>{
 const now=Date.parse('2026-11-23T09:00:00Z');
 const future={id:'meeting',title:'决定接口',startTime:'2026-11-23T10:00:00Z',endTime:'2026-11-23T11:00:00Z'};
 const past={id:'past',title:'过去的会议',startTime:'2026-11-23T07:00:00Z',endTime:'2026-11-23T08:00:00Z'};
 let data:unknown={events:[future,past,{id:'withdrawn',status:'cancelled'}]};
 const source=new AssistantDailySources({} as never,{dailyYzj:async(args:string[])=>{
  assert.deepEqual(args,['calendar','event','list','--start','2026-11-23','--end','2026-11-24']);
  return data;
 }} as never);
 const scan=()=>source.scan({kind:'yzj-calendar',id:'calendar',label:'日程',account:'test',revision:'1'},now,now,'UTC',new AbortController().signal);
 assert.deepEqual((await scan()).items.map(item=>item.originalId),['meeting']);
 assert.equal((await scan()).partial,false);
 data={events:[future,{id:'malformed'}]};
 assert.equal((await scan()).partial,true);
 data={events:[future],hasMore:true};
 assert.equal((await scan()).partial,true);
});
