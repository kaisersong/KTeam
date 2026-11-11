import {createHash} from 'node:crypto';
import {KTeamError,fields,record,text} from '../errors.js';
import {Upstreams} from '../adapters/upstream.js';
import {TeamStore} from './team-store.js';
import {CollaborationService} from './collaboration.js';

type SidebarState={revision:number;pinnedAt:string|null;manualUnread:boolean;readThrough:number};
/** Personal presentation state only; rooms and message content remain broker-owned. */
export class ConversationSidebar{
 private pending=new Map<string,Promise<any>>();
 private renamingBots=new Set<string>();
 constructor(private upstream:Upstreams,private store:TeamStore,private pause:(roomId:string)=>Promise<unknown>){}
 state(roomId:string):SidebarState{return {revision:0,pinnedAt:null,manualUnread:false,readThrough:0,...this.store.state<Partial<SidebarState>>('sidebar:'+roomId)};}
 private async scope(roomId:string){
  if(!this.store.settings(roomId)||this.store.settings(roomId)?.kind==='peer')throw new KTeamError('sidebar_conversation_forbidden',403);
  const snapshot=await this.upstream.membership(roomId);
  if(!(snapshot.members as any[]).some(m=>m.status==='active'&&m.role==='owner'&&m.subject?.kind==='user'&&m.subject.userId==='user.local'))throw new KTeamError('sidebar_conversation_forbidden',403);
  return snapshot;
 }
 async preview(roomId:string){
  let before:number|undefined;
  for(let page=0;page<10;page++){
   const result=await new CollaborationService(this.upstream).messages(roomId,0,100,before,true),last=result.messages.at(-1);
   if(last)return {messageId:last.messageId,roomSequence:last.roomSequence,text:String(last.text??'').replace(/\s+/g,' ').slice(0,240),sender:last.sender,createdAt:last.createdAt};
   if(!result.hasMoreBefore||!result.previousSequence||result.previousSequence===before)break;
   before=result.previousSequence;
  }
  return null;
 }
 async decorate(rooms:any[]){const result=new Array<any>(rooms.length);let next=0;await Promise.all(Array.from({length:Math.min(6,rooms.length)},async()=>{for(;;){const index=next++;if(index>=rooms.length)return;const room=rooms[index],state=this.state(room.roomId);if(room.kind==='peer'){result[index]=room;continue;}let lastMessage;try{lastMessage=await this.preview(room.roomId);}catch{lastMessage=undefined;}result[index]={...room,pinnedAt:state.pinnedAt,sidebarRevision:state.revision,manualUnread:state.manualUnread,unread:state.manualUnread||!!lastMessage&&Number(lastMessage.roomSequence)>state.readThrough&&(lastMessage.sender as any)?.kind!=='user',lastMessage};}}));return result;}
 async control(roomId:string,value:unknown){
  const input=record(value);fields(input,['action','pinned','expectedRevision','expectedRoomRevision','requestId','title','throughSequence']);
  const action=input.action??'pin';if(!['pin','read','unread','rename','delete'].includes(String(action)))throw new KTeamError('sidebar_input_invalid');
  fields(input,action==='pin'?['action','pinned','expectedRevision']:action==='read'?['action','expectedRevision','throughSequence']:action==='unread'?['action','expectedRevision']:['action','expectedRevision','expectedRoomRevision','requestId',...(action==='rename'?['title']:[])]);
  if(action==='rename'||action==='delete'){
   const requestId=text(input.requestId,'request_id',200),title=action==='rename'?text(input.title,'title',80).trim():undefined;
   if(title!==undefined&&(!title||/[\r\n\x00-\x1f\x7f]/.test(title)))throw new KTeamError('sidebar_title_invalid');
   if(!Number.isSafeInteger(input.expectedRoomRevision)||Number(input.expectedRoomRevision)<1)throw new KTeamError('sidebar_input_invalid');
   const fingerprint=createHash('sha256').update(JSON.stringify({roomId,action,title,revision:input.expectedRoomRevision})).digest('hex'),key='sidebar-operation:'+requestId;
   const prior=this.store.state<any>(key);if(prior&&prior.fingerprint!==fingerprint)throw new KTeamError('sidebar_request_conflict',409);
   if(prior?.receipt)return prior.receipt;
   if(this.pending.has(roomId))throw new KTeamError('sidebar_busy',409);
   const promise=this.mutate(roomId,input,String(action),title,key,fingerprint,prior).finally(()=>this.pending.delete(roomId));this.pending.set(roomId,promise);return promise;
  }
  await this.scope(roomId);let latest=0;
  if(action==='read'){const last=await this.preview(roomId);latest=Number(last?.roomSequence??0);if(!Number.isSafeInteger(input.throughSequence)||Number(input.throughSequence)<0||Number(input.throughSequence)>latest)throw new KTeamError('sidebar_input_invalid');}
  const prior=this.state(roomId);if(action!=='pin'||input.expectedRevision!==undefined){if(input.expectedRevision!==prior.revision)throw new KTeamError('sidebar_changed',409);}
  if(action==='pin'&&typeof input.pinned!=='boolean')throw new KTeamError('sidebar_input_invalid');
  const next={...prior};if(action==='pin')next.pinnedAt=input.pinned?(prior.pinnedAt??new Date().toISOString()):null;
  if(action==='unread')next.manualUnread=true;
  if(action==='read'){next.manualUnread=false;next.readThrough=Math.max(prior.readThrough,Number(input.throughSequence));}
  if(JSON.stringify(next)!==JSON.stringify(prior)){next.revision++;this.store.setState('sidebar:'+roomId,next);}
  return {ok:true,...next,sidebarRevision:next.revision};
 }
 private async mutate(roomId:string,input:Record<string,unknown>,action:string,title:string|undefined,key:string,fingerprint:string,prior:any){
  // A completed receipt can be returned after deletion; pending intents only reconcile by reading.
  let snapshot:any;
  try{snapshot=await this.scope(roomId);}catch(error){if(action==='delete'&&prior&&error instanceof KTeamError&&error.code==='room_not_found'){
    const result=await this.upstream.deleteTeam(roomId,Number(input.expectedRoomRevision));return this.deleted(roomId,key,fingerprint,result);
   }throw error;}
  const room=snapshot.room;
  if(action==='rename'&&prior&&room.title===title&&room.revision===Number(input.expectedRoomRevision)+1)return this.finishRename(roomId,key,fingerprint,title!);
  if(prior&&!prior.retryable)throw new KTeamError('operation_result_unknown',409);
  if(room.revision!==input.expectedRoomRevision||this.state(roomId).revision!==input.expectedRevision)throw new KTeamError('sidebar_changed',409);
  const frozen=this.store.state<any>('conversation:'+roomId);if(frozen&&frozen.title!==room.title)throw new KTeamError('conversation_identity_changed',409);
  let renameBot:any;
  if(action==='rename'&&this.store.settings(roomId)?.kind==='direct'&&frozen?.members?.length===1){
   const botId=frozen.members[0].botId;
   if(!this.store.binding(botId)&&!this.store.state('external-bot:'+botId))throw new KTeamError('bot_not_managed',403);
   const bots=(await this.upstream.listBots()).agents as any[];
   renameBot=bots.find(bot=>bot.id===botId&&!bot.archivedAt);
   if(bots.some(bot=>bot.id!==botId&&!bot.archivedAt&&bot.name===title))throw new KTeamError('bot_name_exists',409);
   if(!renameBot)throw new KTeamError('agent_not_found',404);
  }
  this.store.setState(key,{fingerprint,roomId,action,...(renameBot?{botId:renameBot.id,oldName:renameBot.name}:{})});
  if(action==='rename'){
   await this.upstream.updateTeam(roomId,{title,description:room.description??'',expectedRoomRevision:room.revision});
   return this.finishRename(roomId,key,fingerprint,title!);
  }
  await this.pause(roomId);
  try{return this.deleted(roomId,key,fingerprint,await this.upstream.deleteTeam(roomId,room.revision));}
  catch(error){if(error instanceof KTeamError&&error.code==='room_delete_pending')this.store.setState(key,{fingerprint,roomId,action,retryable:true});throw error;}
 }
 private async finishRename(roomId:string,key:string,fingerprint:string,title:string){
  const frozen=this.store.state<any>('conversation:'+roomId);if(frozen)this.store.setState('conversation:'+roomId,{...frozen,title});
  const intent=this.store.state<any>(key);
  if(intent?.botId){
   if(this.renamingBots.has(intent.botId))throw new KTeamError('sidebar_busy',409);
   this.renamingBots.add(intent.botId);
   try{
    const bot=((await this.upstream.listBots()).agents as any[]).find(bot=>bot.id===intent.botId&&!bot.archivedAt);
    if(!bot)throw new KTeamError('agent_not_found',404);
    if(bot.name!==title){
     if(intent.botRenameAttempted)throw new KTeamError('operation_result_unknown',409);
     if(bot.name!==intent.oldName)throw new KTeamError('bot_name_changed',409);
     this.store.setState(key,{...intent,botRenameAttempted:true});
     const current=await this.scope(roomId);
     if(!(current.members as any[]).some(member=>member.status==='active'&&member.subject?.logicalAgentId===bot.id))throw new KTeamError('sidebar_conversation_forbidden',403);
     await this.upstream.updateBot(bot.id,{name:title});
    }
   }finally{this.renamingBots.delete(intent.botId);}
  }
  const receipt={ok:true,roomId,title};this.store.setState(key,{fingerprint,receipt});return receipt;
 }
 private deleted(roomId:string,key:string,fingerprint:string,result:any){this.store.setState('deleted-conversation:'+roomId,true);const receipt={...result,ok:true,roomId};this.store.setState(key,{fingerprint,receipt});return receipt;}
}
