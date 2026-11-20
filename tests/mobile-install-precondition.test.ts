import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {chmodSync,existsSync,mkdirSync,symlinkSync,writeFileSync,readFileSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=fileURLToPath(new URL('../..',import.meta.url));
const helperHref=pathToFileURL(join(root,'scripts/mobile-install.mjs')).href;
const {commandNeedsShell,installMobileDependencies,requireFromMobileInstall,withMobileInstall}=await import(helperHref) as {
  commandNeedsShell:(platform:string,command:string)=>boolean,
  installMobileDependencies:(options:{mobile:string,command?:string,args?:string[],stdio?:'ignore',env?:NodeJS.ProcessEnv})=>void,
  requireFromMobileInstall:(mobile:string,specifier:string)=>unknown,
  withMobileInstall:(options:{mobile:string,command?:string,args?:string[],stdio?:'ignore',env?:NodeJS.ProcessEnv},body?:(installRoot:string)=>unknown)=>unknown,
};

function temp(){const dir=join(tmpdir(),'kteam-mobile-install-'+Math.random().toString(16).slice(2));mkdirSync(dir,{recursive:true});return dir;}
function packageRoot(dir:string){mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'package.json'),'{"name":"mobile-install-fixture","private":true}\n');}
type Row={kind:string,id:string,time:number,root:string,pid:number,ppid:number,markerId?:string};
function events(file:string):Row[]{
  if(!existsSync(file))return [];
  return readFileSync(file,'utf8').split('\n').filter(Boolean).flatMap(line=>{try{return [JSON.parse(line) as Row];}catch{return [];}});
}
function separate(source:string,candidate:string){
  const parent=realpathSync(source);
  return candidate!==parent&&!candidate.startsWith(parent+sep);
}

function writeInstaller(file:string){
  writeFileSync(file,`const fs=require('node:fs');const path=require('node:path');
const id=process.env.RUN_ID,log=process.env.EVENT_LOG,release=process.env.RELEASE_FILE,root=process.cwd();
const pkg=path.join(root,'node_modules','pkg');
fs.mkdirSync(pkg,{recursive:true});
fs.writeFileSync(path.join(pkg,'package.json'),JSON.stringify({name:'pkg',main:'index.js'}));
fs.writeFileSync(path.join(pkg,'index.js'),'module.exports='+JSON.stringify({id}));
const marker=path.join(pkg,'marker.txt');
const publish=()=>{const next=id+'\\n'+Date.now()+'\\n';const tmp=marker+'.next';fs.writeFileSync(tmp,next);fs.renameSync(tmp,marker);};
const note=kind=>{const time=Date.now();fs.appendFileSync(log,JSON.stringify({kind,id,time,root,pid:process.pid,ppid:process.ppid})+'\\n');return time;};
const seen=(since,waitLog,waitId)=>{
  if(!waitLog)return false;
  return fs.readFileSync(waitLog,'utf8').split('\\n').filter(Boolean).some(line=>{try{const row=JSON.parse(line);return row.kind==='write'&&row.id===waitId&&row.time>=since;}catch{return false;}});
};
const installStarted=note('install-start');
if(process.env.HOLD==='1'){
  while(!fs.existsSync(release)){publish();note('write');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20);}
}else{
  publish();
  note('write');
  const waitLog=process.env.WAIT_WRITE_LOG,waitId=process.env.WAIT_WRITE_ID;
  if(waitLog){
    const deadline=Date.now()+8000;
    while(!seen(installStarted,waitLog,waitId)){if(Date.now()>deadline)throw Error('writer_not_active_during_install');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20);}
  }
}
note('install-end');
`);
}

