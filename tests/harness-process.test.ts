import {waitForProcessGone} from './helpers/process-gone.js';
import {privateTempDir as mkdtempSync} from './helpers/private-temp.js';
import {tmpdir} from 'node:os';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {realpathSync,mkdirSync,writeFileSync,chmodSync,existsSync,rmSync,copyFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {promisify} from 'node:util';
import {processBirth} from '../src/runtime/platform-process.js';
const processDeadline=process.platform==='win32'?30000:6000;
import {spawn,execFile,withHarnessProcessOwner} from '../src/runtime/harness-child-process.js';

test('owned raw spawn preserves ordinary nonzero exit status and physically drains the supervisor',async()=>{
 const records:any[]=[];
 const child=withHarnessProcessOwner({cwd:process.cwd(),signal:AbortSignal.timeout(processDeadline),assertCurrent:async()=>{},record:r=>{records.push(r);}},()=>spawn(process.execPath,['-e','process.exit(2)']));
 let stderr='';const exits:any[]=[],errors:string[]=[];child.stdout.resume();child.stderr.on('data',(data:Buffer)=>{stderr=(stderr+data).slice(-4000);});child.on('message',(message:any)=>{exits.push(message);});child.on('error',(error:Error)=>{errors.push(error.message);});
 const result=await new Promise(r=>child.once('close',(code:any,signal:any)=>r({code,signal})));
 assert.equal(errors.length,0,JSON.stringify({stderr,exits,errors,records}));assert.deepEqual(result,{code:2,signal:null},JSON.stringify({stderr,exits,records}));assert.ok(records.some(r=>r.state==='running'));
 await waitForProcessGone(records.find(record=>record.pid===child.pid&&record.state==='running')!);
});

test('caller shell options cannot apply to the ownership launcher or execute a path before admission',async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'kteam-launcher-shell-'))),before=process.env.KTEAM_NATIVE_CHILD,marker=join(root,'bypass'),launcher=join(root,process.platform==='win32'?'child& mkdir bypass &.mjs':'child; touch bypass; #.mjs');if(process.platform==='win32'){copyFileSync(new URL('../src/runtime/platform-process.js',import.meta.url),join(root,'platform-process.js'));copyFileSync(new URL('../src/runtime/windows-process-observer.js',import.meta.url),join(root,'windows-process-observer.js'));const native=join(root,'build/shared/native','win32-'+process.arch);mkdirSync(native,{recursive:true});for(const file of ['windows-process-observer.exe','windows-process-observer.json'])copyFileSync(resolve('build/shared/native','win32-'+process.arch,file),join(native,file));}copyFileSync(new URL('../src/runtime/native-child.js',import.meta.url),launcher);process.env.KTEAM_NATIVE_CHILD=launcher;
 try{const error:any=await withHarnessProcessOwner({cwd:root,signal:AbortSignal.timeout(processDeadline),assertCurrent:async()=>{throw Error('synthetic_revoked');},record:()=>{}},()=>new Promise(resolve=>{const child=spawn('exit',['2'],{shell:true});child.stdout.resume();child.stderr.resume();let error:any;child.once('error',(e:any)=>{error=e;});child.once('close',()=>resolve(error));}));assert.match(error.message,/synthetic_revoked/);assert.equal(existsSync(marker),false);
  const result=await withHarnessProcessOwner({cwd:root,signal:AbortSignal.timeout(processDeadline),assertCurrent:async()=>{},record:()=>{}},()=>new Promise(resolve=>{const child=spawn('exit',['2'],{shell:true});child.stdout.resume();child.stderr.resume();child.once('error',()=>{});child.once('close',(code:any,signal:any)=>resolve({code,signal}));}));assert.deepEqual(result,{code:2,signal:null});assert.equal(existsSync(marker),false);
 }finally{if(before===undefined)delete process.env.KTEAM_NATIVE_CHILD;else process.env.KTEAM_NATIVE_CHILD=before;rmSync(root,{force:true,recursive:true});}
});

test('owned execFile limits retained bytes while an excessive writer is physically stopped',async()=>{
 const records:any[]=[];
 const output:any=await withHarnessProcessOwner({cwd:process.cwd(),signal:AbortSignal.timeout(processDeadline),assertCurrent:async()=>{},record:r=>{records.push(r);}},()=>new Promise(resolve=>execFile(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>process.stdout.write(Buffer.alloc(65536)),1)"],{maxBuffer:1024,encoding:'buffer'},(error:any,stdout:Buffer,stderr:Buffer)=>resolve({error,stdout,stderr}))));
 assert.equal(output.error.code,'native_output_limit');assert.ok(output.stdout.length+output.stderr.length<=1024);
 for(const row of records.filter(r=>r.state==='running'))await waitForProcessGone(row);
});

test('a PATH-supplied ps cannot bypass a revoked ownership guard or inject census options',async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'kteam-ps-'))),bin=join(root,'bin'),marker=join(root,'marker');mkdirSync(bin);writeFileSync(join(bin,'ps'),'#!/bin/sh\nprintf bypass > '+marker);chmodSync(join(bin,'ps'),0o700);
 try{
  const error:any=await withHarnessProcessOwner({cwd:root,signal:AbortSignal.timeout(processDeadline),assertCurrent:async()=>{throw Error('synthetic_revoked');},record:()=>{}},()=>new Promise(resolve=>{const child=spawn('ps',['-p','1','-o','lstart='],{env:{PATH:bin}});child.stdout.resume();child.stderr.resume();let failure:any;child.once('error',(e:any)=>{failure=e;});child.once('close',()=>resolve(failure));}));
  assert.match(error.message,/synthetic_revoked/);assert.equal(existsSync(marker),false);
  if(process.platform==='win32'){const path=process.env.PATH;writeFileSync(join(bin,'powershell.cmd'),'@echo off\r\nmkdir marker\r\n');try{process.env.PATH=bin;assert.ok(processBirth(process.pid));assert.equal(existsSync(marker),false);}finally{if(path===undefined)delete process.env.PATH;else process.env.PATH=path;}return;}
  const result:any=await withHarnessProcessOwner({cwd:root,signal:AbortSignal.timeout(processDeadline),assertCurrent:async()=>{throw Error('synthetic_revoked');},record:()=>{}},()=>promisify(execFile as any)('/bin/ps',['-p',String(process.pid),'-o','lstart='],{env:{PATH:bin},shell:true}));
  assert.ok(result.stdout.trim());assert.equal(existsSync(marker),false);
 }finally{rmSync(root,{recursive:true,force:true});}
});
