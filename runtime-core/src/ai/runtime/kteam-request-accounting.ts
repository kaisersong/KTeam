import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID,createHash} from 'node:crypto';
export type RequestKind='chat'|'routing'|'retry'|'embedding'|'distill'|'tool-web'|'observation';
export interface RequestWitness {version:1;attemptId:string;logicalCallId:string;kind:RequestKind;adapter:string;attempt:number;phase:'reserved'|'responded'|'unknown';status?:number;requestDigest?:string}
interface Scope {kind:RequestKind;observe:(witness:RequestWitness)=>Promise<void>|void}
const logicalCalls=new AsyncLocalStorage<{id:string;attempt:number}>();
export function kteamLogicalStream<T>(start:()=>AsyncIterable<T>):AsyncIterable<T>{const logical={id:randomUUID(),attempt:0};return {[Symbol.asyncIterator](){const iterator=logicalCalls.run(logical,()=>start()[Symbol.asyncIterator]());return {next:()=>logicalCalls.run(logical,()=>iterator.next()),return:()=>logicalCalls.run(logical,()=>iterator.return?iterator.return():Promise.resolve({done:true as const,value:undefined}))};}};}
const scopes=new AsyncLocalStorage<Scope>(),physical=new AsyncLocalStorage<boolean>();
export function withKTeamRequestScope<T>(scope:Scope,work:()=>T):T{return scopes.run(scope,work);}
export function withKTeamRequestKind<T>(kind:RequestKind,work:()=>T):T{const scope=scopes.getStore();return scope?scopes.run({...scope,kind},work):work();}
export const isKTeamPhysicalRequest=()=>physical.getStore()===true;
/** Installed only at host-owned provider boundaries; never read classifications from headers or model input. */
export function kteamRequestFetch(adapter:string,transport:typeof fetch,kind?:RequestKind):typeof fetch{

 return async(input,init)=>{
  const scope=scopes.getStore();if(!scope||physical.getStore())return transport(input,init);
  const logical=logicalCalls.getStore(),attempt=logical?++logical.attempt:1,category=kind??scope.kind;
  const requestDigest=createHash('sha256').update(JSON.stringify([typeof input==='string'?input:input instanceof URL?input.href:input.url,init?.method??(input instanceof Request?input.method:'GET'),typeof init?.body==='string'?init.body:init?.body==null?'':'unavailable-stream'])).digest('hex');
  const witness:RequestWitness={requestDigest,version:1,attemptId:randomUUID(),logicalCallId:logical?.id??randomUUID(),kind:attempt>1&&['chat','routing','distill'].includes(category)?'retry':category,adapter,attempt,phase:'reserved'};
  // Persist admission before physical entry. Observer failure cannot enter transport.
  await scope.observe(Object.freeze({...witness}));
  try{const response=await physical.run(true,()=>transport(input,init));await scope.observe(Object.freeze({...witness,phase:'responded',status:response.status}));return response;}
  catch(error){await scope.observe(Object.freeze({...witness,phase:'unknown'}));throw error;}
 };
}

export async function kteamRequestOperation<T>(adapter:string,kind:RequestKind,work:()=>Promise<T>):Promise<T>{const scope=scopes.getStore();if(!scope)return work();const witness:RequestWitness={version:1,attemptId:randomUUID(),logicalCallId:randomUUID(),kind,adapter,attempt:1,phase:'reserved'};await scope.observe(witness);try{const result=await work();await scope.observe({...witness,phase:'responded'});return result;}catch(error){await scope.observe({...witness,phase:'unknown'});throw error;}}
