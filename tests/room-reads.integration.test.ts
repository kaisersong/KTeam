import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {realUpstreams} from './helpers/real-upstreams.js';
import {TeamStore} from '../src/service/team-store.js';
import {TeamCoordinator} from '../src/service/coordination.js';
import {TeamAutomation} from '../src/service/automation.js';
import {CollaborationService,LOCAL_HUMAN} from '../src/service/collaboration.js';
import {KTeamError} from '../src/errors.js';
import {findOwnerMessage,recentContext,originalSequences} from '../src/service/room-reads.js';
const user={sessionId:'bounded-history-fixture',requestSource:'user',actor:{kind:'user',userId:'user.local'},issuedAt:new Date().toISOString()};
const models={catalog:async()=>({defaultModelId:'fixture'}),identity:async()=>({model:'fixture-model',fingerprint:'frozen'})};
async function fixture(){
 process.env.KTEAM_RUNTIME_ENTRY=resolve('build/shared/kteam-runtime.mjs');const f=await realUpstreams(),store=new TeamStore(f.root),coordinator=new TeamCoordinator(f.upstream,store,1,models),collaboration=new CollaborationService(f.upstream),member=await coordinator.createMember({name:'Synthetic long-room member',modelId:'fixture',requestId:'long-room-member'},{requestSource:'user'}),roomId=member.roomId;
 const envelope=(body:string,reply?:string)=>({aimp:'1.0',id:'msg_'+crypto.randomUUID().replaceAll('-',''),room_id:roomId,thread_id:'thread-'+roomId,from:LOCAL_HUMAN,to:[],mentions:[],ts:new Date().toISOString(),act:'chat',source_level:'principal',body,...(reply?{reply_to:reply}:{})});
 const origin=await collaboration.send(envelope('ORIGINAL_REQUEST_KEEP_COMPLETE '+'.'.repeat(7000))) as {messageId:string;envelope:ReturnType<typeof envelope>};
 const fill=(count:number)=>{const messages:any[]=[];for(let index=0;index<count;index++){const result=f.broker.room.sendRoomMessage({roomId,kind:'text',text:'synthetic '+index+':'+('\u5408\u6210'.repeat(12000)),threadId:'thread-'+roomId,responsePolicy:'none',contextScope:{kind:'room_only'},idempotencyKey:'fixture-history-'+index},user);assert.equal(result.ok,true);messages.push(result.message);}return messages;};
 return {...f,store,coordinator,collaboration,member,roomId,envelope,origin,fill,async close(){store.close();await f.close();}};
}

test('a Room larger than the legacy response ceiling can send, quote old original IDs and admit the complete original request outside its bounded prompt window',async()=>{
 const f=await fixture();let automation:TeamAutomation|undefined;try{
  const history=f.fill(40);await assert.rejects(f.upstream.getTeam(f.roomId),/upstream_response_too_large/);
  const context=await recentContext(f.upstream,f.roomId);assert.ok(context.limited);assert.ok(context.bytes<=192*1024);assert.equal(context.messages.at(-1).messageId,history.at(-1).messageId);assert.ok(!context.messages.some(message=>message.messageId===f.origin.messageId));
  const quote=await f.collaboration.send(f.envelope('quote old envelope',f.origin.envelope.id)),quoteById=await f.collaboration.send(f.envelope('quote original ID',f.origin.messageId));assert.ok(quote.messageId);assert.ok(quoteById.messageId);assert.equal((await f.upstream.conversationMessage(f.roomId,quote.messageId)).message.replyToMessageId,f.origin.messageId);
  assert.deepEqual(await originalSequences(f.upstream,f.roomId,[1,history.at(-1).roomSequence,999999]),[1,history.at(-1).roomSequence]);
  let calls=0;automation=new TeamAutomation(f.upstream,f.store,1,async input=>{calls++;await input.onRequest?.();const prompt=JSON.parse(input.prompt);assert.equal(prompt.currentMessage,'ORIGINAL_REQUEST_KEEP_COMPLETE '+'.'.repeat(7000));assert.equal(prompt.historyCoverage.limited,true);assert.ok(prompt.historyCoverage.bytes<=192*1024);assert.ok(Buffer.byteLength(JSON.stringify(prompt.history))<=192*1024);return {text:'Synthetic original request completed.',model:'fixture-model',fingerprint:'frozen',usage:{inputTokens:1,outputTokens:1}};},f.coordinator);
  f.store.enqueue('old-original-work',f.roomId,f.origin.messageId);await automation.tick();assert.equal(calls,1);assert.equal(f.store.job('old-original-work').state,'delivered');assert.equal((await f.upstream.aimp(f.roomId,'tasks')).tasks.length,1);
 }finally{await automation?.close();await f.close();}
});

test('lost send receipts reconcile through original bounded pages past the context window and never resend',async()=>{
 const f=await fixture();let automation:TeamAutomation|undefined;try{
  f.store.pause(f.roomId);const write=f.upstream.sendMessage.bind(f.upstream);let writes=0;
  f.upstream.sendMessage=async(...args:any[])=>{writes++;await write(...args);throw new KTeamError('upstream_operation_unknown',503);};
  const intent=f.envelope('ORIGINAL_SEND_RECEIPT');await assert.rejects(f.collaboration.send(intent,envelope=>f.store.prepareSubmission(envelope.id,f.roomId,JSON.stringify(envelope),envelope)),/upstream_operation_unknown/);
  // The receipt hash must be the actual original L0 hash, not a test-owned replacement.
  const message=await findOwnerMessage(f.upstream,f.roomId,message=>message.sourceRef?.envelope?.id===intent.id);const pending=f.store.submission(intent.id);assert.ok(pending);const stored=f.store.submissionEnvelope(intent.id);assert.equal(stored.id,intent.id);
  // Create the same original outbox using its actual hash in a fresh second operation.
  const {intentHash}=await import('../src/protocol/aimp.js');const second=f.envelope('ORIGINAL_HASHED_RECEIPT');await assert.rejects(f.collaboration.send(second,envelope=>f.store.prepareSubmission(envelope.id,f.roomId,intentHash(envelope),envelope)),/upstream_operation_unknown/);
  f.fill(40);assert.ok(!(await recentContext(f.upstream,f.roomId)).messages.some(value=>value.messageId===message.messageId));f.upstream.sendMessage=async(...args:any[])=>{writes++;return write(...args);};
  automation=new TeamAutomation(f.upstream,f.store,1,async()=>{throw Error('read_must_not_infer');},f.coordinator);await automation.reconcileSubmissions(f.roomId);await automation.reconcileSubmissions(f.roomId);assert.equal(writes,2);assert.equal(f.store.submission(second.id)?.state,'sent');assert.equal(f.store.jobs().length,1);assert.equal(f.store.jobs()[0].state,'held');assert.equal(f.store.submission(intent.id)?.state,'pending');
 }finally{await automation?.close();await f.close();}
});

test('a bounded receipt search cannot report absence when the original history budget is exhausted',async()=>{
 const f=await fixture();try{f.fill(210);await assert.rejects(findOwnerMessage(f.upstream,f.roomId,message=>message.messageId==='not-a-real-message'),/conversation_history_limit/);assert.equal(f.store.jobs().length,0);assert.equal((await f.upstream.messages(f.roomId,0,1)).totalMessages,211);}finally{await f.close();}
});
