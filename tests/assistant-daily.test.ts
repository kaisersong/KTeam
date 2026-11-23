import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AssistantDaily} from '../src/service/assistant-daily.js';
import {yzjRecentGroupsId} from '../src/protocol/assistant-daily-types.js';
import {dailyTimes,defaultDaily,type DailyItem,type DailySource} from '../src/protocol/assistant-daily.js';
import {TeamStore} from '../src/service/team-store.js';

const mail:DailySource={kind:'mail',id:'synthetic-mail',label:'fixture@example.test',account:'synthetic-mail',revision:'1'};
const at='2026-11-23T07:10:00Z';
test('planning does not read content before confirmation and duplicate receipts do not apply twice',async()=>{
 const root=mkdtempSync(join(tmpdir(),'kteam-daily-plan-'));
 let store=new TeamStore(root),now=Date.parse(at),active=true,reads=0;
 const source={
  catalog:async()=>({sources:[mail],yzjAvailable:false}),
  current:async()=>active,
  newsSource:async()=>{throw Error('unexpected');},
  scan:async():Promise<{items:DailyItem[];partial:boolean}>=>{reads++;return {items:[{id:'m1',source:mail,title:'练习邮件',detail:'fixture',urgent:false,observedAt:now,originalId:'m1'}],partial:false};},
  original:async()=>({url:'https://example.test/fixture'}),
 };
 process.env.TZ='UTC';
 store.configure({roomId:'assistant-room',kind:'assistant',goal:'',mode:'auto',paused:false,quiet:false,maxRuns:50,dailyCalls:50,revision:0},0);
 let service=new AssistantDaily(store,source,()=> 'assistant-room',()=>now);
 try {
  await service.refresh();assert.equal(reads,0);
  const options=service.tools('assistant-room','origin',async()=>{});
  assert.equal(service.tools('other','origin',async()=>{}).length,0);
  const created=JSON.parse(await options[1]!.execute({schedule:{morning:'08:30'},sourceKinds:['mail']}));
  assert.equal(created.awaitingConfirmation,true);
  const draft=service.planView().draft!;
  assert.equal(JSON.parse(await options[2]!.execute({})).checked,false);
  await service.refresh();assert.equal(reads,0);
  await assert.rejects(service.confirm({id:draft.id,expectedRevision:0,sources:[{...mail,id:'forged'}]}),/daily_source_changed/);
  const input={id:draft.id,expectedRevision:0,sources:[mail]};
  assert.equal((await service.confirm(input)).appliedRevision,1);
  assert.equal((await service.confirm(input)).appliedRevision,1);
  assert.doesNotMatch(await options[0]!.execute({}),/fixture@example.test/);
  const check=service.tools('assistant-room','one-time',async()=>{})[2]!;
  const checks=await Promise.all([check.execute({}),check.execute({})]);
  assert.deepEqual(checks[0],checks[1]);
  assert.equal(JSON.parse(checks[0]).checked,true);
  assert.equal(service.planView().revision,1);
  now=Date.parse('2026-11-23T09:00:00Z');
  const today=await service.refresh();
  assert.equal(today.items[0]?.title,'练习邮件');assert.equal(today.briefs[0]?.slot,'morning');
  assert.equal((await service.snooze({id:'m1'})).items.length,0);
  assert.equal((await service.original({id:'m1'})).url,'https://example.test/fixture');
  await service.close();store.close();store=new TeamStore(root);
  service=new AssistantDaily(store,source,()=> 'assistant-room',()=>now);
  assert.equal((await service.refresh()).briefs.length,1);
  active=false;
  assert.equal((await service.view()).items.length,0);
  assert.equal((await service.view()).briefs[0]?.items.length,0);
  await assert.rejects(service.original({id:'m1'}),/daily_source_unavailable/);
  const beforePreset=reads;
  const preset=await service.choosePreset({preset:'three',expectedRevision:1,expectedDraftId:null});
  assert.equal(preset.revision,1);
  assert.equal(preset.config?.middayUrgentOnly,false);
  assert.equal(preset.draft?.config.middayUrgentOnly,true);
  assert.deepEqual(preset.draft?.config.sources,[mail]);
  assert.equal(reads,beforePreset);
  const stale=service.propose({skipToday:'evening'},'older');
  const paused=service.propose({paused:true,removeSourceKinds:['mail']},'pause');
  assert.deepEqual(paused.config.sources,[]);
  await assert.rejects(service.confirm({id:stale.id,expectedRevision:1,sources:[]}),/daily_plan_changed/);
  await service.confirm({id:paused.id,expectedRevision:1,sources:[]});
  const before=reads;
  await service.refresh();assert.equal(reads,before);
 }finally{await service.close();store.close();delete process.env.TZ;rmSync(root,{recursive:true,force:true});}
});

