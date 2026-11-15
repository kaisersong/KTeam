import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {realUpstreams} from './helpers/real-upstreams.js';
import {TeamStore} from '../src/service/team-store.js';
import {TeamCoordinator} from '../src/service/coordination.js';
import {GroupMembers} from '../src/service/group-members.js';
import {KTeamError} from '../src/errors.js';
const user={requestSource:'user'};
async function fixture(){
 const upstreams=await realUpstreams(),store=new TeamStore(upstreams.root);
 const coordinator=new TeamCoordinator(upstreams.upstream,store,1,{catalog:async()=>({defaultModelId:'fixture'}),identity:async()=>({model:'fixture',fingerprint:'fixture'})});
 const a=await coordinator.createMember({name:'CTO',modelId:'fixture',requestId:'a'},user),b=await coordinator.createMember({name:'PM',modelId:'fixture',requestId:'b'},user),c=await coordinator.createMember({name:'开发',modelId:'fixture',requestId:'c'},user);
 const group=await coordinator.createGroup({title:'成员管理测试',memberAgentIds:[a.bot.id],requestId:'group'},user);
 return {...upstreams,store,coordinator,a:a.bot.id,b:b.bot.id,c:c.bot.id,roomId:group.room.roomId,service:new GroupMembers(upstreams.upstream,store),close:async()=>{store.close();await upstreams.close();}};
}
test('real broker adds and removes group members, preserves Bots and other conversations, and deduplicates receipts',async()=>{
 const f=await fixture();try{
  const view=await f.service.view(f.roomId);assert.deepEqual(view.memberIds,[f.a]);assert(view.candidates.some((b:any)=>b.id===f.b));assert(!view.candidates.some((b:any)=>b.id===f.a));
  const input={action:'add',botIds:[f.b,f.c],expectedRoomRevision:view.roomRevision,requestId:'add'};
  const [first,duplicate]=await Promise.all([f.service.control(f.roomId,input,user),f.service.control(f.roomId,input,user)]);assert.deepEqual(duplicate,first);assert.deepEqual(await f.service.control(f.roomId,input,user),first);
  let state=await f.service.view(f.roomId);assert.deepEqual(state.memberIds,[f.a,f.b,f.c].sort());assert.equal(state.roomRevision,view.roomRevision+1);
  await assert.rejects(f.service.control(f.roomId,{...input,botIds:[f.a]},user),/operation_conflict/);
  await assert.rejects(f.service.control(f.roomId,{action:'remove',botIds:[f.a],expectedRoomRevision:view.roomRevision,requestId:'stale'},user),/group_members_changed/);
  const oldDirect=f.store.state<any>('direct-room:'+f.a).roomId;
  const removed=await f.service.control(f.roomId,{action:'remove',botIds:[f.a],expectedRoomRevision:state.roomRevision,requestId:'remove'},user);state=await f.service.view(f.roomId);assert.deepEqual(state.memberIds,[f.b,f.c].sort());assert.equal(state.roomRevision,removed.roomRevision);
  assert((await f.upstream.listBots()).agents.some((b:any)=>b.id===f.a&&!b.archivedAt));assert((await f.upstream.membership(oldDirect)).members.some((m:any)=>m.status==='active'&&m.subject.logicalAgentId===f.a));
  await f.service.control(f.roomId,{action:'add',botIds:[f.a],expectedRoomRevision:state.roomRevision,requestId:'rejoin'},user);assert((await f.service.view(f.roomId)).memberIds.includes(f.a));assert.equal(f.store.jobs(f.roomId).length,0);
 }finally{await f.close();}
});
test('only an active user owner may change a managed group; invalid IDs and duplicate selection never mutate membership',async()=>{
 const f=await fixture();try{
  const view=await f.service.view(f.roomId),input={action:'add',botIds:[f.b],expectedRoomRevision:view.roomRevision,requestId:'denied'};
  await assert.rejects(f.service.control(f.roomId,input,{requestSource:'agent'}),/user_action_required/);
  await assert.rejects(f.service.control(f.roomId,{...input,botIds:[f.b,f.b]},user),/group_members_invalid/);
  await assert.rejects(f.service.control(f.roomId,{...input,botIds:['not-managed']},user),/group_member_unavailable/);
  await assert.rejects(f.service.control(f.roomId,{...input,addUserIds:['other']},user),/unknown_field/);
  const direct=f.store.state<any>('direct-room:'+f.a).roomId;await assert.rejects(f.service.control(direct,input,user),/group_required/);
  assert.equal((await f.service.view(f.roomId)).roomRevision,view.roomRevision);
  await f.upstream.updateMembers(f.roomId,{addUserIds:['other']});await f.upstream.updateMembers(f.roomId,{roleChanges:[{userId:'other',role:'owner'}]});await f.upstream.updateMembers(f.roomId,{roleChanges:[{userId:'user.local',role:'member'}]});
  await assert.rejects(f.service.view(f.roomId),/room_actor_forbidden/);await assert.rejects(f.service.control(f.roomId,{...input,requestId:'no-owner'},user),/room_actor_forbidden/);
 }finally{await f.close();}
});
test('lost member-change receipts reconcile across restart without replay, and an unconfirmed write stays read-only',async()=>{
 const f=await fixture();try{
  let state=await f.service.view(f.roomId);const original=f.upstream.updateMembers.bind(f.upstream);let writes=0;f.upstream.updateMembers=async(...args:any[])=>{writes++;await original(args[0],args[1]);throw new KTeamError('upstream_operation_unknown',503);};
  const input={action:'add',botIds:[f.b],expectedRoomRevision:state.roomRevision,requestId:'lost'};await assert.rejects(f.service.control(f.roomId,input,user),/operation_result_unknown/);
  const restored=new GroupMembers(f.upstream,f.store);await restored.control(f.roomId,input,user);assert.equal(writes,1);assert((await restored.view(f.roomId)).memberIds.includes(f.b));
  f.upstream.updateMembers=async()=>{writes++;throw new KTeamError('upstream_operation_unknown',503);};state=await restored.view(f.roomId);const failed={action:'add',botIds:[f.c],expectedRoomRevision:state.roomRevision,requestId:'not-sent'};
  await assert.rejects(restored.control(f.roomId,failed,user),/operation_result_unknown/);await assert.rejects(new GroupMembers(f.upstream,f.store).control(f.roomId,failed,user),/operation_result_unknown/);assert.equal(writes,2);assert(!(await restored.view(f.roomId)).memberIds.includes(f.c));
 }finally{await f.close();}
});
