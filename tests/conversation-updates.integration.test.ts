import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {realUpstreams} from './helpers/real-upstreams.js';
import {TeamStore} from '../src/service/team-store.js';
import {TeamCoordinator} from '../src/service/coordination.js';
import {ConversationService} from '../src/service/conversation.js';
import {CollaborationService,LOCAL_HUMAN} from '../src/service/collaboration.js';
import {TeamAutomation} from '../src/service/automation.js';
import {ToolApprovals} from '../src/service/tool-approvals.js';
import {AgentLinks} from '../src/service/agent-links.js';
import {WorkRecovery} from '../src/service/work-recovery.js';
import {TeamRoles} from '../src/service/team-roles.js';
import {ConversationUpdates} from '../src/service/conversation-updates.js';
import {conversationPage,MESSAGE_PAGE_BYTES,projectMessage} from '../src/service/conversation-pages.js';
import {intentHash} from '../src/protocol/aimp.js';
import {KTeamError} from '../src/errors.js';
import {initConfig} from '../src/service/config.js';
import {startHost} from '../src/service/server.js';
import {hostRequest} from '../src/service/client.js';
import {createDesktopAPI,dispatchDesktop} from '../desktop/semantic-api.js';
const models={catalog:async()=>({defaultModelId:'fixture'}),identity:async()=>({model:'fixture-model',fingerprint:'frozen'})};
async function fixture(){
 const f=await realUpstreams(),store=new TeamStore(f.root),coordinator=new TeamCoordinator(f.upstream,store,1,models),conversations=new ConversationService(f.root,f.upstream,store),approvals=new ToolApprovals(store),roles=new TeamRoles(f.upstream,store);let calls=0;
 const automation=new TeamAutomation(f.upstream,store,1,async()=>{calls++;throw Error('read_must_not_execute');},coordinator,undefined,conversations,approvals,undefined,roles),links=new AgentLinks(f.upstream,store,coordinator),recovery=new WorkRecovery(f.upstream,store,coordinator);
 const create=(epoch='fixture-epoch')=>new ConversationUpdates(f.upstream,store,conversations,automation,coordinator,approvals,links,recovery,roles,epoch);
 const member=await coordinator.createMember({name:'Synthetic member',modelId:'fixture',requestId:'cursor-member'},{requestSource:'user'});store.pause(member.roomId);store.setState('assistant-proactivity',{enabled:false});
 return {...f,store,coordinator,conversations,approvals,automation,member,roomId:member.roomId,updates:create(),create,get calls(){return calls;},async send(body:string){const roomId=member.roomId,envelope={aimp:'1.0',id:'msg_'+crypto.randomUUID().replaceAll('-',''),room_id:roomId,thread_id:'thread-'+roomId,from:LOCAL_HUMAN,to:[],mentions:[],ts:new Date().toISOString(),act:'chat',source_level:'principal',body};const membership=await f.upstream.membership(roomId);return f.upstream.sendMessage(roomId,{expectedRoomRevision:membership.room.revision,kind:'text',text:body,threadId:envelope.thread_id,contextScope:{kind:'room_only'},responsePolicy:'none',mentions:[],idempotencyKey:'aimp:'+envelope.id,sourceRef:{kind:'aimp_l0',envelope,intentHash:intentHash(envelope as any)}});},async close(){await automation.close();approvals.close();store.close();await f.close();}};
}

test('owner cursors reconnect, recover dropped and reordered pages, reset after restart and reject another Room',async()=>{
 const f=await fixture();try{
  for(let index=0;index<53;index++)await f.send('synthetic message '+index);
  const first=await f.updates.read({roomId:f.roomId});assert.equal(first.reset,true);assert.equal(first.messages.messages.length,50);assert.equal(first.messages.hasMoreBefore,true);assert.ok(first.work);assert.ok(first.settings);assert.ok(first.shared);
  let compactReads=0;const compact=f.store.workPage.bind(f.store);f.store.workPage=(...args)=>{compactReads++;return compact(...args);};const idle=await f.updates.read({roomId:f.roomId,cursor:first.cursor});assert.equal(compactReads,0);assert.equal(idle.reset,false);assert.equal(idle.previousCursor,first.cursor);assert.equal(idle.messages.messages.length,0);assert.equal(idle.work,undefined);assert.equal(idle.shared,undefined);assert.equal(idle.settings,undefined);assert.ok(Buffer.byteLength(JSON.stringify(idle))<3000);
  await f.send('after reconnect');const dropped=await f.updates.read({roomId:f.roomId,cursor:first.cursor}),replayed=await f.updates.read({roomId:f.roomId,cursor:first.cursor});assert.equal(dropped.messages.messages.length,1);assert.deepEqual(replayed.messages.messages,dropped.messages.messages);assert.notEqual(replayed.previousCursor,dropped.cursor);
  const resumed=await f.create('next-host').read({roomId:f.roomId,cursor:replayed.cursor,resumeAfter:53});assert.equal(resumed.reset,true);assert.equal(resumed.messages.messages.length,1);assert.ok(resumed.work);const ahead=await f.create().read({roomId:f.roomId,resumeAfter:99999});assert.equal(ahead.messages.messages.length,50);
  const other=await f.coordinator.createMember({name:'Other synthetic member',modelId:'fixture',requestId:'cursor-other'},{requestSource:'user'});await assert.rejects(f.updates.read({roomId:other.roomId,cursor:first.cursor}),/conversation_cursor_scope/);await assert.rejects(f.updates.read({roomId:f.roomId,toolPermission:'allow'}),/unknown_field/);await assert.rejects(f.updates.read({roomId:f.roomId,resumeAfter:-1}),/conversation_cursor_invalid/);assert.equal(f.calls,0);assert.equal(f.store.jobs().length,0);
 }finally{await f.close();}
});