test('brief timing uses the selected timezone, skips non-working days and preserves independent slots',()=>{
 const plan=defaultDaily('Asia/Shanghai');
 const rows=dailyTimes(plan,Date.parse('2026-11-23T04:01:00Z'));
 assert.deepEqual(rows.map(row=>row.due==null?null:new Date(row.due).toISOString()),['2026-11-23T00:30:00.000Z','2026-11-23T04:00:00.000Z',null]);
 assert.ok(dailyTimes(plan,Date.parse('2026-11-22T08:00:00Z')).every(row=>row.due===undefined));
});

test('scheduled briefs are queued once for fresh nonempty runs and never replay an uncertain delivery',async()=>{
 const root=mkdtempSync(join(tmpdir(),'kteam-daily-delivery-'));
 const store=new TeamStore(root);
 const roomId='assistant-room';
 let now=Date.parse('2026-11-23T08:29:30Z');
 const makeItem=():DailyItem=>({id:'fixture-mail',title:'Private fixture subject',detail:'Private fixture body',observedAt:now,source:mail,urgent:true});
 let collected:DailyItem[]=[];
 let deliveryUnknown=false;
 const sent:string[]=[];
 const sources={
  catalog:async()=>({sources:[mail],yzjAvailable:false}),current:async()=>true,
  scan:async()=>({items:collected,partial:false}),newsSource:async()=>assert.fail('not a news plan'),original:async()=>({url:undefined}),
 };
 store.configure({roomId,kind:'assistant',goal:'',mode:'auto',paused:false,quiet:false,maxRuns:5,dailyCalls:5,revision:0},0);
 const create=()=>new AssistantDaily(store,sources,()=>roomId,()=>now,async()=>{},async input=>{
  await input.guard();
  assert.equal(input.roomId,roomId);
  sent.push(input.body);
  if(deliveryUnknown)throw Error('simulated lost receipt');
  return 'fixture-message';
 });
 let daily=create();
 try{
  const config={...defaultDaily('UTC'),schedule:{morning:'08:30',midday:'12:00',evening:'18:00'},sources:[mail]};
  store.setState('assistant-daily-plan',{revision:1,config,changedAt:now,skips:[]});
  now=Date.parse('2026-11-23T08:30:20Z');
  const empty=await daily.refresh();
  assert.equal(empty.briefs.length,1);
  assert.deepEqual(sent,[]);
  collected=[makeItem()];
  now=Date.parse('2026-11-23T12:00:15Z');
  const pushed=await daily.refresh();
  assert.equal(pushed.briefs[0]?.delivery,'sent');
  assert.equal(sent.length,1);
  assert.match(sent[0]!,/午报.*待阅邮件.*Private fixture subject/s);
  assert.doesNotMatch(sent[0]!,/Private fixture body|fixture@example/);
  await daily.refresh();
  assert.equal(sent.length,1);
  deliveryUnknown=true;
  collected=[{...makeItem(),id:'another-mail'}];
  now=Date.parse('2026-11-23T18:03:00Z');
  assert.equal((await daily.refresh()).briefs[0]?.delivery,'unconfirmed');
  assert.equal(sent.length,2);
  await daily.close();
  daily=create();
  await daily.refresh();
  assert.equal(sent.length,2);
  now=Date.parse('2026-11-24T09:10:00Z');
  const late=await daily.refresh();
  assert.equal(late.briefs[0]?.slot,'morning');
  assert.equal(sent.length,2);
 }finally{await daily.close();store.close();rmSync(root,{recursive:true,force:true});}
});

