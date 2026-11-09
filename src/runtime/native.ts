import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {KTeamError} from '../errors.js';
import {calendarWindow} from './calendar.js';
import {AsyncLocalStorage} from 'node:async_hooks';

const requestBudget=new AsyncLocalStorage<{origin:string;before:()=>void|Promise<void>}>();
const nativeFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{
 const url=typeof input==='string'||input instanceof URL?new URL(input):new URL(input.url);
 const budget=requestBudget.getStore();if(budget&&url.origin===budget.origin)await budget.before();
 return nativeFetch(input,init);
};

const entry=process.env.KTEAM_RUNTIME_ENTRY??resolve('build/shared/xiaok-runtime.mjs');
let loaded:Promise<any>|undefined;
export const sharedRuntime=()=>loaded??=import(pathToFileURL(entry).href);
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

export async function modelCatalog(){
 const core=await sharedRuntime(),config=await core.loadConfig();
 return {defaultModelId:config.defaultModelId,models:Object.entries(config.models).map(([id,model]:[string,any])=>({id,label:model.label??model.model??id,model:model.model,provider:model.provider,configured:true}))};
}
export async function modelIdentity(modelId:string){
 const core=await sharedRuntime(),config=await core.loadConfig();
 const model=config.models[modelId];if(!model)throw new KTeamError('model_binding_not_found');
 const frozen={...config,defaultModelId:modelId};
 const adapter=core.createAdapter(frozen);
 const binding=core.resolveRuntimeModelBinding(frozen);
 return {core,adapter,origin:new URL(binding.baseUrl).origin,model:adapter.getModelName(),fingerprint:hash({modelId,providerId:binding.providerId,protocol:binding.protocol,baseUrl:binding.baseUrl,wireModel:binding.wireModel,runtimeOptions:binding.runtimeOptions})};
}
export async function nativeTurn(input:{modelId:string;fingerprint?:string;system:string;prompt:string;signal:AbortSignal;onText?:(text:string)=>void;onRequest?:()=>void|Promise<void>;tools?:any[];maxIterations?:number;registryOptions?:{permissionManager:any;onPrompt?:(name:string,input:Record<string,unknown>,meta?:any)=>Promise<boolean>}}):Promise<{text:string;usage:{inputTokens:number;outputTokens:number};usageReported?:boolean;model:any;fingerprint:string}>{
 const {core,adapter,model,fingerprint,origin}=await modelIdentity(input.modelId);
 if(input.fingerprint&&input.fingerprint!==fingerprint)throw new KTeamError('model_binding_changed',409);
 const tools=input.tools??[];
 const registry=new core.ToolRegistry({autoMode:true,...input.registryOptions},tools);registry.setAllowedTools(tools.flatMap((tool:any)=>[tool.definition.name,...(tool.companionTools??[]).map((child:any)=>child.definition.name)]).concat(tools.length?['tool_search']:[]));
 let text='',usage={inputTokens:0,outputTokens:0},failure:Error|undefined,completed=false,usageReported=false;
 const budgetAbort=new AbortController();let budgetFailure:unknown;
 const signal=AbortSignal.any([input.signal,budgetAbort.signal]);
 const calendar=calendarWindow();
 const time=`当前主机时间：${new Date().toISOString()}。用户时区：${calendar.timeZone}。今天是${calendar.today}（${calendar.weekday}）。本周明确为${calendar.weekStart}至${calendar.weekEnd}，上周为${calendar.lastWeekStart}至${calendar.lastWeekEnd}。自然周为周一至周日，周日仍属于本周。用户说本周即使用上述本周日期，不自行改成上周，也不要求用户二选一。`;
 const runtime=new core.AgentRuntime({adapter,registry,session:new core.AgentSessionState(),controller:new core.AgentRunController(),systemPrompt:time+'\n'+input.system,maxIterations:input.maxIterations??3});
 try{
  await requestBudget.run({origin,before:async()=>{try{await input.onRequest?.();}catch(error){budgetFailure=error;budgetAbort.abort(error);throw error;}}},()=>runtime.run(input.prompt,(event:any)=>{
   if(event.type==='assistant_text'){text+=event.delta;input.onText?.(text);}
   if(event.type==='usage_updated'){usageReported=true;usage={inputTokens:Math.max(0,event.usage.inputTokens??0),outputTokens:Math.max(0,event.usage.outputTokens??0)};}
   if(event.type==='run_failed')failure=event.error;
   if(event.type==='run_completed')completed=true;
   if(event.type==='max_iterations_reached')failure=new KTeamError('iteration_budget_exhausted');
  },signal));
  if(budgetFailure)throw budgetFailure;
  signal.throwIfAborted();
  if(failure)throw failure;
  if(!text.trim()||!completed)throw new KTeamError('model_response_incomplete');
  return {text,usage,usageReported,model,fingerprint};
 }catch(error){if(budgetFailure)throw budgetFailure;throw error;}
 finally{registry.dispose();}
}