function runnerSource(options:{mobile:string,installer:string,id:string,log:string,hold:boolean,release:string,waitForLog?:string,waitForId?:string}){
  return `import {withMobileInstall,requireFromMobileInstall} from ${JSON.stringify(helperHref)};
import {appendFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
const id=${JSON.stringify(options.id)};
const log=${JSON.stringify(options.log)};
const waitLog=${JSON.stringify(options.waitForLog??'')};
const waitId=${JSON.stringify(options.waitForId??'')};
const rows=()=>waitLog?readFileSync(waitLog,'utf8').split('\\n').filter(Boolean).flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}}):[];
withMobileInstall({mobile:${JSON.stringify(options.mobile)},command:process.execPath,args:[${JSON.stringify(options.installer)}],stdio:'ignore',env:{...process.env,RUN_ID:id,EVENT_LOG:log,HOLD:${JSON.stringify(options.hold?'1':'0')},RELEASE_FILE:${JSON.stringify(options.release)},WAIT_WRITE_LOG:waitLog,WAIT_WRITE_ID:waitId}},root=>{
  const readStart=Date.now();
  appendFileSync(log,JSON.stringify({kind:'read-start',id,time:readStart,root,pid:process.pid,ppid:process.ppid})+'\\n');
  const got=requireFromMobileInstall(root,'pkg');
  if(!got||got.id!==id)throw Error('wrong_install_tree');
  const marker=readFileSync(join(root,'node_modules','pkg','marker.txt'),'utf8');
  if(!marker.startsWith(id+'\\n'))throw Error('wrong_marker');
  if(waitId){
    const deadline=Date.now()+8000;
    while(!rows().some(row=>row.kind==='write'&&row.id===waitId&&row.time>=readStart)){
      if(Date.now()>deadline)throw Error('writer_not_active_during_read');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20);
    }
  }
  appendFileSync(log,JSON.stringify({kind:'read-end',id,time:Date.now(),root,pid:process.pid,ppid:process.ppid,markerId:marker.split('\\n')[0]})+'\\n');
});`;
}

function launch(source:string){
  const env={...process.env};
  delete env.NODE_TEST_CONTEXT;
  const child=spawn(process.execPath,['--input-type=module','-e',source],{env,stdio:['ignore','inherit','inherit']});
  const done=new Promise<number|null>((resolve,reject)=>{
    child.once('error',reject);
    child.once('exit',code=>resolve(code));
  });
  return {child,done};
}
async function until(predicate:()=>boolean,label:string){
  const deadline=Date.now()+8000;
  while(!predicate()){
    if(Date.now()>deadline)throw Error(label);
    await new Promise(resolve=>setTimeout(resolve,20));
  }
}
function alive(pid:number){try{process.kill(pid,0);return true;}catch{return false;}}

test('batch commands are distinguished from ordinary executables',()=>{
  assert.equal(commandNeedsShell('win32','npm.cmd'),true);
  assert.equal(commandNeedsShell('win32','npm.BAT'),true);
  assert.equal(commandNeedsShell('win32','npm'),false);
  assert.equal(commandNeedsShell('linux','npm.cmd'),false);
  assert.equal(commandNeedsShell(process.platform,process.execPath),false);
});

