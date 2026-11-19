import {test} from 'node:test';
import assert from 'node:assert/strict';
import {currentRecoveryJob,mobileRecoveryNotice} from '../src/protocol/work-recovery-view.js';
const stopped={id:'old-run',roomId:'room-pm',state:'stopped'};
test('completed work suppresses historical interruptions even when a stale recovery projection remains',()=>{
 const jobs=[{id:'completed',roomId:'room-pm',state:'delivered'},stopped];
 assert.equal(currentRecoveryJob('room-pm',jobs,null),undefined);
 assert.equal(currentRecoveryJob('room-pm',jobs,{jobId:stopped.id}),undefined);
 const afterJobId=stopped.id;
 const dependent={id:'queued-message',roomId:'room-pm',state:'queued',afterJobId};
 const response={id:'group-response',roomId:'room-pm',state:'delivered',trigger:'group-response',groupResponse:{sourceJobId:dependent.id}};
 const discussion={id:'group-discussion',roomId:'room-pm',state:'noop',trigger:'group-discussion',groupInput:{sourceJobId:stopped.id}};
 assert.equal(currentRecoveryJob('room-pm',[response,discussion,dependent,stopped],{jobId:stopped.id}),stopped);
 assert.equal(currentRecoveryJob('room-pm',[response,dependent,...jobs],{jobId:stopped.id}),undefined);
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
test('a phone notice uses the recovery root instead of the newest queued or blocked follow-up',()=>{
 const root={id:'root',roomId:'room-pm',state:'stopped',reason:'host_restarted_result_unknown'};
 const queued={id:'queued-follow',roomId:'room-pm',state:'queued',afterJobId:root.id,trigger:'followup'};
 const blocked={id:'blocked-follow',roomId:'room-pm',state:'blocked',trigger:'followup'};
 const work={jobs:[blocked,queued,root],recovery:{jobId:root.id}};
 const first=work.jobs[0];
 assert.equal(mobileRecoveryNotice('room-pm',work)?.id,'root');
 assert.notEqual(mobileRecoveryNotice('room-pm',work)?.id,first?.id);
 assert.equal(mobileRecoveryNotice('room-pm',{jobs:work.jobs,recovery:{jobId:blocked.id}}),undefined);
 assert.equal(mobileRecoveryNotice('room-pm',{jobs:[queued],recovery:{jobId:root.id}}),undefined);
 assert.equal(mobileRecoveryNotice('other',work),undefined);
});
