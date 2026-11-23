import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AssistantDaily} from '../src/service/assistant-daily.js';
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
  assert.match(sent[0]!,/午报.*待查看邮件 1 项/s);
  assert.doesNotMatch(sent[0]!,/Private fixture|fixture@example/);
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
