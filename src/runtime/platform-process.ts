import{windowsProcessObservation}from'./windows-process-observer.js';
import{execFileSync,spawnSync}from'node:child_process';import{existsSync,readFileSync,statSync}from'node:fs';import{win32}from'node:path';
/**
 * KTeam's process platform layer. POSIX keeps the exact process-group semantics KTeam has always used
 * (ps census, kill(-pgid), /bin/sh). Windows has no process groups: a "group" is the recorded root pid and
 * every live descendant (Win32_Process via PowerShell CIM, no wmic), and it is stopped with taskkill /T /F.
 */
export interface ProcessMember{pid:number;pgid:number;uid?:number;birth?:string}
export interface PlatformDeps{nativeObservation?:boolean;platform:NodeJS.Platform;exec:(file:string,args:string[],options:any)=>string;spawnSync:(file:string,args:string[],options:any)=>{status:number|null;error?:Error|undefined};env:NodeJS.ProcessEnv;selfPid:number;getuid:(()=>number)|undefined;now?:()=>number;warn?:(message:string)=>void}
export const defaultDeps=():PlatformDeps=>({nativeObservation:true,platform:process.platform,exec:(file,args,options)=>String(execFileSync(file,args,options)),spawnSync:(file,args,options)=>spawnSync(file,args,options),env:process.env,selfPid:process.pid,getuid:process.getuid?.bind(process),now:Date.now,warn:message=>process.emitWarning(message,{code:'KTEAM_PROCESS_IDENTITY'})});
let shared:PlatformDeps|undefined;
/** One deps object per process so the short Windows census cache is shared by every default caller. */
export const sharedDeps=()=>shared??=defaultDeps();
const posixCensus={encoding:'utf8' as const,timeout:2000,maxBuffer:4*1024*1024};
// PowerShell starts slowly on a cold Windows machine; 2s (the ps budget) is not enough there.
// stdin is closed: Windows PowerShell can wait forever on an open stdin pipe even with -Command.
const windowsCensus={encoding:'utf8' as const,timeout:20000,maxBuffer:16*1024*1024,windowsHide:true,stdio:['ignore','pipe','pipe']};
const systemRoot=(env:NodeJS.ProcessEnv)=>env.SystemRoot??env.SYSTEMROOT??'C:\\Windows';
export const powershellPath=(env:NodeJS.ProcessEnv=process.env)=>win32.join(systemRoot(env),'System32','WindowsPowerShell','v1.0','powershell.exe');
export const taskkillPath=(env:NodeJS.ProcessEnv=process.env)=>win32.join(systemRoot(env),'System32','taskkill.exe');
/** The census must not inherit a reduced Agent environment: CIM without SystemRoot/windir is very slow on Windows. */
const censusEnv=(env:NodeJS.ProcessEnv)=>({...env,SystemRoot:systemRoot(env),windir:env.windir??env.WINDIR??systemRoot(env)});
const powershell=(deps:PlatformDeps,script:string)=>deps.exec(powershellPath(deps.env),['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',script],{...windowsCensus,env:censusEnv(deps.env)});
/**
 * `pid ppid creation` for every process except the PowerShell doing the census and console hosts (conhost.exe
 * belongs to a console, not to the work, and exits with it). creation is CreationDate as UTC FILETIME ticks (0 when
 * Windows does not report one). Only the three properties are fetched: the full Win32_Process object is what made
 * the census slow.
 */
export const WINDOWS_PROCESS_TABLE="Get-CimInstance -ClassName Win32_Process -Property ProcessId,ParentProcessId,CreationDate,Name | Where-Object { $_.ProcessId -ne $PID -and $_.Name -ne 'conhost.exe' } | ForEach-Object { [string]$_.ProcessId + ' ' + [string]$_.ParentProcessId + ' ' + $(if ($_.CreationDate) { [string]$_.CreationDate.ToFileTimeUtc() } else { '0' }) }";
/**
 * One census serves every caller for a short moment (a stop loop asks "who is left?" right after it asked the same
 * thing to kill them); each PowerShell start costs seconds on a cold Windows runner. Any kill clears it.
 */
