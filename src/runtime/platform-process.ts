import{execFileSync,spawnSync}from'node:child_process';import{existsSync,readFileSync,statSync}from'node:fs';import{win32}from'node:path';
/**
 * KTeam's process platform layer. POSIX keeps the exact process-group semantics KTeam has always used
 * (ps census, kill(-pgid), /bin/sh). Windows has no process groups: a "group" is the recorded root pid and
 * every live descendant (Win32_Process via PowerShell CIM, no wmic), and it is stopped with taskkill /T /F.
 */
export interface ProcessMember{pid:number;pgid:number;uid?:number}
export interface PlatformDeps{platform:NodeJS.Platform;exec:(file:string,args:string[],options:any)=>string;spawnSync:(file:string,args:string[],options:any)=>{status:number|null;error?:Error|undefined};env:NodeJS.ProcessEnv;selfPid:number;getuid:(()=>number)|undefined}
export const defaultDeps=():PlatformDeps=>({platform:process.platform,exec:(file,args,options)=>String(execFileSync(file,args,options)),spawnSync:(file,args,options)=>spawnSync(file,args,options),env:process.env,selfPid:process.pid,getuid:process.getuid?.bind(process)});
const posixCensus={encoding:'utf8' as const,timeout:2000,maxBuffer:4*1024*1024};
// PowerShell starts slowly on a cold Windows machine; 2s (the ps budget) is not enough there.
// stdin is closed: Windows PowerShell can wait forever on an open stdin pipe even with -Command.
const windowsCensus={encoding:'utf8' as const,timeout:20000,maxBuffer:16*1024*1024,windowsHide:true,stdio:['ignore','pipe','pipe']};
const systemRoot=(env:NodeJS.ProcessEnv)=>env.SystemRoot??env.SYSTEMROOT??'C:\\Windows';
export const powershellPath=(env:NodeJS.ProcessEnv=process.env)=>win32.join(systemRoot(env),'System32','WindowsPowerShell','v1.0','powershell.exe');
export const taskkillPath=(env:NodeJS.ProcessEnv=process.env)=>win32.join(systemRoot(env),'System32','taskkill.exe');
const powershell=(deps:PlatformDeps,script:string)=>deps.exec(powershellPath(deps.env),['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',script],windowsCensus);
/** `pid ppid` for every process except the PowerShell doing the census and console hosts (conhost.exe belongs
 * to a console, not to the work, and exits with it). */
export const WINDOWS_PROCESS_TABLE="Get-CimInstance -ClassName Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.Name -ne 'conhost.exe' } | ForEach-Object { [string]$_.ProcessId + ' ' + [string]$_.ParentProcessId }";
export function parsePosixGroup(text:string,pgid:number):ProcessMember[]{return text.split('\n').map(l=>l.trim().split(/\s+/)).filter(p=>Number(p[1])===pgid&&!p[3]?.startsWith('Z')).map(p=>({pid:Number(p[0]),pgid:Number(p[1]),uid:Number(p[2])}));}
/** The root pid (if alive) and all of its live descendants. Orphans keep their dead parent's pid as ParentProcessId. */
export function parseWindowsTree(text:string,root:number):ProcessMember[]{
 const children=new Map<number,number[]>(),alive=new Set<number>();
 for(const line of text.split(/\r?\n/)){const [a,b]=line.trim().split(/\s+/);const pid=Number(a),ppid=Number(b);if(!Number.isInteger(pid)||!Number.isInteger(ppid)||!a||!b)continue;alive.add(pid);if(pid===ppid)continue;children.set(ppid,[...(children.get(ppid)??[]),pid]);}
 const found:number[]=[],seen=new Set<number>([root]),queue=[root];if(alive.has(root))found.push(root);
 while(queue.length){const next=queue.shift()!;for(const pid of children.get(next)??[]){if(seen.has(pid))continue;seen.add(pid);found.push(pid);queue.push(pid);}}
 return found.map(pid=>({pid,pgid:root}));
}
/** Live, non-zombie members of the group KTeam created with `pgid` as its leader. */
export function processGroup(pgid:number,deps:PlatformDeps=defaultDeps()):ProcessMember[]{
 if(deps.platform==='win32')return parseWindowsTree(powershell(deps,WINDOWS_PROCESS_TABLE),pgid);
 return parsePosixGroup(deps.exec('/bin/ps',['-axo','pid=,pgid=,uid=,stat='],posixCensus),pgid);
}
/** A member is ours when its uid matches; Windows lists only processes it can see and records no uid. */
export const ownedByCurrentUser=(member:ProcessMember,deps:Pick<PlatformDeps,'getuid'>=defaultDeps())=>member.uid===undefined||member.uid===deps.getuid?.();
/** Process start identity used to detect pid reuse. Empty when the process is gone (Windows). */
export function processBirth(pid:number,deps:PlatformDeps=defaultDeps()):string{
 if(!Number.isSafeInteger(pid)||pid<=0)throw new Error('invalid_pid');
 if(deps.platform==='win32')return powershell(deps,`$p = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = ${pid}"; if ($p) { $p.CreationDate.ToUniversalTime().ToString('o') }`).trim();
 return deps.exec('/bin/ps',['-p',String(pid),'-o','lstart='],{encoding:'utf8',timeout:2000}).trim();
}
const missing=()=>Object.assign(new Error('process_group_missing'),{code:'ESRCH'});
/**
 * Signal the whole group. POSIX: kill(-pgid, signal), unchanged. Windows has no graceful signal for console
 * trees, so both SIGTERM and SIGKILL force-stop every live member (taskkill /T /F); callers still confirm with
 * processGroup(). Throws code ESRCH when nothing is left to stop.
 */
