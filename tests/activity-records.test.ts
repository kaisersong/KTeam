import {test} from 'node:test';
import assert from 'node:assert/strict';
import {activityRecords,activityStateLabels,eventStateLabels} from '../src/protocol/activity-records.js';

test('activity stays in the current Room and never projects internal execution credentials',()=>{
 const jobs=[{id:'foreign',roomId:'private-room',toolTrace:[{name:'read',input:'PRIVATE'}]},null,
  {id:'local',roomId:'room',state:'unknown',calls:2,token:'CREDENTIAL',execution:{grant:'PRIVATE_GRANT'},
   results:[{messageId:'reply',admission:'PRIVATE_ADMISSION'},{messageId:'reply'}],
   toolTrace:[{id:'e',name:'read',state:'failed',code:'execution_lease_lost',input:'recorded',credential:'PRIVATE_CREDENTIAL'}]}];
 const records=activityRecords(jobs,'room');assert.equal(records.length,1);
 assert.deepEqual(records[0]!.resultMessageIds,['reply']);assert.equal(records[0]!.events[0]!.code,'execution_lease_lost');
 assert.doesNotMatch(JSON.stringify(records),/PRIVATE|CREDENTIAL/);
 assert.equal(records[0]!.state,'unknown');assert.equal(activityStateLabels.unknown,'结果待核对');
 assert.equal(activityStateLabels.delivered,'已提交答复');assert.notEqual(activityStateLabels.delivered,'已验收');
});
test('activity bounds long persisted traces and labels missing tool status without reporting success',()=>{
 const events=Array.from({length:130},(_,index)=>({id:String(index),name:'bash',input:'x'.repeat(10000),result:'y'.repeat(3000)}));
 const job={id:'local',roomId:'room',toolTrace:events,results:null};
 const records=activityRecords(Array.from({length:120},()=>job),'room');assert.equal(records.length,100);
 const record=records[0]!;assert.equal(record.events.length,100);assert.equal(record.events[0]!.id,'30');assert.equal(record.eventsLimited,true);
 const event=record.events[0]!;assert.equal(event.input!.length,8192);assert.equal(event.result!.length,2000);assert.equal(event.previewTruncated,true);
 assert.equal(eventStateLabels[event.state],'未报告状态');assert.equal(events[0]!.input.length,10000);
});
test('activity handles old partial records, absent traces, and duplicate result links',()=>{
 const [record]=activityRecords([{id:'old',roomId:'room',calls:-1,members:['a',null,'a'],activeBotId:'b',results:[null,{messageId:'m'},{messageId:2}],toolTrace:[null,{name:'read',state:'running',input:{path:'fixture.md'}}]}],'room');
 assert.ok(record);assert.equal(record.calls,0);assert.deepEqual(record.botIds,['a','b']);assert.deepEqual(record.resultMessageIds,['m']);
 assert.equal(record.events[0]!.input,'{"path":"fixture.md"}');assert.equal(record.events[0]!.state,'running');
 assert.deepEqual(activityRecords([{id:'empty',roomId:'room'}],'room')[0]!.events,[]);
});