const SNAPSHOT_TTL_MS=250;let snapshot:{at:number;text:string;deps:PlatformDeps}|undefined;
function windowsTable(deps:PlatformDeps){const native=deps.nativeObservation?windowsProcessObservation([]):undefined;if(native!==undefined)return native;const now=deps.now?.()??Date.now();if(snapshot&&snapshot.deps===deps&&now-snapshot.at>=0&&now-snapshot.at<SNAPSHOT_TTL_MS)return snapshot.text;const text=powershell(deps,WINDOWS_PROCESS_TABLE);snapshot={at:deps.now?.()??Date.now(),text,deps};return text;}
export const forgetWindowsSnapshot=()=>{snapshot=undefined;};
export function parsePosixGroup(text:string,pgid:number):ProcessMember[]{return text.split('\n').map(l=>l.trim().split(/\s+/)).filter(p=>Number(p[1])===pgid&&!p[3]?.startsWith('Z')).map(p=>({pid:Number(p[0]),pgid:Number(p[1]),uid:Number(p[2])}));}
const ticks=(value:string|undefined)=>{
 if(!value)return undefined;
 if(/^\d+$/.test(value)){const n=BigInt(value);return n>0n?n:undefined;}
 // Previous installed hosts stored the same CIM creation time as an ISO token.
 // Normalize its exact remaining microseconds; malformed legacy identities stay unknown.
 if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{7}Z$/.test(value))return undefined;
 const ms=Date.parse(value);if(!Number.isSafeInteger(ms)||new Date(ms).toISOString()!==value.slice(0,23)+'Z')return undefined;
 const n=(BigInt(ms)+11644473600000n)*10000n+BigInt(value.slice(23,27));return n>0n?n:undefined;
};
export const sameProcessBirth=(actual:string|undefined,recorded:string|undefined,platform:NodeJS.Platform=process.platform)=>platform==='win32'?ticks(actual)!==undefined&&ticks(actual)===ticks(recorded):!!actual&&actual===recorded;
export interface TreeIdentity{birth?:string|undefined;onMismatch?:((message:string)=>void)|undefined}
/**
 * The root (if alive and still the process KTeam started) and its live descendants. Windows reuses pids and keeps a
 * dead parent's pid in ParentProcessId, so ParentProcessId alone can adopt strangers: a child only belongs to a
 * parent that already existed when the child was created (CreationDate child >= parent).
 * - `birth` (FILETIME ticks recorded at spawn) pins the root. If the live root has another CreationDate the pid was
 *   reused: the stranger and anything it created are excluded; only orphans created between our root's birth and
 *   the stranger's are still ours.
 * - Without `birth`, a live root is trusted as is (the caller holds it), and a dead root's orphans are accepted.
 */
export function parseWindowsTree(text:string,root:number,identity:TreeIdentity={}):ProcessMember[]{
 const children=new Map<number,number[]>(),created=new Map<number,bigint|undefined>(),raw=new Map<number,string>();
 for(const line of text.split(/\r?\n/)){const [a,b,c]=line.trim().split(/\s+/);const pid=Number(a),ppid=Number(b);if(!a||!b||!Number.isInteger(pid)||!Number.isInteger(ppid))continue;created.set(pid,ticks(c));if(c)raw.set(pid,c);if(pid===ppid)continue;children.set(ppid,[...(children.get(ppid)??[]),pid]);}
 const recorded=ticks(identity.birth),rootAlive=created.has(root),rootNow=created.get(root);
 if(recorded!==undefined&&rootAlive&&rootNow===undefined)throw Error('process_identity_unconfirmed');
 const reused=rootAlive&&recorded!==undefined&&rootNow!==recorded;
 if(reused)identity.onMismatch?.(`process ${root} was started at ${raw.get(root)??'unknown'}, not at the recorded ${identity.birth}; it is not KTeam's and will not be stopped`);
 const found:ProcessMember[]=[];if(rootAlive&&!reused)found.push({pid:root,pgid:root,...(raw.get(root)?{birth:raw.get(root)!}:{})});
 // Window [from, until) a direct child of the root must have been created in.
 const from=recorded??(rootAlive?rootNow:undefined),until=reused?rootNow:undefined;
 const seen=new Set<number>([root]),queue:Array<{pid:number;since:bigint|undefined;until:bigint|undefined}>=[{pid:root,since:from,until}];
 while(queue.length){const next=queue.shift()!;for(const pid of children.get(next.pid)??[]){if(seen.has(pid))continue;const at=created.get(pid);
  if(next.since!==undefined&&at===undefined)throw Error('process_identity_unconfirmed');
  if(next.since!==undefined&&at!==undefined&&at<next.since)continue;if(next.until!==undefined&&at!==undefined&&at>=next.until)continue;
  seen.add(pid);found.push({pid,pgid:root,...(raw.get(pid)?{birth:raw.get(pid)!}:{})});queue.push({pid,since:at,until:undefined});}}
 return found;
}
/** Live, non-zombie members of the group KTeam created with `pgid` as its leader. */
export function processGroup(pgid:number,deps:PlatformDeps=sharedDeps(),identity:{birth?:string|undefined}={}):ProcessMember[]{
 if(deps.platform==='win32'){if(identity.birth!==undefined&&ticks(identity.birth)===undefined)throw Error('process_identity_unconfirmed');return parseWindowsTree(windowsTable(deps),pgid,{birth:identity.birth,onMismatch:deps.warn});}
 return parsePosixGroup(deps.exec('/bin/ps',['-axo','pid=,pgid=,uid=,stat='],posixCensus),pgid);
}
/**
 * A member is ours when its uid matches. Windows records no uid here (Win32_Process lists every user's processes),
 * so on Windows ownership rests on the recorded tree and CreationDate identity checks, not on this predicate.
 * TODO(0.5): compare the process owner SID (GetOwner) on Windows as well.
 */