test('recent groups refresh every fifteen minutes and count-only snapshots stay silent',async()=>{
 const root=mkdtempSync(join(tmpdir(),'kteam-group-cadence-'));
 const store=new TeamStore(root);
 const roomId='assistant-room';
 let now=Date.parse('2026-11-23T08:19:00Z'),scans=0,sends=0;
 const source:DailySource={kind:'yzj-message',id:yzjRecentGroupsId,label:'最近 30 个群',account:'fixture',revision:'1'};
 store.configure({roomId,kind:'assistant',goal:'',mode:'auto',paused:false,quiet:false,maxRuns:5,dailyCalls:5,revision:0},0);
 store.setState('assistant-daily-plan',{revision:1,changedAt:now,skips:[],config:{...defaultDaily('UTC'),sources:[source]}});
 const daily=new AssistantDaily(store,{
  catalog:async()=>({sources:[source],yzjAvailable:true}),current:async()=>true,newsSource:async()=>assert.fail('not a news plan'),
  original:async()=>({url:undefined}),scan:async(_source,_from,_now,_zone,_signal,previous)=>{
   scans++;
   if(scans===2)assert.equal(previous?.cursors['fixture']?.lastId,'msg-fixture');
   return {items:[{id:'fixture-group',source,title:'待查看',detail:'两项',observedAt:Date.parse('2026-11-23T08:00:00Z'),urgent:true}],partial:true,recentCursors:{fixture:{lastId:'msg-fixture',itemId:'fixture-group'}}};
  },
 },()=>roomId,()=>now,async()=>{},async()=>{sends++;return 'brief-message';});
 try{
  await daily['run'](false);
  now=Date.parse('2026-11-23T08:30:00Z');
  await daily['run'](false);
  assert.equal(scans,1);
  assert.equal(sends,0);
  now=Date.parse('2026-11-23T08:33:59Z');
  await daily['run'](false);
  assert.equal(scans,1);
  now=Date.parse('2026-11-23T08:34:00Z');
  await daily['run'](false);
  assert.equal(scans,2);
  assert.equal(sends,0);
 }finally{await daily.close();store.close();rmSync(root,{recursive:true,force:true});}
});

test('mail checks hourly, while a brief can use the latest check without reading the inbox again',async()=>{
 const root=mkdtempSync(join(tmpdir(),'kteam-mail-cadence-'));
 const store=new TeamStore(root);
 const roomId='assistant-room';
 const start=Date.parse('2026-11-23T08:10:00Z');
 let now=start,reads=0,connected=true;
 const sent:string[]=[];
 store.configure({roomId,kind:'assistant',goal:'',mode:'auto',paused:false,quiet:false,maxRuns:5,dailyCalls:5,revision:0},0);
 store.setState('assistant-daily-plan',{revision:1,changedAt:start,skips:[],config:{...defaultDaily('UTC'),sources:[mail]}});
 const daily=new AssistantDaily(store,{
  catalog:async()=>({sources:[mail],yzjAvailable:false}),current:async()=>connected,newsSource:async()=>assert.fail('not a news plan'),
  original:async()=>({url:undefined}),scan:async()=>{
   reads++;
   return {items:[{id:'mail-'+reads,source:mail,title:'待阅邮件',detail:'测试邮箱',observedAt:now,urgent:false}],partial:false};
  },
 },()=>roomId,()=>now,async()=>{},async input=>{sent.push(input.body);return 'brief-message';});
 try{
  await daily['run'](false);
  now=start+20*60000;
  await daily['run'](false);
  assert.equal(reads,1);
  assert.equal(sent.length,1);
  assert.match(sent[0]!,/邮件/);
  now=start+60*60000-1;
  await daily['run'](false);
  assert.equal(reads,1);
  now+=1;
  await daily['run'](false);
  assert.equal(reads,2);
  await daily.refresh();
  assert.equal(reads,3);
  connected=false;
  now+=60*60000;
  await daily['run'](false);
  assert.equal(reads,3);
  assert.equal((await daily.view()).items.length,0);
 }finally{await daily.close();store.close();rmSync(root,{recursive:true,force:true});}
});

