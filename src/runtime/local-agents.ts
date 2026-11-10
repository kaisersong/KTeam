import{accessSync,constants,existsSync,lstatSync,readFileSync,realpathSync,statSync,createReadStream,readdirSync}from'node:fs';import{join,delimiter,dirname}from'node:path';import{homedir,hostname}from'node:os';import{createHash}from'node:crypto';import{KTeamError}from'../errors.js';import{runLocal,type ProcessResult,nativeFailure}from'./local-process.js';
// Verbatim KSwarm discovery/probe contracts. KTeam supplies local process/session ownership.
// @ts-ignore Existing upstream JavaScript is source-pinned in sources.lock.json.
import{buildHarnessChildEnv,generationProbeArgv}from'../vendor/kswarm/runtime-capabilities.js';
// @ts-ignore Verbatim KSwarm Kimi argv builder.
import{buildKimiCliArgs}from'../vendor/kswarm/kimi-cli-harness.js';
export const LOCAL_AGENTS=[{id:'xiaok-cli',label:'xiaok CLI',bins:['xiaok','xiaok-cli']},{id:'codex',label:'Codex',bins:['codex']},{id:'kimi',label:'Kimi',bins:['kimi']},{id:'zcode',label:'ZCode',bins:['zcode']}] as const;
export type LocalAgentId=typeof LOCAL_AGENTS[number]['id'];
export const isLocalAgent=(value:unknown):value is LocalAgentId=>LOCAL_AGENTS.some(a=>a.id===value);
export const isNativeModel=(id:string)=>id.startsWith('local-agent:');
export interface LocalInstallation{id:LocalAgentId;label:string;path:string;version:string;fingerprint:string;machine:string}
const binaryHashes=new Map<string,{stamp:string;hash:string}>();
async function binaryHash(path:string){const s=statSync(path),stamp=[s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs].join(':');const cached=binaryHashes.get(path);if(cached?.stamp===stamp)return cached.hash;const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);const value=hash.digest('hex');binaryHashes.set(path,{stamp,hash:value});return value;}
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function directories(){const home=homedir();let nvm:string[]=[];try{const root=join(process.env.NVM_DIR??join(home,'.nvm'),'versions/node');nvm=readdirSync(root).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true})).map(v=>join(root,v,'bin'));}catch{}return [...new Set([...(process.env.PATH??'').split(delimiter),join(home,'.local/bin'),join(home,'.npm-global/bin'),join(home,'.kimi-code/bin'),join(home,'.local/node/bin'),'/opt/homebrew/bin','/usr/local/bin','/usr/bin','/bin',...nvm].filter(Boolean))];}
export function findLocalAgent(id:LocalAgentId){const spec=LOCAL_AGENTS.find(a=>a.id===id)!;for(const directory of directories())for(const name of spec.bins){const path=join(directory,name);try{accessSync(path,constants.X_OK);const target=realpathSync(path);if(statSync(target).isFile())return {path,target};}catch{/* Next known installation. */}}throw new KTeamError('native_not_installed',404);}
export function nativeEnvironment(){const env:NodeJS.ProcessEnv=buildHarnessChildEnv({parentEnv:process.env});env.PATH=directories().join(delimiter);for(const name of ['USER','LOGNAME','SHELL','TZ','LANGUAGE','TEMP','TMP','SystemRoot','APPDATA','LOCALAPPDATA','USERPROFILE','CODEX_HOME','KIMI_HOME','KIMI_CODE_HOME','ZCODE_HOME','XIAOK_HOME'])if(process.env[name])env[name]=process.env[name];return env;}
const configPaths=(id:LocalAgentId)=>{const home=homedir();return id==='codex'?[join(process.env.CODEX_HOME??join(home,'.codex'),'config.toml')]:id==='kimi'?[join(home,'.kimi-code/config.toml'),join(home,'.kimi/config.toml')]:id==='zcode'?[join(home,'.zcode/settings.json'),join(home,'.zcode/config.json')]:[];};// xiaok-cli: detected by its command only; KTeam never reads xiaok's files.

