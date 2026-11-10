import {randomBytes} from 'node:crypto';
import {KTeamError, fields, record, text} from '../errors.js';
import {modelCatalog, modelIdentity, nativeTurn} from '../runtime/native.js';
import {TeamStore} from './team-store.js';

// Desktop-managed xiaok runs in the host. Its readiness never depends on a CLI executable.
// See upstream desktop/electron/managed-xiaok-agent.ts:resolveLocalXiaokRuntimePath.
export class BuiltinAgent {
  private closed=false;
  private tasks=new Map<string,Promise<void>>();
  private controllers=new Set<AbortController>();
  private entering=new Set<Promise<unknown>>();
  constructor(private store:TeamStore,private ports: {catalog:()=>Promise<{defaultModelId:string;models:{id:string}[]}>;identity:(modelId:string)=>Promise<{model:string;fingerprint:string}>;turn:(input:Parameters<typeof nativeTurn>[0])=>Promise<{text:string}>}={catalog:modelCatalog,identity:modelIdentity,turn:nativeTurn}){}
  private current(){if(this.closed)throw new KTeamError('host_closing',503);}
  private async context(modelId?:string){
    this.current();
    const catalog=await this.ports.catalog(),id=modelId||catalog.defaultModelId;
    if(!id||!catalog.models.some(m=>m.id===id))throw new KTeamError('model_binding_not_found',409);
    const identity=await this.ports.identity(id);this.current();
    return {modelId:id,model:identity.model,fingerprint:identity.fingerprint,modelCount:catalog.models.length};
  }
  private key(id:string){return 'builtin-probe:'+id;}
  private view(context:{modelId:string;model:string;fingerprint:string;modelCount:number}){
    const stored=this.store.state<any>(this.key(context.modelId));
    const matches=stored?.fingerprint===context.fingerprint;
    const state=matches?(stored.state==='running'&&!this.tasks.has(context.modelId)?'interrupted':stored.state==='ready'&&Date.now()-stored.verifiedAt>300000?'configured':stored.state):'configured';
    return {id:'builtin',label:'KTeam 内置',source:'xiaok-runtime',...context,state,
      ...(matches&&state==='failed'?{reason:stored.reason}:{}),...(state==='interrupted'?{reason:'native_probe_interrupted'}:{})};
  }
  status(modelId?:string){const promise=this.statusBody(modelId);this.entering.add(promise);return promise.finally(()=>this.entering.delete(promise));}
  private async statusBody(modelId?:string){
    try{return this.view(await this.context(modelId));}
    catch(e){return {id:'builtin',label:'KTeam 内置',source:'xiaok-runtime',state:'unavailable',reason:e instanceof KTeamError?e.code:'builtin_runtime_unavailable'};}
  }
  start(value:unknown){
    const promise=this.startBody(value);this.entering.add(promise);
    return promise.finally(()=>this.entering.delete(promise));
  }
  private async startBody(value:unknown){
    const input=record(value);fields(input,['modelId']);
    const modelId=input.modelId===undefined?undefined:text(input.modelId,'model_id',256),context=await this.context(modelId),view=this.view(context);
    this.current();if(this.tasks.has(context.modelId)){if(view.state!=='running')throw new KTeamError('model_binding_changed',409);return view;}if(view.state==='ready')return view;
    const controller=new AbortController(),nonce='KTEAM_BUILTIN_'+randomBytes(12).toString('hex');this.controllers.add(controller);
    const state={...context,state:'running',startedAt:Date.now()};this.store.setState(this.key(context.modelId),state);
    const task=Promise.resolve().then(async()=>{
      try{
        const result=await this.ports.turn({modelId:context.modelId,fingerprint:context.fingerprint,system:'This is a connection check. Reply with the exact requested nonce. Do not use tools.',prompt:nonce,tools:[],maxIterations:1,signal:AbortSignal.any([controller.signal,AbortSignal.timeout(60000)])});
        if(result.text.trim()!==nonce)throw new KTeamError('native_probe_response_invalid',502);
        const after=await this.context(context.modelId);if(after.fingerprint!==context.fingerprint)throw new KTeamError('model_binding_changed',409);
        this.current();this.store.setState(this.key(context.modelId),{...state,state:'ready',verifiedAt:Date.now()});
      }catch(e){
        if(!this.closed)this.store.setState(this.key(context.modelId),{...state,state:'failed',reason:probeReason(e)});
      }finally{this.controllers.delete(controller);this.tasks.delete(context.modelId);}
    });this.tasks.set(context.modelId,task);return this.view(context);
  }
  async close(){this.closed=true;for(const controller of this.controllers)controller.abort();await Promise.allSettled([...this.entering,...this.tasks.values()]);}
}
function probeReason(error:unknown){
  if(error instanceof KTeamError)return error.code;
  if(error instanceof Error&&['TimeoutError','AbortError'].includes(error.name))return 'native_timeout';
  const message=error instanceof Error?error.message:'';
  if(/quota|429|1310|额度|限额/i.test(message))return 'model_quota_exhausted';
  if(/401|unauthori|api.?key|authentication|credential/i.test(message))return 'model_authentication_failed';
  return 'model_execution_failed';
}
