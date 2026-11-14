import {spawn,type ChildProcess} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {lstatSync,readFileSync} from 'node:fs';

export function splashEnvironment(env:NodeJS.ProcessEnv){
 const names=['SystemRoot','WINDIR','TEMP','TMP','TMPDIR','LANG','TZ'];
 return {...Object.fromEntries(names.filter(name=>env[name]!==undefined).map(name=>[name,env[name]])),ELECTRON_RUN_AS_NODE:'1'};
}
function validateURL(value:unknown){
 if(typeof value!=='string')throw Error('splash_invalid_ready');
 const u=new URL(value);
 if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||!u.port||u.pathname!=='/splash'||u.search||u.username||u.password||!/^#token=[A-Za-z0-9_-]{43}$/.test(u.hash))throw Error('splash_invalid_ready');
 return u;
}
export class SplashService {
 private child?:ChildProcess; private starting?:Promise<string>;private ready?:string;private closed=false;
 constructor(private readonly options:{runtime:string;sha256:string;dataDir:string;executable?:string;openExternal:(url:string)=>Promise<unknown>;timeoutMs?:number}){}
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
 async open(input:unknown,requestSource:'user'|'agent'|'scheduler'){
  if(requestSource!=='user')throw Error('splash_user_only');
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>k!=='requestId')||typeof (input as any).requestId!=='string'||!/^[a-f0-9-]{36}$/.test((input as any).requestId))throw Error('invalid_splash_input');
  const url=await this.start();if(this.closed)throw Error('splash_closed');
  await this.options.openExternal(url);
  const safe=validateURL(url);safe.hash='';
  return {ok:true as const,opened:true as const,mode:'local' as const,url:safe.href};
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
