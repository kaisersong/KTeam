import assert from 'node:assert/strict';
import {test} from 'node:test';
import {AssistantDailyEnterprise} from '../src/service/assistant-daily-enterprise.js';
import {dailySource} from '../src/protocol/assistant-daily.js';
import {dailyBriefMessage} from '../src/service/assistant-daily-delivery.js';
import type {DailyEnterpriseProvider} from '../src/protocol/assistant-daily-types.js';

const now=Date.parse('2026-11-23T01:00:00Z');
const signal=new AbortController().signal;
const status=(provider:DailyEnterpriseProvider)=>({
 openId:'fixture-'+provider,orgId:'fixture-org',identityType:'user' as const,connectedAt:new Date(now).toISOString(),checkedAt:new Date(now).toISOString(),
});

test('enterprise brief connectors keep account scope, bound recent groups and skip revoked sources',async()=>{
 const readers:Array<{provider:DailyEnterpriseProvider;args:readonly string[]}>=[];
 let connected=true;
 const enterprise=new AssistantDailyEnterprise({
  dailyEnterpriseIdentity:async provider=>connected?status(provider):undefined,
  dailyEnterpriseRead:async(provider,args)=>{
   readers.push({provider,args});
   if(args[1]==='+chat-list')return {ok:true,data:{chats:[
    {chat_id:'oc_private',chat_mode:'p2p'},
    {chat_id:'--unsafe'},
    ...Array.from({length:34},(_,index)=>({chat_id:'oc_'+index,chat_mode:'group'})),
   ]}};
   assert.equal(args[1],'+chat-messages-list');
   return {ok:true,data:{messages:[
    {message_id:'message-'+readers.length,create_time:String(now-30000),sender:{id:'other-user'},body:{content:'not persisted'},mentions:[{id:{open_id:status(provider).openId}}]},
    {message_id:'own',create_time:String(now-10000),sender:{id:status(provider).openId}},
   ]}};
  },
 });
 const catalog=await enterprise.catalog();
 assert.equal(catalog.length,6);
 const source=catalog.find(entry=>entry.provider==='feishu'&&entry.kind==='enterprise-message')!;
 assert.equal(dailySource.safeParse({...source,provider:undefined}).success,false);
 const scan=await enterprise.scan(source,now-3600000,now,'Asia/Shanghai',signal);
 assert.equal(scan.partial,true);
 assert.equal(scan.items.length,30);
 assert.equal(readers.length,31);
 assert.equal(readers[0]?.args.includes('active_time'),true);
 assert.ok(!readers.some(read=>read.args.includes('oc_private')||read.args.includes('--unsafe')||read.args.includes('oc_30')));
 assert.ok(scan.items.every(item=>item.urgent&&item.observedAt===now-30000));
 assert.ok(!JSON.stringify(scan).includes('not persisted'));
 connected=false;
 assert.equal(await enterprise.current(source,signal),false);
 await assert.rejects(enterprise.scan(source,now-3600000,now,'Asia/Shanghai',signal),/daily_source_changed/);
 assert.equal(readers.length,31);
});

test('enterprise calendars normalize provider dates, flag partial coverage and keep titles out of the private brief message',async()=>{
 const called:string[]=[];
 const enterprise=new AssistantDailyEnterprise({
  dailyEnterpriseIdentity:async provider=>status(provider),
  dailyEnterpriseRead:async(provider,args)=>{
   called.push(provider+':'+args.slice(0,3).join(' '));
   if(provider==='feishu')return {ok:true,data:[{event_id:'calendar-a',summary:'飞书用例',
    start_time:{datetime:'2026-11-23T10:00:00+08:00'},end_time:{datetime:'2026-11-23T11:00:00+08:00'}}]};
   if(provider==='dingtalk')return {success:true,result:{events:[{id:'calendar-b',summary:'钉钉用例',
    start:{dateTime:'2026-11-23T09:30:00+08:00'},end:{dateTime:'2026-11-23T10:30:00+08:00'}}],nextCursor:'2'}};
   if(args[0]==='calendar')return {errcode:0,schedule_list:[{schedule_id:'calendar-c',subject:'企微用例',
    begin_time:'2026-11-23 10:00:00',end_time:'2026-11-23 11:00:00',timezone:{timezone_offset:28800}}]};
   return {errcode:853006};
  },
 });
 const calendar=(await enterprise.catalog()).filter(source=>source.kind==='enterprise-calendar');
 const scans=await Promise.all(calendar.map(source=>enterprise.scan(source,now-3600000,now,'Asia/Shanghai',signal)));
 assert.deepEqual(scans.map(result=>result.partial),[true,false,true]);
 assert.ok(called.some(call=>call.startsWith('wecom:meeting list')));
 const message=dailyBriefMessage('2026-11-23','morning',scans.flatMap(scan=>scan.items),now,'Asia/Shanghai')!;
 assert.match(message,/日程和会议 3 项/);
 assert.match(message,/09:30/);
 assert.doesNotMatch(message,/用例/);
});