export const ownedByCurrentUser=(member:ProcessMember,deps:Pick<PlatformDeps,'getuid'>=defaultDeps())=>member.uid===undefined||member.uid===deps.getuid?.();
/** Process start identity used to detect pid reuse. Windows: CreationDate as UTC FILETIME ticks, empty when gone. */
export function processBirth(pid:number,deps:PlatformDeps=sharedDeps()):string{
 if(!Number.isSafeInteger(pid)||pid<=0)throw new Error('invalid_pid');
 if(deps.platform==='win32')return (deps.nativeObservation?windowsProcessObservation(['birth',String(pid)]):undefined)??powershell(deps,`$p = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = ${pid}"; if ($p -and $p.CreationDate) { [string]$p.CreationDate.ToFileTimeUtc() }`).trim();
 return deps.exec('/bin/ps',['-p',String(pid),'-o','lstart='],{encoding:'utf8',timeout:2000}).trim();
}
const missing=()=>Object.assign(new Error('process_group_missing'),{code:'ESRCH'});
/**
 * Signal the whole group. POSIX: kill(-pgid, signal), unchanged. Windows has no graceful signal for console
 * trees, so both SIGTERM and SIGKILL force-stop every live member; callers still confirm with processGroup().
 * Windows never uses taskkill /T: /T follows ParentProcessId alone and would reach a stranger that reused the
 * leader's pid. Instead the members are the census tree checked against CreationDate (and the recorded `birth`),
 * and exactly those pids are stopped. Throws code ESRCH when nothing of ours is left to stop.
 */
export function killGroup(pgid:number,signal:NodeJS.Signals,deps:PlatformDeps=sharedDeps(),options:{exclude?:number[];birth?:string|undefined}={}){
 if(deps.platform!=='win32'){process.kill(-pgid,signal);return;}
 forgetWindowsSnapshot();
 const members=processGroup(pgid,deps,{birth:options.birth}).filter(m=>!options.exclude?.includes(m.pid));
 if(!members.length)throw missing();
 forgetWindowsSnapshot();
 const result=deps.spawnSync(taskkillPath(deps.env),['/F',...members.flatMap(m=>['/PID',String(m.pid)])],{stdio:'ignore',windowsHide:true,timeout:20000});
 if(result.error)throw Object.assign(new Error('process_kill_failed'),{code:'EPERM',cause:result.error});
 // Nonzero also covers members that exited between census and taskkill; the caller re-checks the group.
}
/** spawn() options for a launcher that must own its descendants: a new POSIX group; Windows has none. */
// The hidden IPC launcher must survive host death to reap its shell grandchildren.
export const groupSpawnOptions=(_platform:NodeJS.Platform=process.platform)=>({detached:true,windowsHide:true});
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
