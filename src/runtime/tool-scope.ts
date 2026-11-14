import {isAbsolute,resolve} from 'node:path';
import {realpathSync,statSync} from 'node:fs';
import {KTeamError,record,fields} from '../errors.js';

export interface BotToolScope {version:1;files:{mode:'inherit'|'none'|'selected';paths:string[];write:boolean};terminal:'inherit'|'off';network:'inherit'|'off';mcp:{mode:'inherit'|'selected';servers:string[]}}
export const defaultToolScope=():BotToolScope=>({version:1,files:{mode:'inherit',paths:[],write:true},terminal:'inherit',network:'inherit',mcp:{mode:'inherit',servers:[]}});
export function parseToolScope(value:unknown):BotToolScope{
 if(value===undefined)return defaultToolScope();
 try{const input=record(value);fields(input,['version','files','terminal','network','mcp']);const files=record(input.files),mcp=record(input.mcp);fields(files,['mode','paths','write']);fields(mcp,['mode','servers']);
 if(input.version!==1||!['inherit','none','selected'].includes(String(files.mode))||typeof files.write!=='boolean'||!['inherit','off'].includes(String(input.terminal))||!['inherit','off'].includes(String(input.network))||!['inherit','selected'].includes(String(mcp.mode)))throw Error();
 if(!Array.isArray(files.paths)||files.paths.length>16||files.paths.some(path=>typeof path!=='string'||!isAbsolute(path)||path.length>4096||path.includes('\0')||resolve(path)!==path)||new Set(files.paths).size!==files.paths.length||(files.mode==='selected'?files.paths.length===0:files.paths.length!==0)||(files.mode==='none'&&files.write))throw Error();
 if(!Array.isArray(mcp.servers)||mcp.servers.length>100||mcp.servers.some(name=>typeof name!=='string'||!name||name.length>128||!/^[a-zA-Z0-9_.-]+$/.test(name))||new Set(mcp.servers).size!==mcp.servers.length||(mcp.mode==='inherit'&&mcp.servers.length))throw Error();
 return {version:1,files:{mode:files.mode as any,paths:[...files.paths] as string[],write:files.write},terminal:input.terminal as any,network:input.network as any,mcp:{mode:mcp.mode as any,servers:[...mcp.servers] as string[]}};
 }catch{throw new KTeamError('bot_tool_scope_invalid',409);}
}
export const restrictedToolScope=(scope:BotToolScope)=>JSON.stringify(scope)!==JSON.stringify(defaultToolScope());
const localTools=new Set(['propose_team','propose_skill','schedule_follow_up','update_shared_context','read_material','get_team_work','ask_user','contact_bot','delegate_work','wait_for_condition','read_runtime_output','notebook_read','notebook_write','tool_search','skill','skillFetchAssets','validate_skill','list_mail_accounts','mail_list_accounts','subagent','spawn_agent','send_message','followup_task','wait_agent','list_agents','interrupt_agent','close_agent']);
/** A tool-admission restriction, never an OS sandbox or an authority grant. */
export function toolScopePolicy(core:any,scope:BotToolScope,privateRoot?:string){
 const restricted=restrictedToolScope(scope),opaqueAllowed=scope.files.mode==='inherit'&&scope.files.write&&scope.network==='inherit';
 const paths=scope.files.mode==='selected'?scope.files.paths:[],denied=[...(privateRoot?[privateRoot]:[]),...(scope.files.mode==='none'?[resolve('/')]:[])];
 const sandbox=core.createSandboxPolicy({pathAllowlist:scope.files.mode==='selected'?paths:scope.files.mode==='none'?[]:[resolve('/')],pathDenylist:denied,network:scope.network==='off'?'deny':'allow'});
 const validate=()=>{for(const path of paths){try{if(realpathSync(path)!==path||!statSync(path).isDirectory())throw Error();}catch{throw new KTeamError('bot_tool_scope_path_changed',409);}}};
 const mcpAllowed=(name:string)=>opaqueAllowed&&(scope.mcp.mode==='inherit'||scope.mcp.servers.includes(name));
 const permits=(name:string,args:Record<string,unknown>={},base:string)=>{
  validate();if(!restricted)return true;
  if(['read','write','edit','glob','grep'].includes(name)){
   if(scope.files.mode==='none'||(['write','edit'].includes(name)&&!scope.files.write))return false;
   const path=['glob','grep'].includes(name)?args.path??base:args.file_path;if(typeof path!=='string')return false;return sandbox.checkPath(resolve(base,path)).allowed;
  }
  if(name==='validate_skill')return scope.files.mode!=='none'&&typeof args.path==='string'&&sandbox.checkPath(resolve(base,args.path)).allowed;
  if(name==='wait_for_condition'){const condition=args.condition as any;return condition?.kind==='work_result'||scope.files.mode!=='none'&&typeof condition?.path==='string'&&sandbox.checkPath(resolve(base,condition.path)).allowed;}
  if(name==='bash')return scope.terminal==='inherit'&&opaqueAllowed;
  if(['web_fetch','web_search','read_mail','search_mail','send_mail','send_connected_mail','mail_search','mail_read'].includes(name))return scope.network==='inherit';
  if(name.startsWith('mcp__')){const split=name.indexOf('__',5);return split>5&&mcpAllowed(name.slice(5,split));}
  if(['render_ui','install_skill','uninstall_skill','lsp'].includes(name))return opaqueAllowed;
  if(['subagent','spawn_agent'].includes(name)&&!opaqueAllowed&&(args.agent||args.isolation==='worktree'))return false;
  return localTools.has(name);
 };
 return {scope,restricted,opaqueAllowed,sandbox,validate,mcpAllowed,permits,assert:(name:string,args:Record<string,unknown>,base:string)=>{if(!permits(name,args,base))throw new KTeamError('bot_tool_scope_denied',403);}};
}