export function killGroup(pgid:number,signal:NodeJS.Signals,deps:PlatformDeps=defaultDeps(),options:{exclude?:number[]}={}){
 if(deps.platform!=='win32'){process.kill(-pgid,signal);return;}
 const taskkill=(pids:number[])=>deps.spawnSync(taskkillPath(deps.env),['/T','/F',...pids.flatMap(pid=>['/PID',String(pid)])],{stdio:'ignore',windowsHide:true,timeout:20000});
 // Fast path (no census): the leader is alive, so /T reaches every descendant still parented under it.
 if(!options.exclude?.length){const direct=taskkill([pgid]);if(direct.error)throw Object.assign(new Error('process_kill_failed'),{code:'EPERM',cause:direct.error});if(direct.status===0)return;}
 // Leader gone (or must be spared): find orphans by their recorded parent chain.
 const members=processGroup(pgid,deps).filter(m=>!options.exclude?.includes(m.pid));if(!members.length)throw missing();
 const result=taskkill(members.map(m=>m.pid));
 if(result.error)throw Object.assign(new Error('process_kill_failed'),{code:'EPERM',cause:result.error});
 // Nonzero also covers members that exited between census and taskkill; the caller re-checks the group.
}
/** spawn() options for a launcher that must own its descendants: a new POSIX group; Windows has none. */
export const groupSpawnOptions=(platform:NodeJS.Platform=process.platform)=>platform==='win32'?{detached:false,windowsHide:true}:{detached:true,windowsHide:true};
export interface ShellInvocation{command:string;args:string[];windowsVerbatimArguments?:boolean}
/** The system shell for one command line. Windows mirrors Node's own `shell:true` (cmd /d /s /c "..."). */
export function shellInvocation(commandLine:string,platform:NodeJS.Platform=process.platform,env:NodeJS.ProcessEnv=process.env):ShellInvocation{
 if(platform==='win32')return {command:env.ComSpec??env.COMSPEC??win32.join(systemRoot(env),'System32','cmd.exe'),args:['/d','/s','/c','"'+commandLine+'"'],windowsVerbatimArguments:true};
 return {command:'/bin/sh',args:['-c',commandLine]};
}
/** cmd.exe needs verbatim arguments; every other program uses normal Windows quoting. */
export const needsVerbatimArguments=(command:string,platform:NodeJS.Platform=process.platform)=>platform==='win32'&&/^cmd(?:\.exe)?$/i.test(win32.basename(command));
/**
 * Windows command lookup inside one PATH directory, same order as where.exe (PATHEXT). npm's .cmd shims are
 * resolved to their JavaScript entry so the program runs under Node without cmd.exe re-parsing user text;
 * a batch file KTeam cannot resolve that way is not used.
 */
export function findWindowsCommand(directory:string,name:string,env:NodeJS.ProcessEnv=process.env,exists:(p:string)=>boolean=isFile,read:(p:string)=>string=p=>readFileSync(p,'utf8')):string|undefined{
 const extensions=(env.PATHEXT??'.COM;.EXE;.BAT;.CMD').split(';').map(e=>e.trim().toLowerCase()).filter(e=>/^\.[a-z0-9]+$/.test(e));
 for(const ext of extensions){const path=win32.join(directory,name+ext);if(!exists(path))continue;if(ext==='.exe'||ext==='.com')return path;if(ext==='.cmd'||ext==='.bat'){const entry=npmShimEntry(path,read);if(entry&&exists(entry))return entry;}}
 return undefined;
}
export function npmShimEntry(shim:string,read:(p:string)=>string=p=>readFileSync(p,'utf8')):string|undefined{
 let text:string;try{text=read(shim);}catch{return undefined;}
 const match=/"(?:%~dp0|%dp0%)\\?([^"%]+?\.[cm]?js)"\s+%\*/i.exec(text);if(!match)return undefined;
 return win32.resolve(win32.dirname(shim),match[1]!);
}
function isFile(path:string){try{return existsSync(path)&&statSync(path).isFile();}catch{return false;}}
