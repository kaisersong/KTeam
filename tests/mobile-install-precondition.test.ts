import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {chmodSync,existsSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=fileURLToPath(new URL('../..',import.meta.url));
const {installMobileDependencies,requireFromMobileInstall}=await import(pathToFileURL(join(root,'scripts/mobile-install.mjs')).href) as {
  installMobileDependencies:(options:{mobile:string,command?:string,args?:string[],lockDirectory?:string,stdio?:'ignore',env?:NodeJS.ProcessEnv})=>void,
  requireFromMobileInstall:(mobile:string,specifier:string)=>unknown,
};

function temp(){const dir=join(tmpdir(),'kteam-mobile-install-'+Math.random().toString(16).slice(2));mkdirSync(dir,{recursive:true});return dir;}
function packageRoot(dir:string){mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'package.json'),'{"name":"mobile-install-fixture","private":true}\n');}

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
    assert.equal(readFileSync(join(root,'tests/mobile-shared-buffer-resolution.test.ts'),'utf8').includes('spawnSync'),false);
    assert.equal(readFileSync(join(root,'tests/mobile-shared-buffer-resolution.test.ts'),'utf8').includes('npm'),false);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('the test runner installs from the lockfile once before parallel workers, even when a partial tree is already present',()=>{
  const dir=temp();
  const mobile=join(dir,'mobile');
  const lock=join(dir,'lock');
  const log=join(dir,'install.log');
  try{
    packageRoot(mobile);
    mkdirSync(join(mobile,'node_modules','buffer'),{recursive:true});
    writeFileSync(join(mobile,'node_modules','buffer','package.json'),'{"name":"buffer"}\n');
    const command=join(dir,'record.js');
    writeFileSync(command,"#!/usr/bin/env node\nconst fs=require('node:fs');fs.appendFileSync(process.env.INSTALL_LOG,JSON.stringify(process.argv.slice(1))+'\\n');");
    chmodSync(command,0o755);
    installMobileDependencies({mobile,command,lockDirectory:lock,stdio:'ignore',env:{...process.env,INSTALL_LOG:log}});
    const recorded=JSON.parse(readFileSync(log,'utf8')) as string[];
    assert.deepEqual(recorded.slice(-4),['ci','--ignore-scripts','--no-audit','--no-fund']);
    const runner=readFileSync(join(root,'scripts/run-tests.mjs'),'utf8');
    assert.ok(runner.includes('withMobileInstall'));
    assert.ok(runner.indexOf('withMobileInstall')<runner.indexOf('spawnSync(process.execPath'));
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('an offline or killed install fails before any assertion and reports the status or signal',()=>{
  const dir=temp();
  const mobile=join(dir,'mobile');
  try{
    packageRoot(mobile);
    assert.throws(()=>installMobileDependencies({mobile,command:process.execPath,args:['-e','process.exit(7)'],lockDirectory:join(dir,'offline'),stdio:'ignore'}),
      (error:NodeJS.ErrnoException & {status:number|null,signal:string|null})=>error.message==='mobile_install_failed'&&error.status===7&&error.signal===null);
    assert.throws(()=>installMobileDependencies({mobile,command:process.execPath,args:['-e','process.kill(process.pid,"SIGKILL")'],lockDirectory:join(dir,'killed'),stdio:'ignore'}),
      (error:NodeJS.ErrnoException & {status:number|null,signal:string|null})=>error.message==='mobile_install_failed'&&error.status===null&&error.signal==='SIGKILL');
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
      const child=spawn(process.execPath,['--test',join(root,'dist/tests/mobile-shared-buffer-resolution.test.js')],{env:{...process.env,PATH:bin+':'+process.env.PATH,NPM_LOG:log},stdio:'ignore'});
      child.once('error',reject);
      child.once('exit',status=>resolve(status));
    });
    assert.equal(code,0);
    assert.equal(existsSync(log),false);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('two installers wait on one lock instead of running the install together',async()=>{
  const dir=temp();
  const mobile=join(dir,'mobile');
  const lock=join(dir,'lock');
  const log=join(dir,'overlap.log');
  const command=join(dir,'hold.js');
  try{
    packageRoot(mobile);
    writeFileSync(command,"const fs=require('node:fs');const start=Date.now();fs.appendFileSync(process.env.INSTALL_LOG,'start '+start+'\\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,250);fs.appendFileSync(process.env.INSTALL_LOG,'end '+Date.now()+'\\n');");
    const child=()=>new Promise<void>((resolve,reject)=>{
      const subprocess=spawn(process.execPath,['--input-type=module','-e',`import {installMobileDependencies} from ${JSON.stringify(pathToFileURL(join(root,'scripts/mobile-install.mjs')).href)};installMobileDependencies({mobile:${JSON.stringify(mobile)},command:process.execPath,args:[${JSON.stringify(command)}],lockDirectory:${JSON.stringify(lock)},stdio:'ignore',env:{...process.env,INSTALL_LOG:${JSON.stringify(log)}}});`],{stdio:'ignore'});
      subprocess.once('error',reject);
      subprocess.once('exit',code=>code===0?resolve():reject(Error('installer_exit_'+code)));
    });
    await Promise.all([child(),child()]);
    const events=readFileSync(log,'utf8').trim().split('\n').map(line=>{const [kind,time]=line.split(' ');return {kind,time:Number(time)};});
    assert.deepEqual(events.map(event=>event.kind),['start','end','start','end']);
    assert.ok(events[1]!.time<=events[2]!.time);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('two real test runners keep the install lock until each test process exits',async()=>{
  const dir=temp();
  const mobile=join(dir,'mobile');
  const lock=join(dir,'lock');
  const log=join(dir,'runners.log');
  const installer=join(dir,'install.js');
  const spec=join(dir,'read.test.js');
  try{
    packageRoot(mobile);
    writeFileSync(installer,"const fs=require('node:fs');const path=require('node:path');const mobile=process.argv[2],id=process.env.RUN_ID,log=process.env.EVENT_LOG;fs.appendFileSync(log,'install-start '+id+' '+Date.now()+'\\n');fs.rmSync(path.join(mobile,'node_modules'),{recursive:true,force:true});fs.mkdirSync(path.join(mobile,'node_modules','pkg'),{recursive:true});fs.writeFileSync(path.join(mobile,'node_modules','pkg','marker.txt'),id);Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,150);fs.appendFileSync(log,'install-end '+id+' '+Date.now()+'\\n');");
    writeFileSync(spec,"import {test} from 'node:test';import assert from 'node:assert/strict';import {appendFileSync,readFileSync} from 'node:fs';test('reads the install that belongs to this run',()=>{const id=process.env.RUN_ID,file=process.env.MARKER,log=process.env.EVENT_LOG;const first=readFileSync(file,'utf8');appendFileSync(log,'read-start '+id+' '+Date.now()+'\\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,250);const second=readFileSync(file,'utf8');appendFileSync(log,'read-end '+id+' '+Date.now()+' '+second+'\\n');assert.equal(first,id);assert.equal(second,id);});");
    const helper=pathToFileURL(join(root,'scripts/mobile-install.mjs')).href;
    const marker=join(mobile,'node_modules','pkg','marker.txt');
    const runner=(id:string)=>new Promise<void>((resolve,reject)=>{
      const source=`import {withMobileInstall} from ${JSON.stringify(helper)};import {spawnSync} from 'node:child_process';const env={...process.env,EVENT_LOG:${JSON.stringify(log)},RUN_ID:${JSON.stringify(id)}};delete env.NODE_TEST_CONTEXT;withMobileInstall({mobile:${JSON.stringify(mobile)},command:process.execPath,args:[${JSON.stringify(installer)},${JSON.stringify(mobile)}],lockDirectory:${JSON.stringify(lock)},stdio:'ignore',env},()=>{const childEnv={...env,MARKER:${JSON.stringify(marker)}};const result=spawnSync(process.execPath,['--test',${JSON.stringify(spec)}],{env:childEnv,stdio:'inherit'});if(result.status!==0)process.exit(result.status??1);});`;
      const child=spawn(process.execPath,['--input-type=module','-e',source],{stdio:['ignore','inherit','inherit']});
      child.once('error',reject);
      child.once('exit',code=>code===0?resolve():reject(Error('runner_'+id+'_'+code)));
    });
    await Promise.all([runner('a'),runner('b')]);
    const rows=readFileSync(log,'utf8').trim().split('\n').map(line=>line.split(' '));
    const index=(kind:string,id:string)=>rows.findIndex(row=>row[0]===kind&&row[1]===id);
    const first=index('install-start','a')<index('install-start','b')?'a':'b';
    const second=first==='a'?'b':'a';
    assert.ok(index('read-end',first)<index('install-start',second));
    assert.equal(rows.find(row=>row[0]==='read-end'&&row[1]==='a')?.[3],'a');
    assert.equal(rows.find(row=>row[0]==='read-end'&&row[1]==='b')?.[3],'b');
  }finally{rmSync(dir,{recursive:true,force:true});}
});
