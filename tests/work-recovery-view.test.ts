import {test} from 'node:test';
import assert from 'node:assert/strict';
import {currentRecoveryJob} from '../src/protocol/work-recovery-view.js';
const stopped={id:'old-run',roomId:'room-pm',state:'stopped'};
test('completed work suppresses historical interruptions even when a stale recovery projection remains',()=>{
 const jobs=[{id:'completed',roomId:'room-pm',state:'delivered'},stopped];
 assert.equal(currentRecoveryJob('room-pm',jobs,null),undefined);
 assert.equal(currentRecoveryJob('room-pm',jobs,{jobId:stopped.id}),undefined);
});
test('only a current matching owner-selected interruption is shown',()=>{
 for(const state of ['stopped','blocked','unknown']){const job={...stopped,state};assert.equal(currentRecoveryJob('room-pm',[job],{jobId:job.id}),job);}
 for(const recovery of [undefined,null,{}, {jobId:'other'}])assert.equal(currentRecoveryJob('room-pm',[stopped],recovery),undefined);
 for(const state of ['running','waiting','queued','delivered'])assert.equal(currentRecoveryJob('room-pm',[{...stopped,state}],{jobId:stopped.id}),undefined);
});
test('room changes and loading never borrow another conversation interruption',()=>{
 assert.equal(currentRecoveryJob('room-cto',[stopped],{jobId:stopped.id}),undefined);
 assert.equal(currentRecoveryJob(undefined,[stopped],{jobId:stopped.id}),undefined);
 assert.equal(currentRecoveryJob('room-pm',[],{jobId:stopped.id}),undefined);
});
