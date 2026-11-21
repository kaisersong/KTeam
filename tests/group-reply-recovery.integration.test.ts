import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {realUpstreams} from './helpers/real-upstreams.js';
import {TeamStore} from '../src/service/team-store.js';
import {TeamCoordinator} from '../src/service/coordination.js';
import {WorkRecovery} from '../src/service/work-recovery.js';
import {currentModelFailure} from '../src/protocol/model-failure-notice.js';

test('a halted and tool-free member format failure only retries its own reply once while the parent is waiting',async()=>{
 const fixture=await realUpstreams();
 const root=join(fixture.root,'host');mkdirSync(root,{mode:0o700});
 const store=new TeamStore(root);
 const coordinator=new TeamCoordinator(fixture.upstream,store,1,{
  catalog:async()=>({defaultModelId:'fixture'}),
  identity:async()=>({model:'fixture',fingerprint:'fixture'}),
 });
 const user={requestSource:'user'};
 try{
  const a=await coordinator.createMember({name:'Synthetic PM',modelId:'fixture',requestId:'pm'},user);
  const b=await coordinator.createMember({name:'Synthetic reviewer',modelId:'fixture',requestId:'reviewer'},user);
  const botId=a.bot.id;
  const {roomId}=(await coordinator.createGroup({
   title:'Synthetic project',goal:'Discuss the synthetic plan',memberAgentIds:[botId,b.bot.id],requestId:'group',
  },user)).room;
  const originId='synthetic-message',sourceId='synthetic-parent',failedId='synthetic-reply';
  const {task}:any=await fixture.upstream.aimp(roomId,'event',{
   id:'msg_'+'1'.repeat(32),roomId,threadId:'format-retry',act:'request',body:'Synthetic reply',
   payload:{kind:'task.request@1',must_understand:true,description:'Synthetic reply',
    deadline:new Date(Date.now()+3600000).toISOString(),expires:new Date(Date.now()+300000).toISOString(),
    budget:'none',acceptance:{predicates:['artifact_hash'],subjective:'Review reply',trust_root:'human://kteam.local/user.local'},
    assignee:'agent://kteam.local/'+botId,reviewer:'human://kteam.local/user.local'},
  });
  await fixture.upstream.aimp(roomId,'event',{
   id:'msg_'+'2'.repeat(32),roomId,threadId:task.threadId,taskRef:task.taskRef,act:'stop',body:'Synthetic invalid stream',
   targetEvent:{id:task.headId,hash:task.headHash},payload:{kind:'task.stop@1',must_understand:true,reason:'Invalid stream'},
  });
  store.enqueue(sourceId,roomId,originId);
  const source=store.job(sourceId);
  Object.assign(source,{state:'waiting',groupPlan:{mode:'work',members:[botId,b.bot.id]}});store.save(source);
  store.enqueueFollowup({id:failedId,roomId,originId,trigger:'group-response',
   groupResponse:{sourceJobId:sourceId,botId,mode:'work'}});
  const failed=store.job(failedId);
  Object.assign(failed,{state:'blocked',reason:'model_response_protocol_invalid',activeBotId:botId,
   finishedAt:new Date(Date.now()-10000).toISOString(),task:{taskRef:task.taskRef},
   executionScope:{binding:store.binding(botId),profileRevision:0},
   failure:{code:'model_response_protocol_invalid',phase:'model',evidence:'captured',botId}});
  store.save(failed);
  store.enqueueFollowup({id:'already-replied',roomId,originId,trigger:'group-response',
   groupResponse:{sourceJobId:sourceId,botId:b.bot.id,mode:'work'}});
  const completed=store.job('already-replied');completed.state='delivered';store.save(completed);
  const recovery=new WorkRecovery(fixture.upstream,store,coordinator);
  failed.toolTrace=[{type:'tool_started',name:'write'}];store.save(failed);
  await recovery.wakeSafe();
  assert.equal(store.jobs(roomId).filter(job=>job.groupReplyFormatRetry).length,0);
  delete failed.toolTrace;store.save(failed);
  const prior=JSON.stringify(failed);
  await recovery.wakeSafe();
  const [retry]=store.jobs(roomId).filter(job=>job.groupReplyFormatRetry);
  assert.equal(retry.state,'queued');
  assert.equal(retry.originId,originId);
  assert.equal(retry.groupResponse.botId,botId);
  assert.equal(retry.task,undefined);
  assert.equal(currentModelFailure(roomId,store.jobs(roomId)),undefined);
  retry.state='blocked';retry.failure=failed.failure;retry.finishedAt=failed.finishedAt;retry.activeBotId=botId;store.save(retry);
  await recovery.wakeSafe();
  assert.equal(store.jobs(roomId).filter(job=>job.groupReplyFormatRetry).length,1);
  assert.equal(JSON.stringify(store.job(failedId)),prior);
  assert.equal(store.job(sourceId).state,'waiting');
  assert.equal(store.job('already-replied').state,'delivered');
 }finally{store.close();await fixture.close();}
});
