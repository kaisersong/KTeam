import {parseSkillCommand,skillCommandNeedsList} from '../protocol/skill-command.js';
import {KTeamError,fields,record,text} from '../errors.js';
import type {Upstreams} from '../adapters/upstream.js';
import type {TeamStore} from './team-store.js';
import {sharedRuntime} from '../runtime/native.js';
import {harnessWorkspace} from '../runtime/harness.js';
import {scopedCatalog,skillSnapshot,skillSource,parseSkillPins} from '../runtime/skill-library.js';
import type {SkillScope} from '../runtime/skill-library.js';
import {appPreferences} from './app-preferences.js';
import {profile,parseDisabledSkills} from './bot-profile.js';

export function effectiveDisabledSkills(global:string[],bot:any):string[]{
 return [...new Set([...global,...(profile(bot).disabledSkills??[])])];
}

export class BotCapabilities {
 constructor(private upstream:Upstreams,private store:TeamStore){}

 async validateCommand(roomId:string,message:string){
  const command=parseSkillCommand(message),listing=skillCommandNeedsList(message);if(!command&&!listing)return;
  const kind=this.store.settings(roomId)?.kind;if(kind!=='assistant'&&kind!=='direct')throw new KTeamError('skill_command_private_only',409);
  if(listing)throw new KTeamError('skill_command_choose',409);
  const members=(await this.upstream.membership(roomId)).members as any[],bots=members.filter(member=>member.status==='active'&&member.subject?.kind==='agent');
  if(bots.length!==1)throw new KTeamError('skill_command_private_only',409);
  const view=await this.view(bots[0].subject.logicalAgentId,roomId),skill=view.skills.find((skill:any)=>skill.name===command!.name);
  if(!view.supported)throw new KTeamError('bot_skills_external',409);
  if(!skill||!skill.enabled||skill.sourceError||skill.versionChanged)throw new KTeamError('skill_command_unavailable',409);
 }
 private async bot(botId:string){
  if(!this.store.binding(botId)&&!this.store.state('external-bot:'+botId))throw new KTeamError('bot_not_managed',403);
  const bot=((await this.upstream.listBots()).agents as any[]).find(bot=>bot.id===botId&&!bot.archivedAt);
  if(!bot)throw new KTeamError('agent_not_found',404);
  return bot;
 }

