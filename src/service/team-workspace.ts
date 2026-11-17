import {isAbsolute} from 'node:path';
import {realpathSync,statSync} from 'node:fs';
import {KTeamError,record,fields,text} from '../errors.js';
import type {Upstreams} from '../adapters/upstream.js';
import type {TeamStore} from './team-store.js';
import {profile,saveBotProfile} from './bot-profile.js';
import {ToolPermissions} from './tool-permissions.js';

/** Desired team configuration plus read projections of owner-held profiles, grants and jobs. */
export class TeamWorkspace {
 constructor(private upstream:Upstreams,private store:TeamStore){}
 private async scope(roomId:string){
  const settings=this.store.settings(roomId),snapshot=await this.upstream.membership(roomId);
  if(settings?.kind!=='group'||(snapshot.room as any)?.status!=='active'||!(snapshot.members as any[]).some(m=>m.status==='active'&&m.role==='owner'&&m.subject?.userId==='user.local'))throw new KTeamError('room_actor_forbidden',403);
  const ids=new Set((snapshot.members as any[]).filter(m=>m.status==='active').map(m=>m.subject?.logicalAgentId));
  return {settings,bots:((await this.upstream.listBots()).agents as any[]).filter(b=>ids.has(b.id)&&!b.archivedAt)};
 }
 async view(roomId:string){const {bots}=await this.scope(roomId),desired=this.store.state<any>('team-workspace:'+roomId)??{revision:0,path:''},grants=new ToolPermissions(this.store).list();
  return {ok:true,roomId,...desired,members:bots.map(bot=>({botId:bot.id,name:bot.name,workspace:profile(bot).workspace,synced:!!desired.path&&profile(bot).workspace===desired.path,profileRevision:profile(bot).revision,permissions:grants.filter(g=>g.botId===bot.id).map(g=>({id:g.id,kind:g.kind??'tool',directory:g.directory??g.cwd,operations:g.operations??g.toolName}))})),affectedJobs:this.store.jobs(roomId).filter(j=>['queued','routing','running','waiting','held','unknown'].includes(j.state)).map(j=>({id:j.id,state:j.state,requiresReview:true,reason:'工作目录变更后须核对已有结果与执行计划'}))};
 }
 async save(roomId:string,value:unknown){
  const input=record(value);fields(input,['path','expectedRevision']);const current=await this.scope(roomId),previous=this.store.state<any>('team-workspace:'+roomId)??{revision:0};
  if(input.expectedRevision!==previous.revision)throw new KTeamError('team_workspace_changed',409);
  let path=text(input.path,'workspace',4096);try{if(!isAbsolute(path)||!statSync(path).isDirectory())throw Error();path=realpathSync(path);}catch{throw new KTeamError('bot_workspace_invalid',409);}
  // Fence all old work before changing any profile. This does not approve new paths.
  this.store.transaction(()=>{this.store.configure({...current.settings},current.settings.revision);this.store.setState('team-workspace:'+roomId,{revision:previous.revision+1,path,updatedAt:new Date().toISOString()});for(const op of this.store.operationsWithPrefix('tool-approval:').filter(op=>op.status==='pending'&&(op.roomId===roomId||op.displayRoomId===roomId)))this.store.saveOperation({...op,status:'cancelled',reason:'workspace_changed',cancelledAt:Date.now()},op.revision);});
  const failures=[];
  for(const bot of current.bots){try{await this.scope(roomId);if(this.store.state<any>('team-workspace:'+roomId)?.revision!==previous.revision+1)throw new KTeamError('team_workspace_changed',409);const p=profile(bot);if(p.workspace!==path)await saveBotProfile(this.upstream,this.store,{botId:bot.id,expectedRevision:p.revision,description:bot.description??'',instructions:bot.instructions??'',participation:p.participation,workspace:path,followup:p.followup});}catch(error){failures.push({botId:bot.id,code:error instanceof KTeamError?error.code:'member_sync_failed'});}}
  return {...await this.view(roomId),failures,notice:'目录配置不会自动授予权限；旧工作须核对计划和已有结果后恢复。成员目录会影响该成员参加的其他会话。'};
 }
}