export async function inspectLocalAgent(id:LocalAgentId,signal=AbortSignal.timeout(15000)):Promise<LocalInstallation>{if(!isLocalAgent(id))throw new KTeamError('native_unknown_agent');const spec=LOCAL_AGENTS.find(a=>a.id===id)!,found=findLocalAgent(id);const result=await runLocal(found.path,['--version'],{cwd:homedir(),env:nativeEnvironment(),signal,timeoutMs:10000});if(result.code!==0)throw new KTeamError('native_version_failed',503);const version=(result.stdout||result.stderr).trim().split('\n')[0]!.replace(/\x1b\[[0-9;]*m/g,'').slice(0,160);if(!version)throw new KTeamError('native_version_failed',503);const stat=statSync(found.target),entryHash=await binaryHash(found.target),configs=configPaths(id).map(path=>{try{return {path,hash:createHash('sha256').update(readFileSync(path)).digest('hex')};}catch{return {path,hash:null};}});return {id,label:spec.label,path:found.path,version,fingerprint:digest({id,path:found.path,target:found.target,size:stat.size,entryHash,version,configs}),machine:hostname()};}
export function localArgs(id:LocalAgentId,prompt:string,options:{sessionId?:string;readonly?:boolean;probe?:boolean}={}){
 const {sessionId,readonly,probe}=options;
 if(id==='codex'){
  if(!sessionId&&probe)return generationProbeArgv('codex')!.map((a:string,i:number,all:string[])=>i===all.length-1?prompt:a);
  const config=readonly?['-c','sandbox_mode="read-only"']:[];
  return [...config,'exec',...(sessionId?['resume','--json','--skip-git-repo-check',sessionId,prompt]:['--json','--skip-git-repo-check',...(readonly?['--sandbox','read-only']:[]),prompt])];
 }
 if(id==='kimi'){if(readonly&&!probe)throw new KTeamError('native_readonly_unavailable',409);const args=buildKimiCliArgs(prompt);args[3]='stream-json';return [...args,...(sessionId?['--session',sessionId]:[])];}
 if(id==='zcode')return ['--prompt',prompt,'--json','--mode',readonly||probe?'plan':'build',...(sessionId?['--resume',sessionId]:[])];
 return ['chat','--json',...(probe||readonly?['--dry-run']:[]),...(sessionId?['--resume',sessionId]:[]),prompt];
}
export interface NativeOutput{text:string;sessionId?:string;model?:string;usage:{inputTokens:number;outputTokens:number};toolCalls?:unknown[];usageReported?:boolean}
export function parseNativeOutput(id:LocalAgentId,result:ProcessResult):NativeOutput{
 if(result.code!==0)throw new KTeamError(nativeFailure(result),503);
 const values:any[]=[];try{values.push(JSON.parse(result.stdout.trim()));}catch{for(const line of result.stdout.split('\n')){try{values.push(JSON.parse(line));}catch{/* Native diagnostics are not assistant messages. */}}}
 let text='',sessionId:string|undefined,model:string|undefined,usage={inputTokens:0,outputTokens:0},toolCalls:unknown[]=[],usageReported=false;
 for(const v of values){sessionId??=v.thread_id??v.session_id??v.sessionId;model??=v.model??v.message?.model;
  if(v.type==='item.completed'&&v.item?.type==='agent_message')text=String(v.item.text??'');
  if(v.role==='assistant'&&typeof v.content==='string')text=v.content;
  if(v.type==='assistant'&&v.message?.content)text=v.message.content.filter((b:any)=>b.type==='text').map((b:any)=>b.text).join('\n');
  if(v.type==='result'&&typeof v.result==='string')text=v.result;
  if(typeof v.text==='string'&&(!v.type||v.type==='result'))text=v.text;
  const u=v.usage??v.message?.usage;if(u){usageReported=true;usage={inputTokens:Number(u.inputTokens??u.input_tokens??u.input_tokens_total??0),outputTokens:Number(u.outputTokens??u.output_tokens??0)};}
  if(Array.isArray(v.tool_calls))toolCalls.push(...v.tool_calls);if(v.type==='item.completed'&&['command_execution','file_change','mcp_tool_call','web_search'].includes(v.item?.type))toolCalls.push(v.item);if(v.type==='assistant'&&Array.isArray(v.message?.content))toolCalls.push(...v.message.content.filter((b:any)=>b.type==='tool_use'));if(v.role==='tool'||v.type==='tool_use')toolCalls.push(v);
  if(v.type==='turn.failed'||v.type==='error'||v.is_error===true)throw new KTeamError(nativeFailure(result),503);
 }
 if(!text.trim())throw new KTeamError('native_response_invalid',502);
 if(sessionId&&(typeof sessionId!=='string'||!/^[A-Za-z0-9_-]{8,160}$/.test(sessionId)))throw new KTeamError('native_session_invalid',502);
 return {text:text.trim(),sessionId,model,usage,toolCalls,usageReported};
}
