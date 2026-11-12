import {test} from 'node:test';
import assert from 'node:assert/strict';
import {processGroup,processBirth,killGroup,groupSpawnOptions,shellInvocation,needsVerbatimArguments,findWindowsCommand,npmShimEntry,parseWindowsTree,ownedByCurrentUser,powershellPath,taskkillPath,WINDOWS_PROCESS_TABLE,type PlatformDeps} from '../src/runtime/platform-process.js';

function fake(platform:NodeJS.Platform,output:string|((file:string,args:string[])=>string),spawnStatus=0){
 const calls:{kind:string;file:string;args:string[];options:any}[]=[];
 const deps:PlatformDeps={platform,env:{SystemRoot:'C:\\Windows'},selfPid:4242,getuid:()=>501,
  exec:(file,args,options)=>{calls.push({kind:'exec',file,args,options});return typeof output==='function'?output(file,args):output;},
  spawnSync:(file,args,options)=>{calls.push({kind:'spawn',file,args,options});return {status:spawnStatus};}};
 return {deps,calls};
}

test('POSIX census keeps the exact ps invocation and group/zombie filtering',()=>{
 const {deps,calls}=fake('darwin',' 100 100 501 S\n 101 100 501 R+\n 102 100 501 Z\n 103 999 501 S\n');
 assert.deepEqual(processGroup(100,deps),[{pid:100,pgid:100,uid:501},{pid:101,pgid:100,uid:501}]);
 assert.equal(calls[0]!.file,'/bin/ps');assert.deepEqual(calls[0]!.args,['-axo','pid=,pgid=,uid=,stat=']);assert.equal(calls[0]!.options.timeout,2000);
 assert.equal(ownedByCurrentUser({pid:1,pgid:1,uid:501},deps),true);assert.equal(ownedByCurrentUser({pid:1,pgid:1,uid:0},deps),false);
});

test('POSIX birth uses ps lstart; Linux takes the same path',()=>{
 const {deps,calls}=fake('linux','Thu Nov 12 09:00:00 2026\n');
 assert.equal(processBirth(77,deps),'Thu Nov 12 09:00:00 2026');assert.deepEqual([calls[0]!.file,...calls[0]!.args],['/bin/ps','-p','77','-o','lstart=']);
});

