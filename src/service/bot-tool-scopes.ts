import {KTeamError,fields,record,text} from '../errors.js';
import type {Upstreams} from '../adapters/upstream.js';
import type {TeamStore} from './team-store.js';
import {profile} from './bot-profile.js';
import {BotCapabilities} from './bot-capabilities.js';
import {sharedRuntime} from '../runtime/native.js';
import {harnessWorkspace} from '../runtime/harness.js';
import {parseToolScope,toolScopePolicy} from '../runtime/tool-scope.js';
import {IntegrationSettings} from './integration-settings.js';
export class BotToolScopes{
 constructor(private upstream:Upstreams,private store:TeamStore){}
 private async current(botId:string,roomId?:string){await new BotCapabilities(this.upstream,this.store).scope(botId,roomId);if(!this.store.binding(botId)&&!this.store.state('external-bot:'+botId))throw new KTeamError('bot_not_managed',403);const bot=((await this.upstream.listBots()).agents as any[]).find(bot=>bot.id===botId&&!bot.archivedAt);if(!bot)throw new KTeamError('agent_not_found',404);return bot;}
 async view(botId:string,roomId?:string){const bot=await this.current(botId,roomId),binding=this.store.binding(botId),scope=parseToolScope(profile(bot).toolScope);if(binding?.kind!=='xiaok-hosted')return {ok:true,supported:false,scope,profileRevision:profile(bot).revision,reason:'当前外接 Agent 尚未验证逐工具范围隔离；请在原 Agent 管理。已有受限配置会阻止它执行，恢复内置 Agent 后可调整。'};
 const core=await sharedRuntime(),cwd=harnessWorkspace(profile(bot).workspace),integration=(await new IntegrationSettings().view()).settings,settings=core.loadSettingsMcpServers(),plugins=core.loadPluginMcpServers(await core.loadPlatformPluginRuntime(cwd,[])),names=new Set<string>([...Object.keys(settings),...plugins.map((server:any)=>server.name),...Object.values(integration.mcp).map((server:any)=>server.name),...(integration.cua.enabled?['cua-driver']:[])]),policy=toolScopePolicy(core,scope,this.store.root),disabled=new Set((Object.values(integration.mcp) as any[]).filter(server=>server.enabled===false).map(server=>server.name));
 return {ok:true,supported:true,profileRevision:profile(bot).revision,scope,workspace:cwd,effective:{terminal:scope.terminal==='inherit'&&policy.opaqueAllowed,opaqueTools:policy.opaqueAllowed},servers:[...new Set([...names,...scope.mcp.servers])].sort().map(name=>({name,configured:names.has(name),globallyDisabled:disabled.has(name),enabled:!disabled.has(name)&&policy.mcpAllowed(name)}))};}
 async save(value:unknown){const input=record(value);fields(input,['botId','roomId','expectedRevision','scope']);const botId=text(input.botId,'bot_id'),roomId=input.roomId===undefined?undefined:text(input.roomId,'room_id'),bot=await this.current(botId,roomId);if(this.store.binding(botId)?.kind!=='xiaok-hosted')throw new KTeamError('bot_tool_scope_external_unverified',409);if(profile(bot).revision!==input.expectedRevision)throw new KTeamError('bot_profile_changed',409);const scope=parseToolScope(input.scope),core=await sharedRuntime();toolScopePolicy(core,scope,this.store.root).validate();await new BotCapabilities(this.upstream,this.store).scope(botId,roomId);const result=await this.upstream.updateBot(botId,{kteamProfile:{...profile(bot),toolScope:scope,revision:profile(bot).revision+1},expectedKteamProfileRevision:profile(bot).revision});return {ok:true,profile:profile(result.agent)};}
}
