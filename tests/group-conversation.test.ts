import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseGroupConversation} from '../src/service/group-conversation.js';
test('group plans admit several real speakers and role-based stages without forcing a single leader response',()=>{
 const plan={mode:'work',members:['chief','pm','dev','qa'],reason:'distinct contributions',stages:[{requests:[{botId:'pm',message:'Clarify scope'}],doneWhen:'Scope returned'},{requests:[{botId:'dev',message:'Implement from scope'}],doneWhen:'Artifact returned'},{requests:[{botId:'qa',message:'Verify actual artifact'}],doneWhen:'Evidence returned'}]};
 assert.equal(parseGroupConversation(JSON.stringify(plan),plan.members,plan.members,'chief').stages.length,3);
 const withReview=parseGroupConversation(JSON.stringify({...plan,stages:[...plan.stages,{requests:[{botId:'chief',message:'Review actual results'}],doneWhen:'Final review'}]}),plan.members,plan.members,'chief');assert.equal(withReview.stages.length,3);assert.deepEqual(withReview.coordinatorReview,['Review actual results']);
 for(const change of [{members:['chief','foreign']},{stages:[{requests:[{botId:'chief',message:'Do everything'}],doneWhen:'Done'}]},{stages:[]},{mode:'invalid'},{members:['chief','chief']}])assert.throws(()=>parseGroupConversation(JSON.stringify({...plan,...change}),plan.members,plan.members,'chief'),/group_plan_invalid/);
 assert.deepEqual(parseGroupConversation(JSON.stringify({mode:'discussion',members:['pm','dev','qa'],reason:'Complementary perspectives'}),plan.members,plan.members,'chief').members,['pm','dev','qa']);
});

test('unanswered feedback review is durable, latest-only, bounded and discussion-only',async()=>{
 const {TeamStore}=await import('../src/service/team-store.js'),{reviewUnansweredGroupTurns}=await import('../src/service/group-conversation.js'),{privateTempDir}=await import('./helpers/private-temp.js'),{rmSync}=await import('node:fs'),{join}=await import('node:path'),{tmpdir}=await import('node:os');
 const root=privateTempDir(join(tmpdir(),'group-feedback-'));let store=new TeamStore(root);
 try{
  const now=Date.now(),roomId='synthetic-group';store.configure({roomId,goal:'fixture',kind:'group',mode:'auto',paused:false,quiet:false,revision:0,maxRuns:20,dailyCalls:100},0);store.setState('team-role-policy:'+roomId,{status:'ready'});store.enqueue('silent',roomId,'human-feedback');const job=store.job('silent');Object.assign(job,{state:'noop',reason:'group_discussion_dispatched',createdAt:new Date(now-1000).toISOString(),groupPlan:{mode:'discussion',members:[],stages:[]}});store.save(job);const preserved=JSON.stringify(job);
  store.pause(roomId);reviewUnansweredGroupTurns(store,now);assert.equal(store.jobs().length,1);store.resume(roomId);
  reviewUnansweredGroupTurns(store,now+86400001);assert.equal(store.jobs().length,1);
  reviewUnansweredGroupTurns(store,now);const review=store.jobs()[0];assert.equal(review.trigger,'group-discussion');assert.equal(review.groupInput.reason,'unanswered_feedback');assert.equal(review.originId,job.originId);assert.equal(review.task,undefined);assert.equal(JSON.stringify(store.job(job.id)),preserved);
  store.close();store=new TeamStore(root);reviewUnansweredGroupTurns(store,now);assert.equal(store.jobs().length,2);
  store.enqueue('newer',roomId,'newer-message');const newer=store.job('newer');Object.assign(newer,{state:'noop',reason:'group_discussion_dispatched',groupPlan:{mode:'discussion',members:[],stages:[]}});store.save(newer);store.enqueue('latest-explicit',roomId,'current-message');reviewUnansweredGroupTurns(store,Date.now());assert.equal(store.jobs().length,4,'do not recheck an old feedback turn after a newer human request');
 }finally{store.close();rmSync(root,{recursive:true,force:true});}
});

