import {unexecutedModelToolOutput} from '../protocol/model-tool-output.js';
import {HARNESS_PERMISSION_POLICY_VERSION} from '../service/terminal-permissions.js';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {KTeamError} from '../errors.js';
import {calendarWindow} from './calendar.js';
import {AsyncLocalStorage} from 'node:async_hooks';
import type {HarnessRuntimeOwner} from './harness-session.js';

const requestBudget=new AsyncLocalStorage<{origin:string;mode?:'shadow'|'enforce';before:()=>void|Promise<void>}>();
let accountingCore:any;
const nativeFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{
 const url=typeof input==='string'||input instanceof URL?new URL(input):new URL(input.url);
 const budget=requestBudget.getStore();if(budget&&url.origin===budget.origin&&(budget.mode==='shadow'||!accountingCore?.withKTeamRequestScope))await budget.before();
 return nativeFetch(input,init);
};

const entry=process.env.KTEAM_RUNTIME_ENTRY??resolve('build/shared/kteam-runtime.mjs');
let artifactRevision:Promise<string>|undefined;
// Durable approvals must also notice changes to the owned wrapper permission policy.
export const runtimeArtifactRevision=()=>artifactRevision??=readFile(entry).then(bytes=>createHash('sha256').update(bytes).update('\0'+HARNESS_PERMISSION_POLICY_VERSION).digest('hex'));
let loaded:Promise<any>|undefined;
export const sharedRuntime=()=>loaded??=import(pathToFileURL(entry).href);
const finalAnswerInstruction='本轮工具执行已到轮次上限。现在直接向用户交付一份独立完整的答复，只依据已完成的工具结果和已核对的事实。列出已有报告或文件的实际位置，明确哪些部分已完成、哪些尚待核实。不要声称未执行的工作已完成，不要再请求或模拟工具调用。';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

