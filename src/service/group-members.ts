import {createHash} from 'node:crypto';
import {Upstreams} from '../adapters/upstream.js';
import {TeamStore} from './team-store.js';
import {KTeamError,fields,record,text} from '../errors.js';

/** Broker owns membership. This service only persists mutation intents and receipts. */
export class GroupMembers {
 private pending=new Map<string,{fingerprint:string;promise:Promise<any>}>();
 constructor(private upstream:Upstreams,private store:TeamStore){}
 private async scope(roomId:string){
  if(this.store.settings(roomId)?.kind!=='group')throw new KTeamError('group_required');
  const snapshot=await this.upstream.membership(roomId);
  if((snapshot.room as any).status!=='active'||!(snapshot.members as any[]).some(m=>m.status==='active'&&m.role==='owner'&&m.subject?.kind==='user'&&m.subject.userId==='user.local'))throw new KTeamError('room_actor_forbidden',403);
  return snapshot;
 }
 private ids(snapshot:any):string[]{return snapshot.members.filter((m:any)=>m.status==='active'&&m.subject?.kind==='agent').map((m:any)=>String(m.subject.logicalAgentId)).sort();}
 async view(roomId:string){
  const snapshot=await this.scope(roomId),memberIds=this.ids(snapshot),bots=((await this.upstream.listBots()).agents as any[]).filter(b=>!b.archivedAt&&(this.store.binding(b.id)||this.store.state('external-bot:'+b.id)));
  return {ok:true,roomId,roomRevision:Number((snapshot.room as any).revision),memberIds,candidates:bots.filter(b=>!memberIds.includes(b.id)).map(b=>({id:b.id,name:b.name,model:this.store.binding(b.id)?.model??'原 Agent 会话'}))};
 }
 async control(roomId:string,value:unknown,ctx:{requestSource:string}){
  if(ctx.requestSource!=='user')throw new KTeamError('user_action_required',403);
  const input=record(value);fields(input,['action','botIds','expectedRoomRevision','requestId']);
  const action=input.action;if(!['add','remove'].includes(String(action))||!Array.isArray(input.botIds)||!input.botIds.length||input.botIds.length>32||!Number.isSafeInteger(input.expectedRoomRevision)||Number(input.expectedRoomRevision)<0)throw new KTeamError('group_members_invalid');
  const botIds=input.botIds.map(id=>text(id,'bot_id',160)).sort();if(new Set(botIds).size!==botIds.length)throw new KTeamError('group_members_invalid');
  const requestId=text(input.requestId,'request_id',160),fingerprint=createHash('sha256').update(JSON.stringify({roomId,action,botIds,revision:input.expectedRoomRevision})).digest('hex'),key='group-members:'+requestId;
  const prior=this.store.state<any>(key);if(prior&&prior.fingerprint!==fingerprint)throw new KTeamError('operation_conflict',409);
  const pending=this.pending.get(roomId);if(pending){if(pending.fingerprint!==fingerprint)throw new KTeamError('group_members_busy',409);return pending.promise;}
  const promise=this.mutate(roomId,action as string,botIds,Number(input.expectedRoomRevision),key,fingerprint,prior).finally(()=>this.pending.delete(roomId));this.pending.set(roomId,{fingerprint,promise});return promise;
 }
 private async mutate(roomId:string,action:string,botIds:string[],revision:number,key:string,fingerprint:string,prior:any){
  const snapshot=await this.scope(roomId),ids=this.ids(snapshot),roomRevision=Number((snapshot.room as any).revision);
  if(prior?.receipt)return prior.receipt;
  if(prior){
   // A lost write receipt is reconciled by exact membership + revision, never a second mutation.
   if(roomRevision===revision+1&&JSON.stringify(ids)===JSON.stringify(prior.expectedIds))return this.finish(key,fingerprint,roomId,roomRevision);
   throw new KTeamError('operation_result_unknown',409);
  }
  if(roomRevision!==revision)throw new KTeamError('group_members_changed',409);
  if(action==='add'){
   const available=((await this.upstream.listBots()).agents as any[]).filter(b=>!b.archivedAt&&(this.store.binding(b.id)||this.store.state('external-bot:'+b.id)));
   if(botIds.some(id=>ids.includes(id)||!available.some(b=>b.id===id)))throw new KTeamError('group_member_unavailable',409);
  }else if(botIds.some(id=>!ids.includes(id)))throw new KTeamError('group_members_changed',409);
  const expectedIds=action==='add'?[...ids,...botIds].sort():ids.filter(id=>!botIds.includes(id));
  // Recheck owner and membership after reading the agent directory, before recording the write intent.
  const current=await this.scope(roomId);if(Number((current.room as any).revision)!==revision)throw new KTeamError('group_members_changed',409);
  this.store.setState(key,{fingerprint,roomId,expectedIds});
  try{await this.upstream.updateMembers(roomId,{expectedRoomRevision:revision,...(action==='add'?{addAgentIds:botIds}:{removeAgentIds:botIds})});}
  catch{throw new KTeamError('operation_result_unknown',503);}
  const after=await this.scope(roomId);if(Number((after.room as any).revision)!==revision+1||JSON.stringify(this.ids(after))!==JSON.stringify(expectedIds))throw new KTeamError('operation_result_unknown',409);
  return this.finish(key,fingerprint,roomId,revision+1);
 }
 private finish(key:string,fingerprint:string,roomId:string,roomRevision:number){const receipt={ok:true,roomId,roomRevision};this.store.setState(key,{fingerprint,receipt});return receipt;}
}