 async scope(botId:string,roomId?:string){
  const selected=roomId??this.store.state<any>('direct-room:'+botId)?.roomId;if(!selected||!this.store.settings(selected))throw new KTeamError('skill_room_denied',403);const snapshot=await this.upstream.membership(selected),members=snapshot.members as any[];
  if((snapshot.room as any)?.status!=='active'||!members.some(member=>member.status==='active'&&member.subject?.kind==='user'&&member.subject.userId==='user.local')||!members.some(member=>member.status==='active'&&member.subject?.kind==='agent'&&member.subject.logicalAgentId===botId))throw new KTeamError('skill_room_denied',403);
  return {scope:{root:this.store.root,botId,roomId:selected} as SkillScope,room:snapshot.room as any};
 }
 async catalog(botId:string,roomId?:string){const bot=await this.bot(botId),selected=await this.scope(botId,roomId),core=await sharedRuntime(),issues:any[]=[],catalog=scopedCatalog(core,harnessWorkspace(profile(bot).workspace),selected.scope,issue=>issues.push(issue));await catalog.reload();if(catalog.list().length>500)throw new KTeamError('skill_catalog_too_large',409);return {...selected,bot,core,catalog,issues};}
 async view(botId:string,roomId?:string):Promise<any>{
  const bot=await this.bot(botId),binding=this.store.binding(botId),supported=binding?.kind==='xiaok-hosted';
  if(!supported)return {ok:true,supported:false,reason:'外接 Agent 使用自己的技能环境，请在原 Agent 中管理。',profileRevision:profile(bot).revision,skills:[]};
  const {scope,room,catalog,issues}=await this.catalog(botId,roomId),pins=parseSkillPins(profile(bot).skillPins).filter(pin=>pin.roomId===scope.roomId),global=new Set(appPreferences(this.store).disabledSkills),local=new Set(profile(bot).disabledSkills??[]),budget={remaining:64*1024*1024};
  return {ok:true,supported:true,roomId:scope.roomId,roomTitle:room.title,roomRevision:room.revision,profileRevision:profile(bot).revision,disabledSkills:[...local],coverage:issues.length?'partial':'ready',unavailable:issues.length,skills:[...catalog.list(),...pins.filter(pin=>!catalog.get(pin.name)).map(pin=>({name:pin.name,description:'固定版本的来源已缺失，恢复来源或取消固定后再执行。',source:'missing'}))].map((skill:any)=>{let version:string|undefined,sourceError:string|undefined;try{version=skillSnapshot(skill,budget).version;}catch(error){sourceError=error instanceof KTeamError?error.code:'skill_source_unavailable';}const pin=pins.find(pin=>pin.name===skill.name);return {name:skill.name,description:skill.description,source:skillSource(skill,scope),path:skill.path,version,sourceError,pinnedVersion:pin?.version,versionChanged:!!pin&&pin.version!==version,enabled:!global.has(skill.name)&&!local.has(skill.name),globallyDisabled:global.has(skill.name)};})};
 }
 async preview(value:unknown){const input=record(value);fields(input,['botId','roomId','name','expectedVersion']);const botId=text(input.botId,'bot_id'),roomId=text(input.roomId,'room_id'),name=text(input.name,'skill_name',256),loaded=await this.catalog(botId,roomId);if(this.store.binding(botId)?.kind!=='xiaok-hosted')throw new KTeamError('bot_skills_external',409);const skill=loaded.catalog.get(name);if(!skill)throw new KTeamError('skill_source_changed',409);const snapshot=skillSnapshot(skill);if(snapshot.version!==input.expectedVersion)throw new KTeamError('skill_source_changed',409);await this.scope(botId,roomId);return {ok:true,name,source:skillSource(skill,loaded.scope),path:skill.path,...snapshot,content:loaded.core.redactSecrets(snapshot.content).text};}
 async pin(value:unknown){
  const input=record(value);fields(input,['botId','roomId','name','expectedRevision','expectedRoomRevision','version','action']);const botId=text(input.botId,'bot_id'),roomId=text(input.roomId,'room_id'),name=text(input.name,'skill_name',256),loaded=await this.catalog(botId,roomId);if(this.store.binding(botId)?.kind!=='xiaok-hosted')throw new KTeamError('bot_skills_external',409);const current=profile(loaded.bot),pins=parseSkillPins(current.skillPins),previous=pins.find(pin=>pin.roomId===roomId&&pin.name===name);if(input.expectedRevision!==current.revision||input.expectedRoomRevision!==loaded.room.revision)throw new KTeamError('bot_profile_changed',409);
  if(input.action==='pin'){const skill=loaded.catalog.get(name);if(!skill||input.version!==skillSnapshot(skill).version)throw new KTeamError('skill_source_changed',409);}else if(input.action!=='unpin'||!previous||input.version!==previous.version)throw new KTeamError('skill_pins_invalid',409);
  const next=pins.filter(pin=>pin!==previous);if(input.action==='pin')next.push({roomId,name,version:String(input.version)});parseSkillPins(next);if((await this.scope(botId,roomId)).room.revision!==loaded.room.revision)throw new KTeamError('skill_room_changed',409);
  const result=await this.upstream.updateBot(botId,{kteamProfile:{...current,skillPins:next,revision:current.revision+1},expectedKteamProfileRevision:current.revision});return {ok:true,botId,profile:profile(result.agent)};
 }

 async save(value:unknown){
  const input=record(value);fields(input,['botId','expectedRevision','disabledSkills']);
  const botId=text(input.botId,'bot_id'),bot=await this.bot(botId);
  if(this.store.binding(botId)?.kind!=='xiaok-hosted')throw new KTeamError('bot_skills_external',409);
  const current=profile(bot),disabledSkills=parseDisabledSkills(input.disabledSkills);parseSkillPins(current.skillPins);
  if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision!==current.revision)throw new KTeamError('bot_profile_changed',409);
  const result=await this.upstream.updateBot(botId,{kteamProfile:{...current,disabledSkills,revision:current.revision+1},expectedKteamProfileRevision:current.revision});
  return {ok:true,botId,profile:profile(result.agent)};
 }
}