test('Windows census lists the root and every live descendant via PowerShell CIM, never wmic',()=>{
 const table='4 0\r\n500 4\r\n100 500\r\n101 100\r\n102 101\r\n300 100\r\n900 500\r\n';
 const {deps,calls}=fake('win32',table);
 assert.deepEqual(processGroup(100,deps).map(m=>m.pid),[100,101,300,102]);
 const call=calls[0]!;assert.equal(call.file,powershellPath(deps.env));assert.equal(call.file,'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
 assert.ok(call.args.includes('-NoProfile')&&call.args.includes('-NonInteractive'));assert.equal(call.args.at(-1),WINDOWS_PROCESS_TABLE);
 assert.match(WINDOWS_PROCESS_TABLE,/Get-CimInstance -ClassName Win32_Process/);assert.match(WINDOWS_PROCESS_TABLE,/-ne \$PID/);assert.doesNotMatch(JSON.stringify(calls),/wmic/i);
 assert.equal(call.options.windowsHide,true);assert.deepEqual(call.options.stdio,['ignore','pipe','pipe']);assert.equal(call.options.env.SystemRoot,'C:\\Windows');assert.equal(call.options.env.windir,'C:\\Windows');assert.match(WINDOWS_PROCESS_TABLE,/conhost\.exe/);
 assert.equal(ownedByCurrentUser(processGroup(100,deps)[0]!,{getuid:undefined}),true);
});

test('Windows census still finds orphans after the root exits, and nothing for an unknown root',()=>{
 const {deps}=fake('win32','101 100\n102 101\n7 1\n');
 assert.deepEqual(processGroup(100,deps).map(m=>m.pid),[101,102]);
 assert.deepEqual(processGroup(55,deps),[]);
 assert.deepEqual(parseWindowsTree('garbage\n\n0 0\n',0).map(m=>m.pid),[0]);
});

test('Windows birth reads CreationDate (FILETIME ticks) for exactly one numeric pid',()=>{
 const {deps,calls}=fake('win32','134077284000000000\r\n');
 assert.equal(processBirth(321,deps),'134077284000000000');assert.match(calls[0]!.args.at(-1)!,/ProcessId = 321"/);assert.match(calls[0]!.args.at(-1)!,/ToFileTimeUtc\(\)/);
 assert.throws(()=>processBirth(Number.NaN,deps));assert.throws(()=>processBirth(-1,deps));
});

test('Windows kill stops exactly the verified members (no taskkill /T) and reports ESRCH when nothing is left',()=>{
 const {deps,calls}=fake('win32','100 1 1000\n101 100 1001\n');
 killGroup(100,'SIGTERM',deps);
 assert.deepEqual(calls.map(c=>c.kind),['exec','spawn']);
 const kill=calls[1]!;assert.equal(kill.file,taskkillPath(deps.env));assert.equal(kill.file,'C:\\Windows\\System32\\taskkill.exe');
 assert.deepEqual(kill.args,['/F','/PID','100','/PID','101']);assert.equal(kill.options.windowsHide,true);
 assert.doesNotMatch(JSON.stringify(calls.filter(c=>c.kind==='spawn')),/\/T/);
 // Leader already gone: its orphans are still found through the census and stopped together.
 const orphan=fake('win32','101 100 1001\n102 101 1002\n');killGroup(100,'SIGTERM',orphan.deps,{birth:'1000'});
 assert.deepEqual(orphan.calls.map(c=>c.kind),['exec','spawn']);assert.deepEqual(orphan.calls[1]!.args,['/F','/PID','101','/PID','102']);
 const self=fake('win32','100 1 1000\n101 100 1001\n');killGroup(100,'SIGKILL',self.deps,{exclude:[100]});assert.deepEqual(self.calls.find(c=>c.kind==='spawn')!.args,['/F','/PID','101']);
 const gone=fake('win32','7 1 5\n');assert.throws(()=>killGroup(100,'SIGTERM',gone.deps),(e:any)=>e.code==='ESRCH');assert.equal(gone.calls.filter(c=>c.kind==='spawn').length,0);
});

test('Windows pid reuse: a child older than its parent is not adopted, and a reused leader is never killed',()=>{
 // 101 claims parent 100 but was created before 100 existed: it is a stale ParentProcessId from an older process.
 const stale=fake('win32','100 1 2000\n101 100 1500\n102 100 2001\n103 102 2002\n104 102 1999\n');
 assert.deepEqual(processGroup(100,stale.deps).map(m=>m.pid),[100,102,103]);
 // The recorded leader (born 1000) died; pid 100 now belongs to a stranger born 3000 with its own child 302.
 // Orphans of ours (201, born 1100, and its child 202) are still stopped; the stranger and its child are not.
 const warnings:string[]=[];const reused=fake('win32','100 1 3000\n302 100 3001\n201 100 1100\n202 201 1101\n');reused.deps.warn=m=>warnings.push(m);
 assert.deepEqual(processGroup(100,reused.deps,{birth:'1000'}).map(m=>m.pid),[201,202]);
 assert.match(warnings[0]!,/process 100 was started at 3000, not at the recorded 1000/);
 killGroup(100,'SIGKILL',reused.deps,{birth:'1000'});assert.deepEqual(reused.calls.find(c=>c.kind==='spawn')!.args,['/F','/PID','201','/PID','202']);
 // Only the stranger is left: nothing of ours, so no taskkill at all.
 const only=fake('win32','100 1 3000\n302 100 3001\n');only.deps.warn=()=>{};
 assert.throws(()=>killGroup(100,'SIGTERM',only.deps,{birth:'1000'}),(e:any)=>e.code==='ESRCH');assert.equal(only.calls.filter(c=>c.kind==='spawn').length,0);
 // The same leader identity is accepted as ours.
 const same=fake('win32','100 1 1000\n101 100 1001\n');assert.deepEqual(processGroup(100,same.deps,{birth:'1000'}).map(m=>m.pid),[100,101]);
});

test('Windows census is reused for a moment and dropped by any kill',()=>{
 let now=0;const {deps,calls}=fake('win32','100 1 1000\n');deps.now=()=>now;
 processGroup(100,deps);processGroup(100,deps);assert.equal(calls.filter(c=>c.kind==='exec').length,1);
 now=1000;processGroup(100,deps);assert.equal(calls.filter(c=>c.kind==='exec').length,2);
 killGroup(100,'SIGTERM',deps);processGroup(100,deps);assert.equal(calls.filter(c=>c.kind==='exec').length,3);
 assert.match(WINDOWS_PROCESS_TABLE,/CreationDate/);assert.match(WINDOWS_PROCESS_TABLE,/-Property ProcessId,ParentProcessId,CreationDate,Name/);
});

test('POSIX kill is still kill(-pgid, signal)',()=>{
 const {deps,calls}=fake('darwin','');const original=process.kill;const seen:any[]=[];
 (process as any).kill=(pid:number,signal:string)=>{seen.push([pid,signal]);return true;};
 try{killGroup(123,'SIGTERM',deps);killGroup(123,'SIGKILL',deps);}finally{(process as any).kill=original;}
 assert.deepEqual(seen,[[-123,'SIGTERM'],[-123,'SIGKILL']]);assert.equal(calls.length,0);
});

test('group spawn options: detached POSIX group, no detached on Windows, always hidden',()=>{
 assert.deepEqual(groupSpawnOptions('darwin'),{detached:true,windowsHide:true});
 assert.deepEqual(groupSpawnOptions('linux'),{detached:true,windowsHide:true});
 assert.deepEqual(groupSpawnOptions('win32'),{detached:false,windowsHide:true});
});

test('shell: /bin/sh -c on POSIX, cmd /d /s /c with verbatim quoting on Windows',()=>{
 assert.deepEqual(shellInvocation('echo hi','darwin'),{command:'/bin/sh',args:['-c','echo hi']});
 assert.deepEqual(shellInvocation('echo hi','win32',{ComSpec:'C:\\Windows\\system32\\cmd.exe'}),{command:'C:\\Windows\\system32\\cmd.exe',args:['/d','/s','/c','"echo hi"'],windowsVerbatimArguments:true});
 assert.equal(shellInvocation('dir','win32',{SystemRoot:'D:\\Win'}).command,'D:\\Win\\System32\\cmd.exe');
 assert.equal(needsVerbatimArguments('C:\\Windows\\system32\\cmd.exe','win32'),true);assert.equal(needsVerbatimArguments('CMD','win32'),true);
 assert.equal(needsVerbatimArguments('C:\\tools\\codex.exe','win32'),false);assert.equal(needsVerbatimArguments('/bin/cmd.exe','darwin'),false);
});

test('Windows command lookup follows PATHEXT and resolves npm .cmd shims to their JS entry',()=>{
 const files=new Set(['C:\\npm\\codex.cmd','C:\\npm\\node_modules\\@openai\\codex\\bin\\codex.js','C:\\bin\\kimi.exe','C:\\bin\\kimi.cmd','C:\\bad\\zcode.bat']);
 const shims:Record<string,string>={'C:\\npm\\codex.cmd':'@ECHO off\r\nGOTO start\r\n:start\r\n"%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n','C:\\bad\\zcode.bat':'@echo off\r\nzcode-real %1\r\n'};
 const exists=(p:string)=>files.has(p),read=(p:string)=>{const v=shims[p];if(v===undefined)throw Error('ENOENT');return v;};
 const env={PATHEXT:'.COM;.EXE;.BAT;.CMD'};
 assert.equal(findWindowsCommand('C:\\npm','codex',env,exists,read),'C:\\npm\\node_modules\\@openai\\codex\\bin\\codex.js');
 assert.equal(findWindowsCommand('C:\\bin','kimi',env,exists,read),'C:\\bin\\kimi.exe');
 assert.equal(findWindowsCommand('C:\\bad','zcode',env,exists,read),undefined);
 assert.equal(findWindowsCommand('C:\\none','codex',env,exists,read),undefined);
 assert.equal(npmShimEntry('C:\\x\\a.cmd',()=>'"%~dp0\\node_modules\\a\\cli.mjs" %*'),'C:\\x\\node_modules\\a\\cli.mjs');
});

test('host address: unix socket in the data dir on POSIX, one named pipe per data dir on Windows',async()=>{
 const {socketPath}=await import('../src/service/config.js');
 const real=Object.getOwnPropertyDescriptor(process,'platform')!;
 if(process.platform!=='win32')assert.equal(socketPath('/tmp/kteam-a'),'/tmp/kteam-a/host.sock');
 Object.defineProperty(process,'platform',{...real,value:'win32'});
 try{
  const a=socketPath('C:\\Users\\me\\.kteam'),b=socketPath('c:\\users\\ME\\.kteam'),c=socketPath('C:\\Users\\other\\.kteam');
  assert.match(a,/^\\\\\.\\pipe\\kteam-host-[a-f0-9]{32}$/);
  if(real.value==='win32')assert.equal(a,b);
  assert.notEqual(a,c);
 }finally{Object.defineProperty(process,'platform',real);}
});

test('Agent environment keeps the Windows system variables PowerShell/CIM and CLIs need (paths only)',{skip:process.platform!=='win32'?'only meaningful where process.env carries Windows system variables':false},async()=>{
 const {nativeEnvironment,WINDOWS_SYSTEM_ENV}=await import('../src/runtime/local-agents.js');const env=nativeEnvironment();
 for(const name of ['windir','SystemDrive','ComSpec','PATHEXT','SystemRoot'])if(process.env[name])assert.equal(env[name],process.env[name],name);
 assert.ok(WINDOWS_SYSTEM_ENV.every(name=>!/token|key|secret|pass/i.test(name)));
});
