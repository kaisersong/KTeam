import {test} from 'node:test';
import assert from 'node:assert/strict';
import {routineSchedule,routineTimeZone,nextRoutineAt} from '../src/protocol/routine-schedule.js';
const at=Date.parse;
test('routine schedule validates exact shapes, timezone and bounded recurrence',()=>{
 for(const value of [{kind:'cron'}, {kind:'once',at:NaN},{kind:'interval',startAt:1,minutes:1},{kind:'daily',time:'24:00',weekdays:[1]},{kind:'daily',time:'09:00',weekdays:[1,1]},{kind:'daily',time:'09:00',weekdays:Array(1)}])assert.throws(()=>routineSchedule(value));
 assert.throws(()=>routineTimeZone('Invalid/Zone'));assert.throws(()=>routineSchedule({kind:'once',at:100,grant:'all'}),/unknown_field/);
 assert.equal(nextRoutineAt({kind:'once',at:100},'UTC',100),null);
 assert.equal(nextRoutineAt({kind:'interval',startAt:1000,minutes:15},'UTC',1801000),2701000);
 assert.equal(nextRoutineAt({kind:'interval',startAt:1000,minutes:15},'UTC',1801000,2000000),null);
});
test('daily routine uses its explicit timezone and weekdays across year boundaries',()=>{
 const schedule=routineSchedule({kind:'daily',time:'09:00',weekdays:[1,2,3,4,5]});
 assert.equal(nextRoutineAt(schedule,'Asia/Shanghai',at('2026-11-06T02:00:00Z')),at('2026-11-09T01:00:00Z'));
 assert.equal(nextRoutineAt(schedule,'Asia/Kathmandu',at('2026-12-31T04:00:00Z')),at('2027-01-01T03:15:00Z'));
});
test('DST gaps skip the missing clock time and folds execute only the first occurrence',()=>{
 const gap={kind:'daily' as const,time:'02:30',weekdays:[1,2,3,4,5,6,7]};
 assert.equal(nextRoutineAt(gap,'America/New_York',at('2026-03-08T05:00:00Z')),at('2026-03-09T06:30:00Z'));
 const fold={...gap,time:'01:30'};
 assert.equal(nextRoutineAt(fold,'America/New_York',at('2026-11-01T04:00:00Z')),at('2026-11-01T05:30:00Z'));
 assert.equal(nextRoutineAt(fold,'America/New_York',at('2026-11-01T05:31:00Z')),at('2026-11-02T06:30:00Z'));
});