test('large Chinese owner messages reduce GET page sizes and remain byte bounded in both directions without loss',async()=>{
 const f=await fixture();try{
  const body='\u5408\u6210\u8d44\u6599'.repeat(7000);for(let index=0;index<35;index++)await f.send(index+':'+body);
  const limits:number[]=[],read=f.upstream.messages.bind(f.upstream);f.upstream.messages=async(...args:any[])=>{limits.push(args[2]);return read(...args);};
  const tail=await conversationPage(f.upstream,f.roomId,{tail:true,limit:50});assert.ok(limits.some(limit=>limit<50));assert.ok(tail.hasMoreBefore);assert.ok(tail.bytes<=MESSAGE_PAGE_BYTES);assert.ok(tail.messages.every((message:any)=>!message.envelope&&!message.sourceRef?.envelope));
  const forward:string[]=[];let after=0;for(let page=0;page<40;page++){const next=await conversationPage(f.upstream,f.roomId,{after,limit:50});assert.ok(next.bytes<=MESSAGE_PAGE_BYTES);for(const message of next.messages){assert.ok(message.roomSequence>after);forward.push(message.messageId);}if(!next.hasMoreAfter)break;assert.ok(next.toSequence>after);after=next.toSequence;}
  const backward:string[]=[];let before:undefined|number;for(let page=0;page<40;page++){const next=await conversationPage(f.upstream,f.roomId,{before,tail:true,limit:50});backward.push(...next.messages.map((message:any)=>message.messageId));if(!next.hasMoreBefore)break;before=next.fromSequence;}
  assert.equal(forward.length,35);assert.equal(new Set(forward).size,35);assert.deepEqual(new Set(forward),new Set(backward));assert.equal((await read(f.roomId,0,1)).totalMessages,35);assert.equal(f.calls,0);
 }finally{await f.close();}
});

test('SQL display pages omit tool bodies, keep original receipts and cover older jobs without parsing the full job forest',async()=>{
 process.env.KTEAM_RUNTIME_ENTRY=resolve('build/shared/kteam-runtime.mjs');const f=await fixture();try{
  const revision=f.store.viewRevision(f.roomId);assert.throws(()=>f.store.transaction(()=>{f.store.enqueue('rolled-back',f.roomId,'origin');throw Error('rollback');}),/rollback/);assert.equal(f.store.viewRevision(f.roomId),revision);assert.equal(f.store.job('rolled-back'),null);
  for(let index=0;index<125;index++){f.store.enqueue('record-'+index,f.roomId,'origin-'+index);const job=f.store.job('record-'+index);job.state='delivered';job.harness={privateStorage:'PRIVATE_HOST_PATH'};job.toolTrace=Array.from({length:30},(_,event)=>({id:'event-'+event,name:'read',state:'completed',input:'TOOL_PARAMETER_SENTINEL'+'.'.repeat(1024),result:'TOOL_RESULT_SENTINEL'+'.'.repeat(2048)}));job.results=[{botId:f.member.bot.id,messageId:'result-'+index}];f.store.save(job);}
  const first=await f.updates.read({roomId:f.roomId}),json=JSON.stringify(first);assert.equal(first.work.jobs.length,20);assert.equal(first.work.jobs[0].toolTrace.length,20);assert.equal(first.work.jobs[0].toolTraceTotal,30);assert.equal(first.work.jobs[0].toolTraceLimited,true);assert.doesNotMatch(json,/TOOL_PARAMETER_SENTINEL|TOOL_RESULT_SENTINEL|PRIVATE_HOST_PATH/);assert.ok(Buffer.byteLength(json)<128*1024);
  const ids:string[]=[];let before:undefined|number;do{const page=await f.updates.records({roomId:f.roomId,before});ids.push(...page.jobs.map((job:any)=>job.id));before=page.nextBefore;}while(before!==undefined);assert.equal(new Set(ids).size,125);
  const detail:any=await f.updates.detail({roomId:f.roomId,messageId:'result-0',eventId:'event-2'});assert.match(detail.event.input,/TOOL_PARAMETER_SENTINEL/);assert.match(detail.event.result,/TOOL_RESULT_SENTINEL/);const raw=await f.updates.detail({roomId:f.roomId,jobId:'record-0'});assert.doesNotMatch(JSON.stringify(raw),/PRIVATE_HOST_PATH/);await assert.rejects(f.updates.detail({roomId:f.roomId,jobId:'record-0',eventId:'missing'}),/work_event_not_recorded/);
  const beforeUpdate=first.work.jobs[0].viewRevision,job=f.store.job('record-124');job.reason='changed owner';f.store.save(job);const next=await f.updates.read({roomId:f.roomId,cursor:first.cursor});assert.ok(next.work.jobs[0].viewRevision>beforeUpdate);assert.equal(next.work.jobs[0].reason,'changed owner');assert.equal(f.calls,0);
 }finally{await f.close();}
});

