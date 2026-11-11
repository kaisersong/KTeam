import {runtimeOutputPage} from './runtime-output.js';
import {harnessLocation,acquireHarnessStorage} from './harness-storage.js';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {mailTools} from './mail-connector.js';
import {KTeamError} from '../errors.js';

export interface HarnessSessionScope {root:string;botId:string;roomId:string;bindingRevision:number;fingerprint:string;profileRevision:number}
export interface HarnessRuntimeOwner {registry:any;session:any;memoryStore:any;promptSnapshot:any;system:string;persist:()=>Promise<void>;close:()=>Promise<void>;onEvent:(event:any)=>void;runOwned:<T>(work:()=>T)=>T;settleChildren:()=>Promise<any[]>;distill:(text:string)=>Promise<void>;spillDir:string}
const key=(input:unknown)=>createHash('sha256').update(JSON.stringify(input)).digest('hex');
// One host owner opens each scope once. Runtime history is private model state,
// never a writable Room transcript or an authoritative project/task store.
export async function openHarnessSession(input:{core:any;toolPolicy?:any;integrations?:any;scope:HarnessSessionScope;cwd:string;adapter:any;model:string;system:string;query?:string;tools:any[];catalog:any;permissions:any;permissionManagerForCwd:any;onPrompt:any;onPromptForCwd:any;bindTool:(tool:any,cwd?:string)=>any;assertCurrent:()=>Promise<void>;onCloseFailure?:()=>void;processOwner?:any;onEvent?:(event:any)=>void}):Promise<HarnessRuntimeOwner>{
 const {core,scope,cwd}=input;
 const {identity,directory}=harnessLocation(scope,cwd);
 const releaseStorage=acquireHarnessStorage(directory);
 let platform:any,factory:any,memory:any,session:any,store:any;
 try{
  await input.assertCurrent();
  const privateMemory=join(directory,'memory');
  const config=await core.loadConfig(),integration=input.integrations??{memory:{enabled:true,autoCompact:true,retrievalLimit:10},mcp:{},cua:{enabled:false},mail:{}};
  const disabledMcp=new Set((Object.values(integration.mcp) as any[]).filter(server=>server.enabled===false).map(server=>server.name));
  const memoryEnabled=integration.memory.enabled!==false;
  if(!memoryEnabled)memory={search:async()=>[],listRelevant:async()=>[]};
  else try{memory=new core.LayeredMemoryStore(core.resolveLayeredConfig({...config.memory,embedding:integration.memory.embedding??config.memory?.embedding,dbPath:join(directory,'memory.sqlite'),compaction:{autoCompact:false}}));}
  catch{memory=new core.FileMemoryStore(privateMemory);}
  // The complete original platform owns MCP/plugin/LSP connections and Worktrees.
  // Team operations stay with the existing authenticated KTeam semantic tools.
  const unavailable=()=>{throw new KTeamError('use_kteam_team_tools');};
  const teamService=new Proxy({},{get:()=>unavailable});
  platform=await core.withHarnessProcessOwner(input.processOwner,()=>core.createPlatformRuntimeContext({cwd,builtinCommands:[],assertCurrent:input.assertCurrent,privateStateRoots:[scope.root],stateRootDir:join(directory,'platform'),teamService,reminderMode:'local',kteamMcpAllowed:(name:string)=>!disabledMcp.has(name)&&(input.toolPolicy?.mcpAllowed(name)??true),kteamDisableLsp:input.toolPolicy&&!input.toolPolicy.opaqueAllowed,kteamMcpServers:(()=>{const servers=core.loadSettingsMcpServers();for(const r of Object.values(integration.mcp) as any[]){const {name,enabled,...config}=r;if(enabled)servers[name]=config;else delete servers[name];}return servers;})(),kteamCuaServer:integration.cua.enabled?{type:'stdio',command:integration.cua.command,args:integration.cua.args}:undefined}));
  if(input.toolPolicy?.restricted&&input.toolPolicy.scope.files.mode!=='inherit'){platform.sandboxPolicy=input.toolPolicy.sandbox;platform.sandboxEnforcer=core.createSandboxEnforcer(platform.sandboxPolicy);}
  await platform.mcpReady;
  await input.assertCurrent();
  await input.catalog.reload();
  store=new core.FileSessionStore(join(directory,'sessions'));
  const sessionId='kteam_'+identity;
  const previous=await store.load(sessionId);
  session=new core.AgentSessionState();
  session.restoreSnapshot(previous??{...session.exportSnapshot(),sessionId,cwd,lineage:[sessionId]});
  session.repairIncompleteToolCalls();
  const promptMemory={search:async()=>{const relevant=input.query?await memory.listRelevant({cwd,query:input.query}):[];const recent=memory.search?await memory.search('',6):await memory.listRelevant({cwd,query:''});return [...new Map([...relevant,...recent].map((r:any)=>[r.id,r])).values()].slice(0,integration.memory.retrievalLimit);},listRelevant:memory.listRelevant.bind(memory)};
  const builder=new core.PromptBuilder({memoryStore:promptMemory,harnessMemoryStore:{listActive:()=>[]}});
  const buildPrompt=async(promptCwd:string)=>builder.build({channel:'chat',enterpriseId:null,devApp:null,cwd:promptCwd,budget:24000,skills:input.catalog.list(),agents:platform.customAgents,pluginCommands:platform.pluginRuntime.commandDeclarations,autoContext:await core.loadAutoContext({cwd:promptCwd}),permissionMode:'default'});
  const snapshot=await buildPrompt(cwd);
  const sideCall=async(prompt:string)=>{await input.assertCurrent();let output='',done=false;for await(const event of core.streamStatelessSideCallProviderConversation({adapter:input.adapter,messages:[{role:'user',content:[{type:'text',text:prompt}]}],tools:[],systemPrompt:'只按本次要求输出数据，不执行工具。',invocationId:'inv_'+key([Date.now(),Math.random()]),options:{signal:input.processOwner?.signal,maxOutputTokens:8192,reasoningMode:'disabled'}})){if(event.type==='text')output+=event.delta;if(event.type==='done')done=true;}await input.assertCurrent();if(!done)throw new KTeamError('model_response_incomplete');return output;};
  memory.setLLMFn?.(sideCall);
  const backgroundBefore=new Set(platform.listBackgroundJobs(sessionId).map((j:any)=>j.jobId));
  const system=snapshot.rendered+"\n大工具输出保存在本会话私有存储。若结果提示 file://.kteam/spill/...，用 read_runtime_output 按工具调用ID读取，不能读取其他会话。\n"+'\n'+input.system+'\n子 Agent 是本成员在当前会话中的内部工作线程，不能创建群成员、改变项目权限或代表其他 Bot 发言。记忆只属于当前 Bot 与当前群，不跨群读取。';
  factory=core.createPlatformRegistryFactory({platform,disableHooks:input.toolPolicy?.restricted,source:'chat',sessionId,adapter:()=>input.adapter,promptExecutor:sideCall,skillTool:core.createSkillTool(input.catalog,platform.capabilityRegistry),workflowTools:[...input.tools,...mailTools(integration.mail),{permission:'safe',definition:{name:'read_runtime_output',description:'分段读取当前Bot当前会话的大工具输出。toolCallId来自截断提示中的.txt文件名，不含扩展名。不能读取其他会话或任意文件。',inputSchema:{type:'object',additionalProperties:false,required:['toolCallId'],properties:{toolCallId:{type:'string',pattern:'^[a-zA-Z0-9_-]{1,256}$'},offset:{type:'integer',minimum:0},bytes:{type:'integer',minimum:1,maximum:32000}}}},execute:async(args:any)=>{await input.assertCurrent();const page=runtimeOutputPage(join(directory,'spill',sessionId),args.toolCallId,args.offset??0,args.bytes??16000);await input.assertCurrent();return JSON.stringify(page);}}],memoryStore:memoryEnabled?memory:undefined,permissionManager:input.permissions,permissionManagerForCwd:input.permissionManagerForCwd,onPrompt:input.onPrompt,onPromptForCwd:input.onPromptForCwd,assertCurrent:input.assertCurrent,teamTools:[],disableReminders:true,bindTool:input.bindTool,buildSystemPrompt:async(childCwd:string)=>(await buildPrompt(childCwd)).rendered+'\n'+input.system,onSubAgentEvent:input.onEvent,onMultiAgentEvent:input.onEvent});
  const registry=factory.createRegistry(cwd);
  const persist=async()=>{await store.save({...session.exportSnapshot(),model:input.model});const actual=await store.load(sessionId);if(!actual)throw new KTeamError('harness_session_persist_failed');session.updatePersistenceFacts(actual);};
  await persist();
  let closed=false;
  const joined=new Set<string>();
  const collect=()=>[...factory.listChildren().filter((a:any)=>a.id!=='main').map((a:any)=>({id:a.id,turn:a.turn,state:a.status,active:a.executionActive||a.status==='pending',result:a.lastResult,error:a.error})),...platform.listBackgroundJobs(sessionId).filter((j:any)=>!backgroundBefore.has(j.jobId)).map((j:any)=>({id:j.jobId,state:j.status,active:['queued','running'].includes(j.status),result:j.summary,error:j.errorMessage}))];
  const settleChildren=async()=>{if(!collect().some((r:any)=>!joined.has(key(r))))return [];for(;;){await input.assertCurrent();const rows=collect();if(!rows.some((r:any)=>r.active)){const pending=rows.filter((r:any)=>!joined.has(key(r)));for(const row of pending)joined.add(key(row));return pending;}await new Promise(r=>setTimeout(r,1000));}};
  const distill=async(text:string)=>{await input.assertCurrent();input.processOwner?.signal.throwIfAborted();await memory.writeRawMessage?.(sessionId,'assistant',text);if(memoryEnabled&&integration.memory.autoCompact&&memory.compact&&(memory.getStats?.().l0??0)>=5){try{await memory.compact({requestSource:'scheduler'});}catch{input.processOwner?.signal.throwIfAborted();await input.assertCurrent();input.onEvent?.({type:'memory_distillation_deferred'});}}input.processOwner?.signal.throwIfAborted();await input.assertCurrent();};
  return {registry,session,settleChildren,distill,spillDir:join(directory,'spill'),runOwned:<T>(work:()=>T):T=>core.withHarnessProcessOwner(input.processOwner,work),memoryStore:memory,promptSnapshot:{...snapshot,rendered:system},system:system+'\n当前实际工具目录：'+registry.getToolDefinitions().map((t:any)=>t.name).join('、'),persist,onEvent:event=>input.onEvent?.(event),async close(){if(closed)return;closed=true;const errors:unknown[]=[];for(const run of [()=>factory.dispose(),()=>factory.waitForDisposedResources()]){try{await run();}catch(e){errors.push(e);}}try{await platform.dispose();}catch(e){errors.push(e);}try{session.repairIncompleteToolCalls();await persist();}catch(e){errors.push(e);}try{await memory.close?.();}catch(e){errors.push(e);}if(errors.length){input.onCloseFailure?.();throw new KTeamError('harness_runtime_close_failed',503);}releaseStorage();}};
 }catch(error){const failures:unknown[]=[];for(const cleanup of [()=>factory?.dispose(),()=>factory?.waitForDisposedResources(),()=>platform?.dispose(),()=>memory?.close?.()]){try{await cleanup();}catch(e){failures.push(e);}}if(failures.length){input.onCloseFailure?.();throw new KTeamError('harness_runtime_close_failed',503);}releaseStorage();throw error;}
}
