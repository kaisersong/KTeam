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
 assert.equal(call.options.windowsHide,true);assert.deepEqual(call.options.stdio,['ignore','pipe','pipe']);assert.match(WINDOWS_PROCESS_TABLE,/conhost\.exe/);
 assert.equal(ownedByCurrentUser(processGroup(100,deps)[0]!,{getuid:undefined}),true);
});

test('Windows census still finds orphans after the root exits, and nothing for an unknown root',()=>{
 const {deps}=fake('win32','101 100\n102 101\n7 1\n');
 assert.deepEqual(processGroup(100,deps).map(m=>m.pid),[101,102]);
 assert.deepEqual(processGroup(55,deps),[]);
 assert.deepEqual(parseWindowsTree('garbage\n\n0 0\n',0).map(m=>m.pid),[0]);
});

test('Windows birth reads CreationDate for exactly one numeric pid',()=>{
 const {deps,calls}=fake('win32','2026-11-12T01:00:00.0000000Z\r\n');
 assert.equal(processBirth(321,deps),'2026-11-12T01:00:00.0000000Z');assert.match(calls[0]!.args.at(-1)!,/ProcessId = 321"/);
 assert.throws(()=>processBirth(Number.NaN,deps));assert.throws(()=>processBirth(-1,deps));
});

test('Windows kill force-stops the whole tree with taskkill /T /F and reports ESRCH when nothing is left',()=>{
 const {deps,calls}=fake('win32','100 1\n101 100\n');
 killGroup(100,'SIGTERM',deps);
 // Live leader: one taskkill /T on the leader, no census needed.
 assert.deepEqual(calls.map(c=>c.kind),['spawn']);
 const kill=calls[0]!;assert.equal(kill.file,taskkillPath(deps.env));assert.equal(kill.file,'C:\\Windows\\System32\\taskkill.exe');
 assert.deepEqual(kill.args,['/T','/F','/PID','100']);assert.equal(kill.options.windowsHide,true);
 // Leader already gone (taskkill 128): orphans found through the census are stopped together.
 const orphan=fake('win32','101 100\n102 101\n',128);killGroup(100,'SIGTERM',orphan.deps);
 assert.deepEqual(orphan.calls.map(c=>c.kind),['spawn','exec','spawn']);assert.deepEqual(orphan.calls[2]!.args,['/T','/F','/PID','101','/PID','102']);
 const self=fake('win32','100 1\n101 100\n');killGroup(100,'SIGKILL',self.deps,{exclude:[100]});assert.deepEqual(self.calls.find(c=>c.kind==='spawn')!.args,['/T','/F','/PID','101']);
 const gone=fake('win32','7 1\n',128);assert.throws(()=>killGroup(100,'SIGTERM',gone.deps),(e:any)=>e.code==='ESRCH');assert.equal(gone.calls.filter(c=>c.kind==='spawn').length,1);
});

test('POSIX kill is still kill(-pgid, signal)',()=>{
 const {deps,calls}=fake('darwin','');const original=process.kill;const seen:any[]=[];
 (process as any).kill=(pid:number,signal:string)=>{seen.push([pid,signal]);return true;};
 try{killGroup(123,'SIGTERM',deps);killGroup(123,'SIGKILL',deps);}finally{(process as any).kill=original;}
 assert.deepEqual(seen,[[-123,'SIGTERM'],[-123,'SIGKILL']]);assert.equal(calls.length,0);
});

test('group spawn options: private IPC launcher survives host death on each platform and stays hidden',()=>{
 assert.deepEqual(groupSpawnOptions('darwin'),{detached:true,windowsHide:true});
 assert.deepEqual(groupSpawnOptions('linux'),{detached:true,windowsHide:true});
 assert.deepEqual(groupSpawnOptions('win32'),{detached:true,windowsHide:true});
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
