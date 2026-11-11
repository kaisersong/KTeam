import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {realUpstreams} from './helpers/real-upstreams.js';
import {TeamStore} from '../src/service/team-store.js';
import {TeamCoordinator} from '../src/service/coordination.js';
import {ConversationSidebar} from '../src/service/sidebar.js';
import {CollaborationService,LOCAL_HUMAN} from '../src/service/collaboration.js';
import {initConfig} from '../src/service/config.js';
import {startHost} from '../src/service/server.js';
import {hostRequest} from '../src/service/client.js';
const user={requestSource:'user'},models={catalog:async()=>({defaultModelId:'fixture'}),identity:async()=>({model:'fixture-model',fingerprint:'frozen'})};

test('real room sidebar: latest message, durable unread, scoped rename/delete, receipts and host authorization',async()=>{
 const f=await realUpstreams();let store=new TeamStore(f.root),coordinator=new TeamCoordinator(f.upstream,store,1,models),sidebar=new ConversationSidebar(f.upstream,store,async(id)=>store.pause(id));let host:Awaited<ReturnType<typeof startHost>>|undefined;
 try{
  const bot=await coordinator.createMember({name:'产品经理',modelId:'fixture',requestId:randomUUID()},user),direct=bot.roomId;
  const group=(await coordinator.createGroup({title:'项目群',memberAgentIds:[bot.bot.id],requestId:randomUUID()},user)).room.roomId;
  const collab=new CollaborationService(f.upstream);
  for(const [id,body] of [[direct,'第一条'],[direct,'最后一条\n完整预览'],[group,'群最后一条']])await collab.send({aimp:'1.0',id:'msg_'+randomUUID().replaceAll('-',''),room_id:id,thread_id:'thread-'+id,from:LOCAL_HUMAN,to:[],mentions:[],ts:new Date().toISOString(),act:'chat',source_level:'principal',body});
  assert.equal((await sidebar.preview(direct))!.text,'最后一条 完整预览');assert.equal((await sidebar.preview(group))!.text,'群最后一条');
  const unread=await sidebar.control(direct,{action:'unread',expectedRevision:0});assert.equal(unread.manualUnread,true);
  await assert.rejects(sidebar.control(direct,{action:'read',expectedRevision:0,throughSequence:2}),/sidebar_changed/);
  await assert.rejects(sidebar.control(direct,{pinned:true,title:'forged'}),/unknown_field/);
  store.close();store=new TeamStore(f.root);coordinator=new TeamCoordinator(f.upstream,store,2,models);sidebar=new ConversationSidebar(f.upstream,store,async(id)=>store.pause(id));
  assert.equal(sidebar.state(direct).manualUnread,true);const last=(await sidebar.preview(direct))!;
  await sidebar.control(direct,{action:'read',expectedRevision:unread.revision,throughSequence:last.roomSequence});assert.equal(sidebar.state(direct).manualUnread,false);
  for(const id of [direct,group]){
   const snapshot=await f.upstream.membership(id),input={action:'rename',title:id===direct?'新名称':'新群名称',expectedRevision:sidebar.state(id).revision,expectedRoomRevision:snapshot.room.revision,requestId:randomUUID()};
   await sidebar.control(id,input);assert.equal((await f.upstream.membership(id)).room.title,input.title);assert.deepEqual(await sidebar.control(id,input),{ok:true,roomId:id,title:input.title});
   await assert.rejects(sidebar.control(id,{...input,title:'conflict'}),/sidebar_request_conflict/);
  }
  await coordinator.guardConversation(direct);
  const snapshot=await f.upstream.membership(direct),requestId=randomUUID(),deleteInput={action:'delete',expectedRevision:sidebar.state(direct).revision,expectedRoomRevision:snapshot.room.revision,requestId};
  await assert.rejects(sidebar.control(direct,{...deleteInput,expectedRoomRevision:1,requestId:randomUUID()}),/sidebar_changed/);
  await sidebar.control(direct,deleteInput);assert.equal((await f.upstream.listTeams()).rooms.some((r:any)=>r.roomId===direct),false);assert.equal((await sidebar.control(direct,deleteInput)).ok,true);
  assert.ok((await f.upstream.listBots()).agents.some((b:any)=>b.id===bot.bot.id));const restored=await coordinator.direct(bot.bot.id,user);assert.notEqual(restored.roomId,direct);await coordinator.guardConversation(restored.roomId);
  store.close();initConfig(f.root,{version:1,brokerUrl:f.upstream.options.brokerUrl,kswarmUrl:f.upstream.options.kswarmUrl});host=await startHost({root:f.root,upstream:f.upstream.options});
  const listed:any=await hostRequest(f.root,'kteam-main','/v1/teams');assert.equal(listed.rooms.find((r:any)=>r.roomId===group).lastMessage.text,'群最后一条');
  await assert.rejects(hostRequest(f.root,'kteam-companion',`/v1/teams/${group}/sidebar`,{action:'delete'}),/sidebar_conversation_forbidden/);
  await assert.rejects(hostRequest(f.root,'kteam-main',`/v1/teams/${group}/sidebar`,{action:'unread',expectedRevision:999}),/sidebar_changed/);
 }finally{await host?.close();try{store.close();}catch{}await f.close();}
});

test('unknown rename result recovers by authoritative read without repeating the write',async()=>{
 const f=await realUpstreams(),store=new TeamStore(f.root),coordinator=new TeamCoordinator(f.upstream,store,1,models),sidebar=new ConversationSidebar(f.upstream,store,async()=>{});
 try{
  const b=await coordinator.createMember({name:'PM',modelId:'fixture',requestId:randomUUID()},user),snapshot=await f.upstream.membership(b.roomId),input={action:'rename',title:'恢复的名称',expectedRevision:0,expectedRoomRevision:snapshot.room.revision,requestId:randomUUID()};
  const update=f.upstream.updateTeam.bind(f.upstream);let calls=0;f.upstream.updateTeam=async(...args:any[])=>{calls++;await update(...args);throw Error('lost-response');};
  await assert.rejects(sidebar.control(b.roomId,input),/lost-response/);assert.equal((await new ConversationSidebar(f.upstream,store,async()=>{}).control(b.roomId,input)).title,input.title);assert.equal(calls,1);await coordinator.guardConversation(b.roomId);
 }finally{store.close();await f.close();}
});
