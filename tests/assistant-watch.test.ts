import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {AssistantDailySources} from '../src/service/assistant-daily-sources.js';
import {AssistantWatch} from '../src/service/assistant-watch.js';
import {TeamStore} from '../src/service/team-store.js';
import {watchDisplay} from '../src/protocol/assistant-watch.js';
import {yzjRecentGroupsId,type DailyItem} from '../src/protocol/assistant-daily-types.js';

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
 const future={id:'meeting',title:'决定接口',startDate:Date.parse('2026-11-23T10:00:00Z'),endDate:Date.parse('2026-11-23T11:00:00Z')};
 const withdrawn={...future,id:'withdrawn',cancelDate:Date.parse('2026-11-23T08:10:00Z')};
 const past={id:'past',title:'过去的会议',startTime:'2026-11-23T07:00:00Z',endTime:'2026-11-23T08:00:00Z'};
 let data:unknown={list:[future,past,withdrawn,{id:'cancelled',status:'cancelled'}],count:4};
 const source=new AssistantDailySources({} as never,{dailyYzj:async(args:string[])=>{
  assert.deepEqual(args,['calendar','event','list','--start','2026-11-23','--end','2026-11-23']);
  return data;
 }} as never);
 const scan=()=>source.scan({kind:'yzj-calendar',id:'calendar',label:'日程',account:'test',revision:'1'},now,now,'UTC',new AbortController().signal);
 assert.deepEqual((await scan()).items.map(item=>item.originalId),['meeting']);
 assert.equal((await scan()).partial,false);
 data={events:[future,{id:'malformed'}]};
 assert.equal((await scan()).partial,true);
 data={list:[future],count:2};
 assert.equal((await scan()).partial,true);
});

test('cloud chat reads the selected conversation within the pinned CLI limit and surfaces direct replies without an @',async()=>{
 const now=Date.parse('2026-11-23T09:00:00Z'),calls:string[][]=[];
 const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
 const source=new AssistantDailySources({} as never,{
  dailyYzjConnectedAt:()=>undefined,
  dailyYzj:async(args:string[])=>{
   calls.push(args);
   if(args[0]==='whoami')return {orgId:'fixture-org',openId:'me',tokenStatus:'valid'};
   return {list:[
    {message:{msgId:'other',fromOpenId:'coworker',sendTime:now-500,content:'已交付'}},
    {msgId:'mine',fromOpenId:'me',sendTime:now-500,content:'我方发送'},
   ]};
  },
 } as never);
 const result=await source.scan({kind:'yzj-message',id:'me-coworker',label:'测试私聊',account:hash(['fixture-org','me']),revision:hash(['fixture-org','me',null])},now-60000,now,'UTC',new AbortController().signal);
 assert.deepEqual(calls,[['whoami'],['im','message','list','--group-id','me-coworker','--type','newest','--limit','20']]);
 assert.deepEqual(result.items.map(item=>item.originalId),['other']);
 assert.equal(result.partial,true);
});

test('the recent-groups scope pages to 30 groups and only reopens groups that changed',async()=>{
 const now=Date.parse('2026-11-23T09:00:00Z'),reads:string[]=[],pages:string[]=[];
 const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
 const groups=Array.from({length:36},(_,index)=>({groupType:index===0?1:2,groupId:'g'+index,groupName:'Protected name',lastMsgId:'latest-'+index,lastMsgSendTime:'2026-11-23 16:59:58.000'}));
 let ownMessage=false;
 const source=new AssistantDailySources({} as never,{
  dailyYzjConnectedAt:()=>undefined,
  dailyYzj:async(args:string[])=>{
   if(args[0]==='whoami')return {orgId:'fixture-org',openId:'me',tokenStatus:'valid'};
   if(args[1]==='group'){
    assert.deepEqual(args.slice(0,6),['im','group','recent','--limit','20','--page']);
    const page=Number(args[6]);pages.push(String(page));
    return {list:groups.slice((page-1)*20,page*20),more:page===1};
   }
   const id=args[4]!;
   assert.deepEqual(args.slice(0,10),['im','message','list','--group-id',id,'--type','newest','--limit','20','--jq']);
   reads.push(id);
   const latest={msgId:'other-'+id,fromOpenId:'coworker',sendTime:'2026-11-23 16:59:58.000',content:'Protected project text'};
   return {list:ownMessage&&id==='g1'?[{...latest,msgId:'own-message',fromOpenId:'me',sendTime:now-1000},latest]:[latest]};
  },
 } as never);
 const config={kind:'yzj-message' as const,id:yzjRecentGroupsId,label:'最近 30 个群',account:hash(['fixture-org','me']),revision:hash(['fixture-org','me',null])};
 const scan=(recent?:{items:DailyItem[];cursors:NonNullable<Awaited<ReturnType<AssistantDailySources['scan']>>['recentCursors']>})=>
  source.scan(config,now-60000,now,'UTC',new AbortController().signal,recent);
 const first=await scan();
 assert.deepEqual(pages,['1','2']);
 assert.equal(reads.length,30);
 assert.ok(!reads.includes('g0')&&!reads.includes('g31'));
 assert.equal(first.items.length,30);
 assert.doesNotMatch(JSON.stringify(first.items),/Protected name|Protected project text/);
 assert.ok(first.partial);
 groups[1]!.lastMsgId='own-message';
 ownMessage=true;
 const second=await scan({items:first.items,cursors:first.recentCursors!});
 assert.deepEqual(reads.slice(30),['g1']);
 assert.deepEqual(second.items.map(item=>item.id),first.items.map(item=>item.id));
});

