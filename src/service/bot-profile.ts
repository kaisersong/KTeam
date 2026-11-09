import {isAbsolute} from 'node:path';
import {realpathSync,statSync} from 'node:fs';
import {KTeamError,fields,record,text} from '../errors.js';
import {Upstreams} from '../adapters/upstream.js';
import {TeamStore} from './team-store.js';
export interface BotProfile{revision:number;participation:'auto'|'mentions';workspace:string;followup:boolean}
export const profile=(bot:any):BotProfile=>bot.kteamProfile??{revision:0,participation:'auto',workspace:'',followup:false};
export async function saveBotProfile(upstream:Upstreams,store:TeamStore,value:unknown){
 const input=record(value);fields(input,['botId','expectedRevision','description','instructions','participation','workspace','followup']);const botId=text(input.botId,'bot_id');
 if(!store.binding(botId)&&!store.state('external-bot:'+botId))throw new KTeamError('bot_not_managed',403);
 if(!Number.isSafeInteger(input.expectedRevision)||Number(input.expectedRevision)<0||!['auto','mentions'].includes(String(input.participation))||typeof input.followup!=='boolean')throw new KTeamError('bot_profile_invalid');
 const description=typeof input.description==='string'&&input.description.length<=512?input.description:undefined,instructions=typeof input.instructions==='string'&&input.instructions.length<=8192?input.instructions:undefined;
 if(description===undefined||instructions===undefined||typeof input.workspace!=='string'||input.workspace.length>4096)throw new KTeamError('bot_profile_invalid');
 let workspace=input.workspace.trim();if(workspace){try{if(!isAbsolute(workspace)||!statSync(workspace).isDirectory())throw Error();workspace=realpathSync(workspace);}catch{throw new KTeamError('bot_workspace_invalid');}}
 const bot=((await upstream.listBots()).agents as any[]).find(b=>b.id===botId&&!b.archivedAt);if(!bot)throw new KTeamError('agent_not_found',404);
 if(profile(bot).revision!==input.expectedRevision)throw new KTeamError('bot_profile_changed',409);
 const next:BotProfile={revision:Number(input.expectedRevision)+1,participation:input.participation as 'auto'|'mentions',workspace,followup:input.followup};
 const result=await upstream.updateBot(botId,{description,instructions,kteamProfile:next,expectedKteamProfileRevision:input.expectedRevision});return {ok:true,botId,profile:profile(result.agent)};
}