export async function modelCatalog(){
 const core=await sharedRuntime(),config=await core.loadConfig();accountingCore=core;
 return {defaultModelId:config.defaultModelId,models:Object.entries(config.models).map(([id,model]:[string,any])=>({id,label:model.label??model.model??id,model:model.model,provider:model.provider,configured:true}))};
}
export async function modelIdentity(modelId:string){
 const core=await sharedRuntime(),config=await core.loadConfig();accountingCore=core;
 const model=config.models[modelId];if(!model)throw new KTeamError('model_binding_not_found');
 const frozen={...config,providers:{...config.providers},defaultModelId:modelId};
 // SDK clients require a constructor key even for unauthenticated loopback services.
 // Keep this non-secret marker in the adapter snapshot, never in config or the vault.
 const provider=config.providers[model.provider];
 if(provider&&!provider.apiKey&&provider.baseUrl){const url=new URL(provider.baseUrl);if(['http:','https:'].includes(url.protocol)&&['localhost','127.0.0.1','[::1]'].includes(url.hostname))frozen.providers[model.provider]={...provider,apiKey:'kteam-local-unauthenticated'};}
 const adapter=core.createAdapter(frozen);
 const binding=core.resolveRuntimeModelBinding(frozen);
 return {core,adapter,origin:new URL(binding.baseUrl).origin,model:adapter.getModelName(),fingerprint:hash({modelId,providerId:binding.providerId,protocol:binding.protocol,baseUrl:binding.baseUrl,wireModel:binding.wireModel,runtimeOptions:binding.runtimeOptions})};
}
async function nativeTurnOwned(input:{modelId:string;fingerprint?:string;system:string;prompt:string;images?:any[];signal:AbortSignal;onText?:(text:string)=>void;onRequest?:(witness?:any)=>void|Promise<void>;requestAccountingMode?:'shadow'|'enforce';onRequestWitness?:(witness:any)=>void|Promise<void>;requestKind?:'chat'|'routing'|'distill';tools?:any[];maxIterations?:number;finalAnswerOnLimit?:boolean;takePendingInput?:()=>string|undefined;onInputReady?:()=>void|Promise<void>;onInputCheckpoint?:(messages:any[])=>boolean;onInputClosed?:(ok:boolean)=>void;contextRecovery?:()=>Promise<string>;prepareRuntime?:(adapter:any,model:string,system:string,tools:any[])=>Promise<HarnessRuntimeOwner>;registryOptions?:{permissionManager:any;onPrompt?:(name:string,input:Record<string,unknown>,meta?:any)=>Promise<boolean>}}):Promise<{text:string;usage:{inputTokens:number;outputTokens:number};usageReported?:boolean;model:any;fingerprint:string}>{
 const {core,adapter,model,fingerprint,origin}=await modelIdentity(input.modelId);
 if(input.fingerprint&&input.fingerprint!==fingerprint)throw new KTeamError('model_binding_changed',409);
 const tools=input.tools??[];
 const owner=await input.prepareRuntime?.(adapter,model,input.system,tools);
 // Empty registries must also omit the platform's automatically added tool_search.
 // Advertising it made tool-free routing consume its sole iteration on a rejected call.
 const registry=owner?.registry??new core.ToolRegistry({autoMode:true,...input.registryOptions,...(!tools.length?{nativeReadonlyOnly:true}:{})},tools);if(!owner)registry.setAllowedTools(tools.flatMap((tool:any)=>[tool.definition.name,...(tool.companionTools??[]).map((child:any)=>child.definition.name)]).concat(tools.length?['tool_search']:[]));
 let text='',usage={inputTokens:0,outputTokens:0},failure:Error|undefined,completed=false,usageReported=false,suspended:string|undefined;
 const invocationUsage=new Map<string,{inputTokens:number;outputTokens:number}>();
 const observeUsage=(event:any)=>{usageReported=true;if(event.providerUsage&&event.providerInvocationId){const prior=invocationUsage.get(event.providerInvocationId)??{inputTokens:0,outputTokens:0};invocationUsage.set(event.providerInvocationId,{inputTokens:Math.max(prior.inputTokens,event.providerUsage.inputTokens??0),outputTokens:Math.max(prior.outputTokens,event.providerUsage.outputTokens??0)});usage=[...invocationUsage.values()].reduce((sum,next)=>({inputTokens:sum.inputTokens+next.inputTokens,outputTokens:sum.outputTokens+next.outputTokens}),{inputTokens:0,outputTokens:0});}else if(!invocationUsage.size)usage={inputTokens:Math.max(0,event.usage.inputTokens??0),outputTokens:Math.max(0,event.usage.outputTokens??0)};};
 const budgetAbort=new AbortController();let budgetFailure:unknown;
 const signal=AbortSignal.any([input.signal,budgetAbort.signal]);
 const calendar=calendarWindow();
 const time=`当前主机时间：${new Date().toISOString()}。用户时区：${calendar.timeZone}。今天是${calendar.today}（${calendar.weekday}）。本周明确为${calendar.weekStart}至${calendar.weekEnd}，上周为${calendar.lastWeekStart}至${calendar.lastWeekEnd}。自然周为周一至周日，周日仍属于本周。用户说本周即使用上述本周日期，不自行改成上周，也不要求用户二选一。`;
 const runtime=new core.AgentRuntime({toolApprovalPort:owner?.toolApprovalPort,adapter,registry,session:owner?.session??new core.AgentSessionState(),controller:new core.AgentRunController(),systemPrompt:time+'\n'+(owner?.system??input.system),promptSnapshot:owner?.promptSnapshot,memoryStore:owner?.memoryStore,takePendingInput:input.takePendingInput,contextRecovery:input.contextRecovery,checkpoint:owner?async()=>{await owner.persist();if(input.onInputCheckpoint?.(owner.session.getMessages())){text='';input.onText?.('');}}:undefined,spillDir:owner?.spillDir,maxIterations:input.maxIterations??3,finalAnswerInstruction:input.finalAnswerOnLimit?finalAnswerInstruction:undefined});
 try{
  await input.onInputReady?.();
  await requestBudget.run({origin,mode:input.requestAccountingMode??'enforce',before:async()=>{try{await input.onRequest?.();}catch(error){budgetFailure=error;budgetAbort.abort(error);throw error;}}},()=>owner?owner.runOwned(()=>run()):run());
  async function run(){return runtime.run(input.images?.length?[{type:'text',text:input.prompt},...input.images]:input.prompt,(event:any)=>{
   if(owner&&!['assistant_text','execution_progress'].includes(event.type))owner.onEvent({...event,...(event.error?{error:{name:event.error.name,message:core.redactSecrets(String(event.error.message??event.error)).text.slice(0,1000)}}:{})});
   if(event.type==='final_answer_started'){text='';input.onText?.('');}
   if(event.type==='assistant_text'){text+=event.delta;input.onText?.(unexecutedModelToolOutput(text)?'':text);}
   if(event.type==='usage_updated')observeUsage(event);
   if(event.type==='run_failed')failure=event.error;
   if(event.type==='run_suspended')suspended=event.approvalId;
   if(event.type==='run_completed')completed=true;
   if(event.type==='max_iterations_reached')failure=new KTeamError('iteration_budget_exhausted');
  },signal);}
  if(owner&&!suspended&&!failure&&!signal.aborted){for(let join=0;;join++){const children=await owner.settleChildren();if(!children.length)break;if(join>=3)throw new KTeamError('subagent_join_budget_exhausted');completed=false;await requestBudget.run({origin,mode:input.requestAccountingMode??'enforce',before:async()=>{await input.onRequest?.();}},()=>owner.runOwned(()=>runtime.run(JSON.stringify({kind:'settled_child_work',instruction:'子任务已返回。核对实际结果并完成原任务；失败不是完成，不要只汇报委派。',children}),(event:any)=>{owner.onEvent({...event,...(event.error?{error:{name:event.error.name,message:core.redactSecrets(String(event.error.message??event.error)).text.slice(0,1000)}}:{})});if(event.type==='final_answer_started'){text='';input.onText?.('');}if(event.type==='assistant_text'){text+=event.delta;input.onText?.(unexecutedModelToolOutput(text)?'':text);}if(event.type==='usage_updated')observeUsage(event);if(event.type==='run_failed')failure=event.error;if(event.type==='run_suspended')suspended=event.approvalId;if(event.type==='max_iterations_reached')failure=new KTeamError('iteration_budget_exhausted');if(event.type==='run_completed')completed=true;},signal)));if(failure||signal.aborted||suspended)break;}}
  if(budgetFailure)throw budgetFailure;
  signal.throwIfAborted();
  if(suspended)throw new KTeamError('work_waiting_for_approval',409);
  if(failure)throw failure;
  if(!text.trim()||!completed)throw new KTeamError('model_response_incomplete');
  if(unexecutedModelToolOutput(text)){failure=new KTeamError('model_response_protocol_invalid',502);throw failure;}
  if(owner)await requestBudget.run({origin,mode:input.requestAccountingMode??'enforce',before:async()=>{await input.onRequest?.();}},()=>owner.distill(text));
  signal.throwIfAborted();
  return {text,usage,usageReported,model,fingerprint};
 }catch(error){if(budgetFailure)throw budgetFailure;if(owner?.session.getToolBatch()&&!suspended)throw new KTeamError('tool_batch_execution_unknown',503);throw error;}
 finally{try{input.onInputClosed?.((!!suspended||completed)&&!failure&&!signal.aborted&&!budgetFailure);}finally{if(owner)await owner.close();else registry.dispose();}}
}

export async function nativeTurn(input:Parameters<typeof nativeTurnOwned>[0]):ReturnType<typeof nativeTurnOwned>{
 const core=await sharedRuntime();accountingCore=core;
 return core.withKTeamRequestScope({kind:input.requestKind??'chat',observe:async(witness:any)=>{await input.onRequestWitness?.(witness);if(input.requestAccountingMode!=='shadow'&&witness.phase==='reserved'&&!['embedding','tool-web','observation'].includes(witness.kind))await input.onRequest?.(witness);}},()=>nativeTurnOwned(input));
}