test('assistant guides setup independently without reading content or prompting for configured sources',async()=>{
 let hasEnterprise=false,hasMail=false,unknown=false;
 const sources=new AssistantDailySources({
  dailyAccounts:async()=>hasMail?[{id:'mail-fixture',status:'needs_reconnect'}]:[],
  dailySearch:()=>assert.fail('setup must not read messages'),
 } as never,{
  hasSavedConnection:async()=>unknown?undefined:hasEnterprise,
  dailyYzj:()=>assert.fail('setup must not read conversations'),
 } as never);
 assert.deepEqual(await sources.connectorSetup(),{enterprise:true,mail:true});
 hasMail=true;
 assert.deepEqual(await sources.connectorSetup(),{enterprise:true,mail:false});
 hasEnterprise=true;
 assert.deepEqual(await sources.connectorSetup(),{enterprise:false,mail:false});
 hasMail=false;
 assert.deepEqual(await sources.connectorSetup(),{enterprise:false,mail:true});
 unknown=true;
 assert.deepEqual(await sources.connectorSetup(),{enterprise:undefined,mail:true});
});

test('message triage grounds next steps in the source and rejects chatter or credential text',async()=>{
 const {messageAttention}=await import('../src/service/assistant-message-attention.js');
 const redact=(text:string)=>text.replace('private-fixture','[redacted]');
 const input={group:'验收群',stamp:100};
 assert.equal(messageAttention({...input,content:'收到，辛苦了'},redact),undefined);
 assert.equal(messageAttention({...input,content:'请确认 API key private-fixture'},redact),undefined);
 assert.equal(messageAttention({...input,content:'请确认 private-fixture'},redact),undefined);
 assert.deepEqual(messageAttention({...input,content:'{"text":"原定周会改到下午 3 点"}'},redact),
  {kind:'schedule',group:'验收群',text:'原定周会改到下午 3 点',at:100});
 assert.equal(messageAttention({...input,addressed:true,content:'验收材料周五截止'},redact)?.kind,'deadline');
 assert.equal(messageAttention({...input,addressed:true,content:'请你确认交付范围'},redact)?.kind,'decision');
 assert.equal(messageAttention({...input,content:'@all 截止目前收到的明天会议材料如下，大家可以提前审阅'},redact),undefined);
 assert.equal(messageAttention({...input,mentionPresent:true,content:'@某同事 请确认试点时间'},redact),undefined);
 assert.equal(messageAttention({...input,addressed:true,content:'采购申请我已处理，已经回复'},redact),undefined);
});


test('legacy daily source fingerprints recover only for a matching login already active when consent was saved',async()=>{
 const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
 const at=Date.parse('2026-11-23T09:00:00Z');
 let login=new Date(at-1000).toISOString(),user='me';
 const adapter=new AssistantDailySources({} as never,{
  dailyYzjConnectedAt:()=>login,
  dailyYzj:async()=>({orgId:'fixture-org',openId:user}),
 } as never);
 const source={kind:'yzj-message' as const,id:yzjRecentGroupsId,label:'最近 30 个群',account:hash(['fixture-org','me']),revision:hash(['fixture-org','me',null])};
 const recover=async()=>(await adapter.restoreYzjSources([source],at,new AbortController().signal))[0]!;
 assert.equal((await recover()).revision,hash(['fixture-org','me',login]));
 login=new Date(at+1000).toISOString();
 assert.equal(await recover(),source);
 login=new Date(at-1000).toISOString();
 user='another-user';
 assert.equal(await recover(),source);
});
