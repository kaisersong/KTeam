import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {realUpstreams} from './helpers/real-upstreams.js';
import {TeamStore} from '../src/service/team-store.js';
import {TeamCoordinator} from '../src/service/coordination.js';
import {CollaborationService,LOCAL_HUMAN} from '../src/service/collaboration.js';
import {previewMessageReference} from '../src/service/message-references.js';
import {conversationWork} from '../src/protocol/conversation-work.js';

test('conversation header shows each active job once and prioritizes its existing approval',()=>{
 const rows=conversationWork('one',[
  {id:'running',roomId:'one',state:'running',toolTrace:[{name:'read',state:'completed'}]},
  {id:'waiting',roomId:'one',state:'waiting'},
  {id:'done',roomId:'one',state:'delivered'},
  {id:'other',roomId:'two',state:'running'},
 ],[{id:'approval',roomId:'peer',rootJobId:'waiting'}]);
 assert.deepEqual(rows.map(row=>[row.job.id,row.attention?.id,row.progress]),[['waiting','approval',undefined],['running',undefined,'read']]);
});

test('an original message is checked across real rooms at preview and send, preserving idempotency',async()=>{
 const fixture=await realUpstreams();
 const root=join(fixture.root,'host');mkdirSync(root,{mode:0o700});
 const store=new TeamStore(root);
 try{
  const coordinator=new TeamCoordinator(fixture.upstream,store,1,{
   catalog:async()=>({defaultModelId:'fixture'}),identity:async()=>({model:'fixture',fingerprint:'fixture'}),
  });
  const user={requestSource:'user'};
  const member=await coordinator.createMember({name:'Synthetic member',modelId:'fixture',requestId:'member'},user);
  const group=(title:string)=>coordinator.createGroup({title,goal:'Synthetic verification',memberAgentIds:[member.bot.id],requestId:title.toLowerCase().replace(' ','-')},user);
  const source=(await group('Source room')).room.roomId,target=(await group('Target room')).room.roomId;
  const collaboration=new CollaborationService(fixture.upstream);
  const envelope=(roomId:string,letter:string,body:string)=>({
   aimp:'1.0',id:'msg_'+letter.repeat(32),room_id:roomId,thread_id:'thread-'+roomId,from:LOCAL_HUMAN,to:[],mentions:[],
   ts:new Date().toISOString(),act:'chat',source_level:'principal',classification:'internal',body,
  });
  const sent=await collaboration.send(envelope(source,'a','Original evidence'));
  const input={roomId:target,sourceRoomId:source,messageId:sent.messageId};
  const {reference}=await previewMessageReference(fixture.upstream,input);
  assert.equal(reference.text,'Original evidence');
  await assert.rejects(previewMessageReference(fixture.upstream,{...input,sourceRoomId:target}));
  await assert.rejects(collaboration.send(envelope(target,'b',reference.quote.replace('Original','Changed'))),/message_reference_changed/);
  const prepared=envelope(target,'c','Review this result\n\n'+reference.quote);
  const result=await collaboration.send(prepared);
  assert.equal((await collaboration.send(prepared)).messageId,result.messageId);
  const actual=(await fixture.upstream.conversationMessage(target,result.messageId)).message as any;
  assert.equal(actual.text,prepared.body);
 }finally{store.close();await fixture.close();}
});