test('fresh group messages are posted between briefs and an unknown delivery stays deduplicated across restarts',async()=>{
 const root=mkdtempSync(join(tmpdir(),'kteam-live-message-notice-'));
 const store=new TeamStore(root);
 const roomId='assistant-room',start=Date.parse('2026-11-23T16:00:00Z');
 const source:DailySource={kind:'yzj-message',id:yzjRecentGroupsId,label:'最近的群',account:'fixture',revision:'1'};
 let now=start,current=true,attempts=0,unknown=false;
 let item:DailyItem={id:'fresh-first',source,title:'private title',detail:'private content',observedAt:start-60000,urgent:false,messageAttention:{kind:'decision',group:'验收群',text:'请确认验收事项',at:start-60000}};
 store.configure({roomId,kind:'assistant',goal:'',mode:'auto',paused:false,quiet:false,maxRuns:5,dailyCalls:5,revision:0},0);
 store.setState('assistant-daily-plan',{revision:1,changedAt:start,skips:[],config:{...defaultDaily('UTC'),sources:[source]}});
 const service=()=>new AssistantDaily(store,{
  catalog:async()=>({sources:[source],yzjAvailable:true}),current:async()=>current,newsSource:async()=>assert.fail('not a news plan'),
  original:async()=>({url:undefined}),scan:async()=>({items:[item],partial:true}),
 },()=>roomId,()=>now,async()=>{},async input=>{
  attempts++;
  await input.guard();
  assert.equal(input.kind,'message-notice');
  assert.equal(input.roomId,roomId);
  assert.match(input.body,/消息里需要关注的事项/);
  assert.match(input.body,/验收群/);
  assert.match(input.body,/请确认验收事项/);
  assert.doesNotMatch(input.body,/private (title|content)/);
  if(unknown)throw new Error('unknown delivery');
  return 'message-1';
 });
 let daily=service();
 try{
  await daily['run'](false);
  assert.equal(attempts,1);
  await daily.refresh();
  assert.equal(attempts,1);
  now+=15*60000;
  item={...item,id:'fresh-second',observedAt:now,messageAttention:{...item.messageAttention!,at:now}};
  unknown=true;
  await daily['run'](false);
  assert.equal(attempts,2);
  await daily.close();
  daily=service();
  await daily.refresh();
  assert.equal(attempts,2);
  item={...item,id:'noise',messageAttention:undefined};
  await daily.refresh();
  assert.equal(attempts,2);
  current=false;
  item={...item,id:'revoked-item',messageAttention:{kind:'decision',group:'验收群',text:'请确认测试结果',at:now}};
  await daily.refresh();
  assert.equal(attempts,2);
 }finally{await daily.close();store.close();rmSync(root,{recursive:true,force:true});}
});