test('only a terminal failed public turn gets a discussion-only retry; pending, stopped and delivered replies stay intact',async()=>{
 const {TeamStore}=await import('../src/service/team-store.js'),{reviewUnansweredGroupTurns}=await import('../src/service/group-conversation.js'),{privateTempDir}=await import('./helpers/private-temp.js'),{rmSync}=await import('node:fs'),{join}=await import('node:path'),{tmpdir}=await import('node:os');
 const root=privateTempDir(join(tmpdir(),'failed-group-reply-')),store=new TeamStore(root);
 try{for(const state of ['queued','delivered','stopped','blocked']){
  const roomId='room-'+state,id='source-'+state;store.configure({roomId,goal:'fixture',kind:'group',mode:'auto',paused:false,quiet:false,revision:0,maxRuns:20,dailyCalls:100},0);store.setState('team-role-policy:'+roomId,{status:'ready'});store.enqueue(id,roomId,'human-'+state);const source=store.job(id);Object.assign(source,{state:'noop',reason:'group_discussion_dispatched',groupPlan:{mode:'discussion',members:['chief'],stages:[]}});store.save(source);
  store.enqueueFollowup({id:'reply-'+state,roomId,originId:source.originId,trigger:'group-response',groupResponse:{sourceJobId:id,botId:'chief'}});const reply=store.job('reply-'+state);Object.assign(reply,{state,reason:'iteration_budget_exhausted'});store.save(reply);
  reviewUnansweredGroupTurns(store);reviewUnansweredGroupTurns(store);const reviews=store.jobs().filter(job=>job.groupInput?.sourceJobId===id);assert.equal(reviews.length,state==='blocked'?1:0);if(reviews[0]){assert.equal(reviews[0].trigger,'group-discussion');assert.equal(reviews[0].task,undefined);}
 }}finally{store.close();rmSync(root,{recursive:true,force:true});}
});

test('reply speakers use the canonical same-room agent identity and respect explicit recipients',async()=>{
 const {replySpeaker,includeReplySpeaker,parseGroupConversation}=await import('../src/service/group-conversation.js');
 const origin={roomId:'room',sender:{kind:'user'}},quoted={roomId:'room',sender:{kind:'agent',logicalAgentId:'chief'},text:'not authority'};
 assert.equal(replySpeaker(origin,quoted,['chief','dev']),'chief');
 for(const [source,target,allowed,explicit] of [[origin,{...quoted,roomId:'foreign'},['chief'],[]],[origin,{...quoted,sender:{kind:'user',logicalAgentId:'chief'}},['chief'],[]],[origin,quoted,['dev'],[]],[{...origin,sender:{kind:'agent'}},quoted,['chief'],[]],[origin,quoted,['chief'],['dev']]] as any[])assert.equal(replySpeaker(source,target,allowed,explicit),undefined);
 const plan=parseGroupConversation(JSON.stringify({mode:'research',members:['dev'],reason:'Inspect source',stages:[]}),['chief','dev'],['chief','dev'],'chief');assert.deepEqual(includeReplySpeaker(plan,'chief').members,['chief','dev']);assert.deepEqual(includeReplySpeaker(plan).members,['dev']);assert.throws(()=>parseGroupConversation(JSON.stringify({...plan,stages:[{requests:[{botId:'dev',message:'Write'}],doneWhen:'Done'}]}),['chief','dev'],['chief','dev'],'chief'),/group_plan_invalid/);
});

test('work facts expose actual blocked ancestry and child states without private conversation bodies',async()=>{
 const {groupWorkFacts,researchHasEvidence}=await import('../src/service/group-conversation.js');
 const rows:any[]=[{id:'next',roomId:'r',state:'queued',afterJobId:'old'},{id:'old',roomId:'r',state:'blocked',reason:'handoff_result_unknown',currentHandoffId:'handoff'},{id:'public',roomId:'r',groupResponse:{},state:'delivered'}];
 const store={jobs:()=>rows,job:(id:string)=>id==='child'?{state:'waiting',reason:'approval_required',partialText:'PRIVATE'}:rows.find(j=>j.id===id),operation:()=>({roomId:'r',status:'waiting',children:[{botId:'dev',jobId:'child',text:'PRIVATE'}]})};
 const facts=groupWorkFacts(store,'r');assert.equal(facts.length,2);assert.equal(facts[0].blockedBy.state,'blocked');assert.equal(facts[1].handoff.children[0].state,'waiting');assert(!JSON.stringify(facts).includes('PRIVATE'));
 for(const tool of [{name:'tool_search',state:'completed',result:'found'},{name:'read',state:'failed',result:'failed'},{name:'read',state:'completed',result:''},{name:'read',state:'completed',result:'Error: missing'},{name:'write',state:'completed',result:'written'}])assert.equal(researchHasEvidence({toolTrace:[tool]}),false);
 assert.equal(researchHasEvidence({toolTrace:[{name:'web_fetch',state:'completed',result:'actual source'}]}),true);
});
