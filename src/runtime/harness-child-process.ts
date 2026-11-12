import * as childProcess from 'node:child_process';
export {ChildProcess} from 'node:child_process';
import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
import {promisify} from 'node:util';
import {resolve} from 'node:path';
import {harnessGroup} from './harness-process.js';
import {groupSpawnOptions,processBirth,shellInvocation} from './platform-process.js';
import {nativeEnvironment} from './local-agents.js';
import {KTeamError} from '../errors.js';
interface ProcessOwner {cwd:string;signal:AbortSignal;assertCurrent:()=>Promise<void>;record:(value:any)=>void|Promise<void>}
const symbol=Symbol.for('kteam.harness.child-owner');
const globals=globalThis as any;
const owners:AsyncLocalStorage<ProcessOwner|undefined>=globals[symbol]??=new AsyncLocalStorage();
export const withHarnessProcessOwner=<T>(owner:ProcessOwner|undefined,work:()=>T):T=>owners.run(owner,work);
export const captureHarnessProcessOwner=()=>owners.getStore();
export function spawn(command:string,argsOrOptions:any[]=[],maybeOptions:any={}){
 const owner=owners.getStore();if(!owner)return (childProcess.spawn as any)(command,argsOrOptions,maybeOptions);
 if(isCensus(command,Array.isArray(argsOrOptions)?argsOrOptions:[]))return childProcess.spawn(command,argsOrOptions,censusOptions());
 owner.signal.throwIfAborted();
 const args=Array.isArray(argsOrOptions)?argsOrOptions:[],options=Array.isArray(argsOrOptions)?maybeOptions:argsOrOptions;

 const stdio=options.stdio??'pipe';if(stdio!=='pipe'&&(!Array.isArray(stdio)||stdio.length!==3||stdio.some((s:any)=>s!=='pipe'&&s!=='ignore'&&s!=='inherit')))throw new KTeamError('harness_stdio_unavailable');
 const tuple=stdio==='pipe'?['pipe','pipe','pipe']:stdio;
 const launcher=process.env.KTEAM_NATIVE_CHILD??resolve('dist/src/runtime/native-child.js');
 const child=childProcess.spawn(process.execPath,[launcher],{...options,shell:false,cwd:options.cwd??owner.cwd,env:{...nativeEnvironment(),...(process.versions.electron?{ELECTRON_RUN_AS_NODE:'1'}:{})},...groupSpawnOptions(),stdio:[...tuple,'ipc']});
 const invocationId='platform-'+randomUUID();let identity:any,started=false;
 const stop=()=>{child.kill('SIGTERM');};owner.signal.addEventListener('abort',stop,{once:true});
 child.once('spawn',()=>{void(async()=>{try{
  const pid=child.pid!;identity={invocationId,pid,pgid:pid,uid:process.getuid?.(),state:'preparing'};await owner.record(identity);await owner.assertCurrent();owner.signal.throwIfAborted();
  const birth=processBirth(pid);if(!birth)throw new KTeamError('native_process_identity_missing');identity={...identity,birth,state:'running'};await owner.record(identity);await owner.assertCurrent();owner.signal.throwIfAborted();
  if(!child.connected)throw new KTeamError('native_start_failed');
  started=true;const shell=options.shell?shellInvocation([command,...args].join(' ')):undefined;child.send({type:'start',command:shell?shell.command:command,args:shell?shell.args:args,cwd:options.cwd??owner.cwd,env:{...nativeEnvironment(),...(options.env??{})},inheritStdin:tuple[0]!=='ignore'});
 }catch(error){stop();child.emit('error',error);}})();});
 child.once('close',()=>{owner.signal.removeEventListener('abort',stop);void(async()=>{let stopped=false;try{stopped=!child.pid||harnessGroup(child.pid).length===0;}catch{}await owner.record({...identity,invocationId,state:stopped?'stopped':'unknown',stopConfirmed:stopped,started});})().catch(()=>{});});
 return child;
}
export function execFile(file:string,argsOrOptions:any[]=[],optionsOrCallback:any={},maybeCallback?:any):any{
 if(!owners.getStore())return (childProcess.execFile as any)(file,argsOrOptions,optionsOrCallback,maybeCallback);
 const args=Array.isArray(argsOrOptions)?argsOrOptions:[],options=typeof optionsOrCallback==='object'?optionsOrCallback:typeof argsOrOptions==='object'&&!Array.isArray(argsOrOptions)?argsOrOptions:{};
 const callback=typeof maybeCallback==='function'?maybeCallback:typeof optionsOrCallback==='function'?optionsOrCallback:typeof argsOrOptions==='function'?argsOrOptions:()=>{};
 const child=spawn(file,args,{...options,stdio:'pipe'});const chunks:{stdout:Buffer[];stderr:Buffer[]}={stdout:[],stderr:[]};let size=0,limited=false,error:any,programCode:number|null|undefined;
 const timer=options.timeout?setTimeout(()=>{error=new KTeamError('native_timeout');child.kill('SIGTERM');},options.timeout):undefined;
 const encoding=options.encoding==='buffer'||options.encoding===null?null:options.encoding??'utf8';
 const append=(name:'stdout'|'stderr',data:Buffer)=>{if(limited)return;const remaining=Math.max(0,(options.maxBuffer??1024*1024)-size);if(remaining){const part=data.subarray(0,remaining);chunks[name].push(part);size+=part.length;}if(data.length>remaining){limited=true;error=new KTeamError('native_output_limit');child.kill('SIGTERM');}};
 child.stdout?.on('data',(data:Buffer)=>append('stdout',data));child.stderr?.on('data',(data:Buffer)=>append('stderr',data));child.on('message',(m:any)=>{if(m?.type==='native-exit')programCode=m.code;});child.once('error',(value:Error)=>{error=value;});child.once('close',(code:number|null,signal:NodeJS.Signals|null)=>{if(timer)clearTimeout(timer);const actual=programCode===undefined?code:programCode;if(actual!==0)error??=Object.assign(Error('Command failed'),{code:actual,signal});const stdout=Buffer.concat(chunks.stdout),stderr=Buffer.concat(chunks.stderr);callback(error??null,encoding?stdout.toString(encoding):stdout,encoding?stderr.toString(encoding):stderr);});return child;
}
Object.defineProperty(execFile,promisify.custom,{value:(...args:any[])=>new Promise((resolve,reject)=>execFile(args[0],args[1]??[],args[2]??{},(error:any,stdout:any,stderr:any)=>error?reject(Object.assign(error,{stdout,stderr})):resolve({stdout,stderr})))});
export function exec(command:string,options?:any,callback?:any):any{const shell=shellInvocation(command);return owners.getStore()?execFile(shell.command,shell.args,typeof options==='function'?{}:options,typeof options==='function'?options:callback):(childProcess.exec as any)(command,options,callback);}
export const execSync:typeof childProcess.execSync=((...args:any[])=>{if(owners.getStore())throw new KTeamError('harness_sync_process_unavailable');return (childProcess.execSync as any)(...args);}) as any;
export const execFileSync:typeof childProcess.execFileSync=((...args:any[])=>{if(owners.getStore()){if(!isCensus(args[0],args[1]??[]))throw new KTeamError('harness_sync_process_unavailable');return childProcess.execFileSync(args[0],args[1],censusOptions());}return (childProcess.execFileSync as any)(...args);}) as any;
export const spawnSync:typeof childProcess.spawnSync=((...args:any[])=>{if(owners.getStore()){if(!isCensus(args[0],args[1]??[]))throw new KTeamError('harness_sync_process_unavailable');return childProcess.spawnSync(args[0],args[1],censusOptions());}return (childProcess.spawnSync as any)(...args);}) as any;
export const fork:typeof childProcess.fork=((...args:any[])=>{if(owners.getStore())throw new KTeamError('harness_fork_unavailable');return (childProcess.fork as any)(...args);}) as any;
export default {...childProcess,spawn,execFile,exec,execSync,execFileSync,spawnSync,fork};

function censusOptions(){return {encoding:'utf8' as const,env:{PATH:'/usr/bin:/bin',LC_ALL:'C'},stdio:'pipe' as const,timeout:2000,maxBuffer:4*1024*1024};}
function isCensus(command:string,args:any[]){
 if(command==='/bin/ls')return args.length>1&&args[0]==='-lde'&&args.slice(1).every(path=>typeof path==='string'&&(path==='/'||path==='/Library'||path==='/Library/Application Support'||path==='/var'||path==='/var/lib'||path==='/Library/Application Support/kteam-verification'||path==='/var/lib/kteam-verification'||path.startsWith('/Library/Application Support/kteam-verification/')||path.startsWith('/var/lib/kteam-verification/'))&&!path.split('/').includes('..'));
 return command==='/bin/ps'&&args.length>0&&args.every(arg=>typeof arg==='string'&&(/^\d+$/.test(arg)||['-axo','-eo','-p','-o','-g','--no-headers','--ppid'].includes(arg)||arg.split(',').every(field=>['pid=','ppid=','pgid=','uid=','stat=','lstart='].includes(field))));
}