test('a mobile tree without its own modules fails instead of using the root install',()=>{
  const dir=temp();
  try{
    packageRoot(join(dir,'mobile'));
    mkdirSync(join(dir,'node_modules','typescript'),{recursive:true});
    writeFileSync(join(dir,'node_modules','typescript','package.json'),'{"name":"typescript","main":"index.js"}\n');
    writeFileSync(join(dir,'node_modules','typescript','index.js'),'module.exports={from:"root"}\n');
    assert.throws(()=>requireFromMobileInstall(join(dir,'mobile'),'typescript'),(error:NodeJS.ErrnoException)=>error.message==='mobile_dependency_outside_mobile:typescript');
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('a missing mobile module fails and does not create node_modules',()=>{
  const dir=temp();
  const mobile=join(dir,'mobile');
  try{
    packageRoot(mobile);
    assert.throws(()=>requireFromMobileInstall(mobile,'metro-resolver'),(error:NodeJS.ErrnoException)=>error.message==='mobile_dependency_missing:metro-resolver');
    const source=readFileSync(join(root,'tests/mobile-shared-buffer-resolution.test.ts'),'utf8');
    assert.equal(source.includes('spawnSync'),false);
    assert.equal(source.includes('npm'),false);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('the test runner installs from the lockfile once into a private tree',()=>{
  const dir=temp();
  const mobile=join(dir,'mobile');
  const log=join(dir,'install.log');
  try{
    packageRoot(mobile);
    mkdirSync(join(mobile,'node_modules','buffer'),{recursive:true});
    writeFileSync(join(mobile,'node_modules','buffer','package.json'),'{"name":"buffer","partial":true}\n');
    const script=join(dir,'record.js');
    const body="const fs=require('node:fs');fs.writeFileSync(process.env.INSTALL_LOG,JSON.stringify({argv:process.argv,cwd:process.cwd(),sawPartial:fs.existsSync('node_modules/buffer/package.json')}));\n";
    const command=process.platform==='win32'?join(dir,'record.cmd'):script;
    if(process.platform==='win32'){
      writeFileSync(script,body);
      writeFileSync(command,`@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
    }else{writeFileSync(script,'#!/usr/bin/env node\n'+body);chmodSync(script,0o755);}
    installMobileDependencies({mobile,command,stdio:'ignore',env:{...process.env,INSTALL_LOG:log}});
    const recorded=JSON.parse(readFileSync(log,'utf8')) as {argv:string[],cwd:string,sawPartial:boolean};
    assert.deepEqual(recorded.argv.slice(-4),['ci','--ignore-scripts','--no-audit','--no-fund']);
    assert.equal(recorded.sawPartial,false);
    assert.equal(separate(mobile,recorded.cwd),true);
    assert.equal(readFileSync(join(mobile,'node_modules','buffer','package.json'),'utf8').includes('"partial":true'),true);
    const runner=readFileSync(join(root,'scripts/run-tests.mjs'),'utf8');
    const install=readFileSync(join(root,'scripts/mobile-install.mjs'),'utf8');
    assert.ok(runner.includes('withMobileInstall'));
    assert.ok(runner.includes('KTEAM_MOBILE_ROOT'));
    assert.ok(runner.indexOf('withMobileInstall')<runner.indexOf('spawnSync(process.execPath'));
    assert.equal(install.includes('taskkill'),false);
    assert.equal(install.includes('ownedSupervisor'),false);
    assert.equal(install.includes('BEGIN IMMEDIATE'),false);
    assert.match(install,/args=options\.args\?\?\['ci','--ignore-scripts','--no-audit','--no-fund'\]/);
    assert.equal(install.includes('ci --ignore-scripts'),false);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('a symlink that leaves the install source is refused before the installer runs',()=>{
  const dir=temp();
  const mobile=join(dir,'mobile');
  const outside=join(dir,'outside');
  const log=join(dir,'ran.txt');
  try{
    packageRoot(mobile);
    mkdirSync(outside);
    writeFileSync(join(outside,'secret.txt'),'secret\n');
    symlinkSync('../outside',join(mobile,'escape'));
    assert.throws(()=>installMobileDependencies({mobile,command:process.execPath,args:['-e','require("node:fs").writeFileSync(process.env.RAN,"ran")'],stdio:'ignore',env:{...process.env,RAN:log}}),
      (error:NodeJS.ErrnoException)=>error.message==='mobile_install_link_escapes');
    assert.equal(existsSync(log),false);
    assert.equal(readFileSync(join(outside,'secret.txt'),'utf8'),'secret\n');
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('a symlink that stays inside the install source is copied as a link',()=>{
  const dir=temp();
  const mobile=join(dir,'mobile');
  try{
    packageRoot(mobile);
    symlinkSync('package.json',join(mobile,'self.json'));
    installMobileDependencies({mobile,command:process.execPath,args:['-e',"const fs=require('node:fs');if(!fs.lstatSync('self.json').isSymbolicLink()||fs.readlinkSync('self.json')!=='package.json')process.exit(4)"],stdio:'ignore'});
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('an offline or killed install fails before any read and reports the status or signal',()=>{
  const dir=temp();
  const mobile=join(dir,'mobile');
  try{
    packageRoot(mobile);
    let ran=false;
    assert.throws(()=>withMobileInstall({mobile,command:process.execPath,args:['-e','process.exit(7)'],stdio:'ignore'},()=>{ran=true;}),
      (error:NodeJS.ErrnoException & {status:number|null,signal:string|null})=>error.message==='mobile_install_failed'&&error.status===7&&error.signal===null);
    assert.equal(ran,false);
    ran=false;
    assert.throws(()=>withMobileInstall({mobile,command:process.execPath,args:['-e','process.kill(process.pid,"SIGKILL")'],stdio:'ignore'},()=>{ran=true;}),
      (error:NodeJS.ErrnoException & {status:number|null,signal:string|null})=>error.message==='mobile_install_failed'&&error.status===null&&error.signal==='SIGKILL');
    assert.equal(ran,false);
    assert.equal(existsSync(join(mobile,'node_modules')),false);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('buffer assertions do not run an installer',async()=>{
  const dir=temp();
  const bin=join(dir,'bin');
  const log=join(dir,'npm.log');
  try{
    mkdirSync(bin);
    const npm=join(bin,'npm');
    writeFileSync(npm,'#!/bin/sh\necho called >> "$NPM_LOG"\nexit 99\n');
    chmodSync(npm,0o755);
    const code=await new Promise<number|null>((resolve,reject)=>{
      const env:NodeJS.ProcessEnv={...process.env,PATH:bin+':'+process.env.PATH,NPM_LOG:log};
      delete env.NODE_TEST_CONTEXT;
      const child=spawn(process.execPath,['--test',join(root,'dist/tests/mobile-shared-buffer-resolution.test.js')],{env,stdio:'ignore'});
      child.once('error',reject);
      child.once('exit',status=>resolve(status));
    });
    assert.equal(existsSync(log),false);
    if(process.env.KTEAM_MOBILE_ROOT)assert.equal(code,0);
    else assert.notEqual(code,0);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('a second runner reads and writes only its own tree while the other install is still writing',async()=>{
  const dir=temp();
  const mobile=join(dir,'mobile');
  const installer=join(dir,'install.js');
  try{
    packageRoot(mobile);
    writeInstaller(installer);
    for(const [writerId,readerId] of [['writer','reader'],['reader','writer']] as const){
      const phase=join(dir,writerId+'-holds');
      mkdirSync(phase);
      const writerLog=join(phase,'writer.log');
      const readerLog=join(phase,'reader.log');
      const release=join(phase,'release');
      const writer=launch(runnerSource({mobile,installer,id:writerId,log:writerLog,hold:true,release}));
      try{
        await until(()=>events(writerLog).some(row=>row.kind==='write'&&row.id===writerId&&row.ppid===writer.child.pid),'writer_did_not_start');
        const direct=events(writerLog).find(row=>row.kind==='install-start'&&row.id===writerId);
        assert.equal(direct?.ppid,writer.child.pid);
        const reader=launch(runnerSource({mobile,installer,id:readerId,log:readerLog,hold:false,release,waitForLog:writerLog,waitForId:writerId}));
        assert.equal(await reader.done,0);
        const writerRows=events(writerLog),readerRows=events(readerLog);
        const readStart=readerRows.find(row=>row.kind==='read-start'&&row.id===readerId);
        const readEnd=readerRows.find(row=>row.kind==='read-end'&&row.id===readerId);
        const readerInstallStart=readerRows.find(row=>row.kind==='install-start'&&row.id===readerId);
        const readerInstallEnd=readerRows.find(row=>row.kind==='install-end'&&row.id===readerId);
        assert.ok(readStart&&readEnd&&readerInstallStart&&readerInstallEnd);
        const duringRead=writerRows.filter(row=>row.kind==='write'&&row.id===writerId&&row.time>=readStart.time&&row.time<=readEnd.time);
        const duringInstall=writerRows.filter(row=>row.kind==='write'&&row.id===writerId&&row.time>=readerInstallStart.time&&row.time<=readerInstallEnd.time);
        assert.ok(duringRead.length>=1);
        assert.ok(duringInstall.length>=1);
        assert.equal(readEnd.markerId,readerId);
        assert.equal(separate(mobile,readEnd.root),true);
        assert.equal(separate(mobile,duringRead[0]!.root),true);
        assert.notEqual(readEnd.root,duringRead[0]!.root);
        assert.equal(alive(writer.child.pid!),true);
        const marker=readFileSync(join(duringRead[0]!.root,'node_modules','pkg','marker.txt'),'utf8');
        assert.equal(marker.split('\n')[0],writerId);
        assert.equal(marker.includes(readerId),false);
        assert.equal(existsSync(join(mobile,'node_modules')),false);
      }finally{
        writeFileSync(release,'go\n');
        await writer.done;
      }
    }
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('killing the runner leaves the install writing only its private tree',async()=>{
  const dir=temp();
  const mobile=join(dir,'mobile');
  const installer=join(dir,'install.js');
  const writerLog=join(dir,'writer.log');
  const readerLog=join(dir,'reader.log');
  const release=join(dir,'release');
  let writerPid=0;
  let writerRoot='';
  let writer:ReturnType<typeof launch>|undefined;
  let reader:ReturnType<typeof launch>|undefined;
  try{
    packageRoot(mobile);
    writeInstaller(installer);
    writer=launch(runnerSource({mobile,installer,id:'owner',log:writerLog,hold:true,release}));
    await until(()=>events(writerLog).some(row=>row.kind==='write'&&row.ppid===writer!.child.pid),'writer_did_not_start');
    const started=events(writerLog).find(row=>row.kind==='install-start'&&row.id==='owner');
    assert.equal(started?.ppid,writer.child.pid);
    writerPid=started!.pid;
    writerRoot=started!.root;
    assert.equal(alive(writerPid),true);
    process.kill(writer.child.pid!,'SIGKILL');
    await until(()=>events(writerLog).some(row=>row.kind==='write'&&row.pid===writerPid&&row.ppid!==writer!.child.pid),'orphan_did_not_keep_writing');
    assert.equal(alive(writerPid),true);
    reader=launch(runnerSource({mobile,installer,id:'other',log:readerLog,hold:false,release,waitForLog:writerLog,waitForId:'owner'}));
    assert.equal(await reader.done,0);
    assert.equal(alive(writerPid),true);
    const readStart=events(readerLog).find(row=>row.kind==='read-start');
    const readEnd=events(readerLog).find(row=>row.kind==='read-end');
    const readerInstallStart=events(readerLog).find(row=>row.kind==='install-start');
    const readerInstallEnd=events(readerLog).find(row=>row.kind==='install-end');
    assert.ok(readStart&&readEnd&&readerInstallStart&&readerInstallEnd);
    const duringRead=events(writerLog).filter(row=>row.kind==='write'&&row.pid===writerPid&&row.time>=readStart.time&&row.time<=readEnd.time);
    const duringInstall=events(writerLog).filter(row=>row.kind==='write'&&row.pid===writerPid&&row.time>=readerInstallStart.time&&row.time<=readerInstallEnd.time);
    assert.ok(duringRead.length>=1);
    assert.ok(duringInstall.length>=1);
    assert.ok(duringRead.every(row=>row.ppid!==writer!.child.pid));
    assert.equal(readEnd.markerId,'other');
    assert.notEqual(readEnd.root,writerRoot);
    assert.equal(separate(mobile,readEnd.root),true);
    assert.equal(separate(mobile,writerRoot),true);
    const marker=readFileSync(join(writerRoot,'node_modules','pkg','marker.txt'),'utf8');
    assert.equal(marker.split('\n')[0],'owner');
    assert.equal(marker.includes('other'),false);
    assert.equal(existsSync(join(mobile,'node_modules')),false);
    assert.ok(Number(marker.split('\n')[1])>=readStart.time);
  }finally{
    writeFileSync(release,'go\n');
    if(writerPid&&alive(writerPid)){try{process.kill(writerPid,'SIGKILL');}catch{/* already gone */}}
    if(writer?.child.pid&&alive(writer.child.pid)){try{process.kill(writer.child.pid,'SIGKILL');}catch{/* already gone */}}
    if(reader?.child.pid&&alive(reader.child.pid)){try{process.kill(reader.child.pid,'SIGKILL');}catch{/* already gone */}}
    rmSync(dir,{recursive:true,force:true});
    if(writerRoot)rmSync(join(writerRoot,'..'),{recursive:true,force:true});
  }
});

test('private installs reuse the absolute npm CLI entry instead of resolving a launcher from the new cwd',()=>{
 const dir=temp();
 try{
  const mobile=join(dir,'source'),npm=join(dir,'npm-cli.js'),marker=join(dir,'npm-ran');
  packageRoot(mobile);
  writeFileSync(npm,'require("node:fs").writeFileSync(process.env.MOBILE_NPM_TEST_MARKER, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }));');
  withMobileInstall({mobile,stdio:'ignore',env:{...process.env,npm_execpath:npm,MOBILE_NPM_TEST_MARKER:marker}},root=>{
   const record=JSON.parse(readFileSync(marker,'utf8'));
   assert.equal(realpathSync(record.cwd),realpathSync(root));
   assert.deepEqual(record.args,['ci','--ignore-scripts','--no-audit','--no-fund']);
  });
 }finally{rmSync(dir,{recursive:true,force:true});}
});