test('failed sections do not advance their watermarks and source revocation during a read returns no projection',async()=>{
 const f=await fixture();try{
  const first=await f.updates.read({roomId:f.roomId}),aimp=f.upstream.aimp.bind(f.upstream),conversation=f.upstream.conversationData.bind(f.upstream);
  f.upstream.aimp=async()=>{throw new KTeamError('broker_unavailable',503);};f.upstream.conversationData=async()=>{throw new KTeamError('broker_unavailable',503);};f.store.enqueue('changed-during-outage',f.roomId,'origin');const failed=await f.updates.read({roomId:f.roomId,cursor:first.cursor,force:true});assert.equal(failed.work,undefined);assert.equal(failed.shared,undefined);assert.deepEqual(failed.errors.map((error:any)=>error.section),['work','shared']);f.upstream.aimp=aimp;f.upstream.conversationData=conversation;const recovered=await f.updates.read({roomId:f.roomId,cursor:failed.cursor});assert.equal(recovered.work.jobs[0].id,'changed-during-outage');assert.equal(f.calls,0);
  const membership=f.upstream.membership.bind(f.upstream);let reads=0;f.upstream.membership=async(roomId:string)=>{const value=await membership(roomId);if(++reads>=2)return {...value,members:value.members.filter((member:any)=>member.subject?.kind!=='user')};return value;};await assert.rejects(f.updates.read({roomId:f.roomId,cursor:recovered.cursor}),/team_scope_changed/);f.upstream.membership=membership;
 }finally{await f.close();}
});

test('the authenticated host semantic reads reject companion and unknown fields and cannot submit another execution',async()=>{
 const f=await fixture();let host:Awaited<ReturnType<typeof startHost>>|undefined;try{
  initConfig(f.root,{version:1,brokerUrl:f.upstream.options.brokerUrl,kswarmUrl:f.upstream.options.kswarmUrl});host=await startHost({root:f.root,upstream:f.upstream.options});const api=createDesktopAPI((route,value)=>hostRequest(f.root,'kteam-main',route,value));
  const first=await dispatchDesktop(api,'conversationUpdates',[{roomId:f.roomId}]) as any;assert.equal(first.roomId,f.roomId);assert.equal((await api.conversationHistory({roomId:f.roomId})).messages.length,0);assert.equal((await api.workRecords({roomId:f.roomId})).jobs.length,0);
  for(const name of ['updates','history','records','detail'])await assert.rejects(hostRequest(f.root,'kteam-companion','/v1/conversation-view/'+name,{roomId:f.roomId}),/conversation_view_forbidden/);
  await assert.rejects(api.conversationUpdates({roomId:f.roomId,requestSource:'user'}),/unknown_field/);await assert.rejects(api.workRecord({roomId:f.roomId,jobId:'absent'}),/work_record_not_found/);assert.equal(f.calls,0);assert.equal(f.store.jobs().length,0);
 }finally{await host?.close();await f.close();}
});


test('bounded message projections retain original reply and source semantics without carrying the envelope twice',()=>{
 const reply=projectMessage({messageId:'reply',roomId:'room',sender:{kind:'agent'},text:'answer',roomSequence:3,sourceRef:{kind:'aimp_reply',taskRef:'original-task'}});assert.equal(reply.workRef,'original-task');assert.equal(reply.protocol,'legacy_display_only');assert.equal('envelope' in reply,false);
 const external=projectMessage({messageId:'external',roomId:'room',sender:{kind:'agent'},roomSequence:4,text:'answer',sourceRef:{kind:'external_agent_reply',driver:'fixture-cli'}});assert.equal(external.externalSource?.driver,'fixture-cli');assert.equal(external.externalSource?.verifiedExecution,false);
 const privateMessage=projectMessage({messageId:'private',roomId:'room',sender:{kind:'agent'},text:'answer',roomSequence:5,sourceRef:{kind:'bot_private_message',originRoomId:'source',originMessageId:'original',purpose:'question'}});assert.equal(privateMessage.sourceRef?.originMessageId,'original');assert.equal(privateMessage.sourceRef?.verifiedExecution,false);
});