test('an actionable schedule notice checks the consented calendar before posting its finding',async()=>{
 const root=mkdtempSync(join(tmpdir(),'kteam-calendar-notice-'));
 const store=new TeamStore(root);
 const roomId='assistant-room',now=Date.parse('2026-11-23T08:00:00Z');
 const message:DailySource={kind:'yzj-message',id:yzjRecentGroupsId,label:'最近的群',account:'fixture',revision:'1'};
 const calendar:DailySource={kind:'yzj-calendar',id:'calendar',label:'日历',account:'fixture',revision:'1'};
 let deliveries=0;
 store.configure({roomId,kind:'assistant',goal:'',mode:'auto',paused:false,quiet:false,maxRuns:5,dailyCalls:5,revision:0},0);
 store.setState('assistant-daily-plan',{revision:1,changedAt:now,skips:[],config:{...defaultDaily('UTC'),sources:[message,calendar]}});
 const daily=new AssistantDaily(store,{
  catalog:async()=>({sources:[message,calendar],yzjAvailable:true}),current:async()=>true,
  original:async()=>({url:undefined}),newsSource:async()=>assert.fail('not a news plan'),
  scan:async(source,_from,_now,_timeZone,_signal,_recent,date)=>{
   const base={id:'sample',title:'样例例会',detail:'',observedAt:now-1000,urgent:false,source};
   if(source.kind==='yzj-message')return {partial:true,items:[{...base,messageAttention:{kind:'schedule',group:'样例组',text:'明天的样例例会取消',at:now-1000}}]};
   if(date===undefined)return {partial:false,items:[]};
   assert.equal(date,'2026-11-24');
   return {partial:false,items:[{...base,detail:'11/24 09:00–10:00'}]};
  },
 },()=>roomId,()=>now,async()=>{},async input=>{
  await input.guard();
  deliveries++;
  assert.match(input.body,/已核对 2026-11-24 的日历，当前仍列有「样例例会 · 11\/24 09:00–10:00」/);
  assert.doesNotMatch(input.body,/我可以/);
  return 'calendar-notice';
 });
 try{await daily.refresh();assert.equal(deliveries,1);}
 finally{await daily.close();store.close();rmSync(root,{recursive:true,force:true});}
});

test('the scheduled brief sends actionable message details once without a second live notification',async()=>{
 const root=mkdtempSync(join(tmpdir(),'kteam-content-brief-'));
 const store=new TeamStore(root);
 const roomId='assistant-room';
 const start=Date.parse('2026-11-23T17:59:00Z');
 let now=start,current=true;
 const source:DailySource={kind:'yzj-message',id:yzjRecentGroupsId,label:'最近 30 个群',account:'fixture',revision:'1'};
 const notice={kind:'decision' as const,group:'样例验收群',text:'请确认收到，下周一前提交验收材料。',at:start};
 const base={source,title:'仅在详情页保留',detail:'正文不可出现在简报',observedAt:start,urgent:false};
 const noise=Array.from({length:36},(_,i)=>({...base,id:'noise-'+i,observedAt:start+1000}));
 const sent:string[]=[];
 store.configure({roomId,kind:'assistant',goal:'',mode:'auto',paused:false,quiet:false,maxRuns:5,dailyCalls:5,revision:0},0);
 store.setState('assistant-daily-plan',{revision:1,changedAt:start,skips:[],config:{...defaultDaily('UTC'),sources:[source]}});
 const daily=new AssistantDaily(store,{
  catalog:async()=>({sources:[source],yzjAvailable:true}),current:async()=>current,newsSource:async()=>assert.fail('not a news plan'),
  original:async()=>({url:undefined}),scan:async()=>({items:[...noise,{...base,id:'useful',messageAttention:notice}],partial:true}),
 },()=>roomId,()=>now,async()=>{},async input=>{
  await input.guard();
  assert.equal(input.kind,undefined);
  current=false;
  await assert.rejects(input.guard(),/daily_source_changed/);
  current=true;
  await input.guard();
  sent.push(input.body);
  return 'brief-message';
 });
 try{
  now+=60000;
  const view=await daily.refresh();
  assert.equal(view.briefs[0]?.delivery,'sent');
  assert.equal(sent.length,1);
  assert.match(sent[0]!,/晚报.*需要确认 · 样例验收群.*下周一前提交验收材料.*回复草稿/s);
  assert.doesNotMatch(sent[0]!,/36 项|查看详情|正文不可出现在简报/);
  await daily.refresh();
  assert.equal(sent.length,1);
 }finally{await daily.close();store.close();rmSync(root,{recursive:true,force:true});}
});
