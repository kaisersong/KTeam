import assert from 'node:assert/strict';
import {test} from 'node:test';
import {routineScheduleLabel} from '../src/protocol/routine-calendar.js';

test('schedule summaries show time of day for repeating periods and dates for single occurrences',()=>{
 assert.equal(routineScheduleLabel({kind:'daily',time:'12:00',weekdays:[7,6,5,4,3,2,1]}),'每天 12:00');
 assert.equal(routineScheduleLabel({kind:'daily',time:'17:43',weekdays:[5,1,2,4,3]}),'周一至周五 17:43');
 assert.equal(routineScheduleLabel({kind:'daily',time:'16:02',weekdays:[5]}),'每周五 16:02');
 assert.equal(routineScheduleLabel({kind:'daily',time:'09:05',weekdays:[5,1,1]}),'每周一、周五 09:05');
 assert.equal(routineScheduleLabel({kind:'interval',startAt:0,minutes:120}),'每 2 小时');
 assert.equal(routineScheduleLabel({kind:'interval',startAt:0,minutes:90}),'每 90 分钟');
 assert.match(routineScheduleLabel({kind:'once',at:Date.UTC(2026,10,23,16,5)},'Asia/Shanghai'),/11\/24\s+00:05/);
});
