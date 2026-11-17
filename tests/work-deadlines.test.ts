import {test} from 'node:test';
import assert from 'node:assert/strict';
import {newWorkDeadline,executionWindowMs,memberHandoffDeadline} from '../src/service/work-deadlines.js';
const now=Date.parse('2026-11-17T00:00:00Z'),hour=3600000;
const task=(hours:number)=>({terms:{deadline:new Date(now+hours*hour).toISOString()}});
test('a five-stage group contract includes member windows and final review while independent executions remain bounded',()=>{
 const plan={groupPlan:{mode:'work',stages:Array.from({length:5},()=>({requests:[{}]}))}};
 assert.equal(Date.parse(newWorkDeadline(plan,now)),now+6*hour);
 assert.equal(Date.parse(newWorkDeadline({...plan,groupResponse:{}},now)),now+hour);
 assert.equal(Date.parse(newWorkDeadline({},now)),now+hour);
 assert.equal(executionWindowMs(task(6),now),hour);
 assert.equal(executionWindowMs(task(.25),now),hour/4);
 assert.equal(executionWindowMs(task(-1),now),0);
 assert.throws(()=>newWorkDeadline({groupPlan:{mode:'work',stages:Array(9)}},now));
});
test('implicit member waits use the captured contract without extending it; explicit deadlines, missing and invalid limits fail closed',()=>{
 const captured=task(6),snapshot=JSON.stringify(captured);
 assert.equal(memberHandoffDeadline(captured,undefined,now+31*60000),now+6*hour);
 assert.equal(memberHandoffDeadline(captured,10,now),now+10*60000);
 assert.equal(memberHandoffDeadline(task(.1),60,now),now+.1*hour);
 assert.equal(memberHandoffDeadline(task(-1),undefined,now),now-hour);
 assert.equal(JSON.stringify(captured),snapshot);
 for(const minutes of [0,-1,61,1.5,NaN])assert.throws(()=>memberHandoffDeadline(captured,minutes,now));
 assert.throws(()=>memberHandoffDeadline({},undefined,now));
 assert.throws(()=>executionWindowMs({},now));
});
