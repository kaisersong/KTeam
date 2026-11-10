import {homedir} from 'node:os';
import {KTeamError,fields,record,text} from '../errors.js';
import type {Upstreams} from '../adapters/upstream.js';
import type {TeamStore} from './team-store.js';
import {appResources} from './app-settings.js';
import {appPreferences} from './app-preferences.js';
import {profile,parseDisabledSkills} from './bot-profile.js';

export function effectiveDisabledSkills(global:string[],bot:any):string[]{
 return [...new Set([...global,...(profile(bot).disabledSkills??[])])];
}

export class BotCapabilities {
 constructor(private upstream:Upstreams,private store:TeamStore){}

 private async bot(botId:string){
  if(!this.store.binding(botId)&&!this.store.state('external-bot:'+botId))throw new KTeamError('bot_not_managed',403);
  const bot=((await this.upstream.listBots()).agents as any[]).find(bot=>bot.id===botId&&!bot.archivedAt);
  if(!bot)throw new KTeamError('agent_not_found',404);
  return bot;
 }

 async view(botId:string){
  const bot=await this.bot(botId),binding=this.store.binding(botId),supported=binding?.kind==='xiaok-hosted';
  if(!supported)return {ok:true,supported:false,reason:'外接 Agent 使用自己的技能环境，请在原 Agent 中管理。',profileRevision:profile(bot).revision,skills:[]};
  const resources=await appResources(profile(bot).workspace||homedir());
  const global=new Set(appPreferences(this.store).disabledSkills),local=new Set(profile(bot).disabledSkills??[]);
  return {ok:true,supported:true,profileRevision:profile(bot).revision,disabledSkills:[...local],skills:resources.skills.map((skill:any)=>({...skill,enabled:!global.has(skill.name)&&!local.has(skill.name),globallyDisabled:global.has(skill.name)}))};
 }

 async save(value:unknown){
  const input=record(value);fields(input,['botId','expectedRevision','disabledSkills']);
  const botId=text(input.botId,'bot_id'),bot=await this.bot(botId);
  if(this.store.binding(botId)?.kind!=='xiaok-hosted')throw new KTeamError('bot_skills_external',409);
  const current=profile(bot),disabledSkills=parseDisabledSkills(input.disabledSkills);
  if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision!==current.revision)throw new KTeamError('bot_profile_changed',409);
  const result=await this.upstream.updateBot(botId,{kteamProfile:{...current,disabledSkills,revision:current.revision+1},expectedKteamProfileRevision:current.revision});
  return {ok:true,botId,profile:profile(result.agent)};
 }
}
