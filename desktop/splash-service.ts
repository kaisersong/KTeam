import {spawn,type ChildProcess} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {lstatSync,readFileSync} from 'node:fs';
import {splashTitle,type SplashOpenResult} from './splash-input.js';

export function splashEnvironment(env:NodeJS.ProcessEnv){
 const names=['SystemRoot','WINDIR','TEMP','TMP','TMPDIR','LANG','TZ'];
 return {...Object.fromEntries(names.filter(name=>env[name]!==undefined).map(name=>[name,env[name]])),ELECTRON_RUN_AS_NODE:'1'};
}
function validateURL(value:unknown){
 if(typeof value!=='string')throw Error('splash_invalid_ready');
 const u=new URL(value);
 if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||!u.port||u.pathname!=='/space'||u.search||u.username||u.password||!/^#token=[A-Za-z0-9_-]{43}$/.test(u.hash))throw Error('splash_invalid_ready');
 return u;
}
export class SplashService {
 private child?:ChildProcess; private starting?:Promise<string>;private ready?:string;private closed=false;
 constructor(private readonly options:{runtime:string;sha256:string;dataDir:string;executable?:string;openExternal:(url:string)=>Promise<unknown>;timeoutMs?:number;fetch?:typeof fetch}){}
 private start(){
  if(this.closed)return Promise.reject(Error('splash_closed'));
  if(this.ready)return Promise.resolve(this.ready);
  if(this.starting)return this.starting;
  const {runtime,sha256}=this.options;
  const file=lstatSync(runtime);
  if(!file.isFile()||file.isSymbolicLink()||createHash('sha256').update(readFileSync(runtime)).digest('hex')!==sha256)throw Error('splash_runtime_integrity');
  const nonce=randomBytes(32).toString('hex');
  const child=spawn(this.options.executable??process.execPath,[runtime,'--managed-splash'],{stdio:['ignore','ignore','ignore','ipc'],windowsHide:true,env:splashEnvironment(process.env)});
  this.child=child;
  const promise=new Promise<string>((resolve,reject)=>{
   let settled=false;
   const timer=setTimeout(()=>fail(Error('splash_start_timeout')),this.options.timeoutMs??10000);
   const fail=(error:Error)=>{if(settled)return;settled=true;clearTimeout(timer);child.kill();reject(error);};
   child.once('error',()=>fail(Error('splash_start_failed')));
   child.once('exit',()=>{if(this.child===child){this.child=undefined;this.ready=undefined;this.starting=undefined;}fail(Error('splash_exited'));});
   child.on('message',(message:any)=>{
    if(settled||message?.type!=='ready'||message.nonce!==nonce)return;
    try{validateURL(message.url);if(this.closed)throw Error('splash_closed');settled=true;clearTimeout(timer);this.ready=message.url;resolve(message.url);}catch{fail(Error('splash_invalid_ready'));}
   });
   child.send({type:'init',nonce,dataDir:this.options.dataDir},error=>{if(error)fail(Error('splash_start_failed'));});
  });
  this.starting=promise;void promise.catch(()=>{if(this.starting===promise)this.starting=undefined;});
  return promise;
 }
 private async createSpace(workspace:URL,title:string){
  // A named command stays idempotent across manual retries and desktop restarts.
  const key='kteam-space-'+createHash('sha256').update(title).digest('hex');
  const headers={Authorization:'Bearer '+workspace.hash.slice('#token='.length)};
  const request=this.options.fetch??fetch;
  const read=(path:string,init?:RequestInit)=>request(new URL(path,workspace),{
   ...init,redirect:'error',signal:AbortSignal.timeout(5000),headers:{...headers,...init?.headers},
  });
  const validId=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9-]{36}$/.test(value);
  let response:Response|undefined;
  try{
   response=await read('/v1/spaces',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify({title})});
  }catch{/* A lost write response is reconciled by a read only. */}
  if(response?.ok){
   const result=await response.json().catch(()=>null);
   if(validId(result?.id)&&result.title===title)return {id:result.id,title};
  }else if(response&&response.status<500){
   throw Error(response.status===429?'splash_create_limited':'splash_create_rejected');
  }
  const operation='/v1/operations?'+new URLSearchParams({kind:'create',key});
  const receipt=await read(operation).then(res=>res.ok?res.json():null).catch(()=>null);
  if(receipt?.status==='complete'&&validId(receipt.spaceId))return {id:receipt.spaceId,title};
  throw Error('splash_create_unknown');
 }
 async open(input:unknown,requestSource:'user'|'agent'|'scheduler'):Promise<SplashOpenResult>{
  if(requestSource!=='user')throw Error('splash_user_only');
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>k!=='requestId'&&k!=='title')
     ||!('requestId' in input)||typeof input.requestId!=='string'||!/^[a-f0-9-]{36}$/.test(input.requestId))throw Error('invalid_splash_input');
  const title='title' in input?splashTitle(input.title):undefined;
  const workspace=validateURL(await this.start());
  if(this.closed)throw Error('splash_closed');
  const space=title===undefined?undefined:await this.createSpace(workspace,title);
  if(this.closed)throw Error('splash_closed');
  if(space)workspace.hash+='&space='+space.id;
  try{await this.options.openExternal(workspace.href);}
  catch(error){if(space)throw Error('splash_created_open_failed');throw error;}
  workspace.hash='';
  return {ok:true,opened:true,mode:'local',url:workspace.href,...(space?{space}:{})};
 }
 async close(){
  this.closed=true;this.ready=undefined;
  const child=this.child;if(!child||child.exitCode!==null||child.signalCode!==null)return;
  await new Promise<void>(resolve=>{
   const timer=setTimeout(()=>{child.kill('SIGKILL');},2000);timer.unref();
   child.once('exit',()=>{clearTimeout(timer);resolve();});
   // Only this owned child is stopped. Parent IPC disconnect is a second cleanup path.
   child.kill('SIGTERM');
  });
 }
}
