import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,mkdirSync,writeFileSync,chmodSync,existsSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {promisify} from 'node:util';
import {spawn,execFile,withHarnessProcessOwner} from '../src/runtime/harness-child-process.js';

test('owned raw spawn preserves ordinary nonzero exit status and physically drains the supervisor',async()=>{
 const records:any[]=[];
 const child=withHarnessProcessOwner({cwd:process.cwd(),signal:AbortSignal.timeout(6000),assertCurrent:async()=>{},record:r=>{records.push(r);}},()=>spawn('/bin/sh',['-c','exit 2']));
 child.stdout.resume();child.stderr.resume();
 const result=await new Promise(r=>child.once('close',(code:any,signal:any)=>r({code,signal})));
 assert.deepEqual(result,{code:2,signal:null});assert.ok(records.some(r=>r.state==='running'));
 assert.throws(()=>process.kill(child.pid!,0));
});

test('owned execFile limits retained bytes while an excessive writer is physically stopped',async()=>{
 const records:any[]=[];
 const output:any=await withHarnessProcessOwner({cwd:process.cwd(),signal:AbortSignal.timeout(6000),assertCurrent:async()=>{},record:r=>{records.push(r);}},()=>new Promise(resolve=>execFile(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>process.stdout.write(Buffer.alloc(65536)),1)"],{maxBuffer:1024,encoding:'buffer'},(error:any,stdout:Buffer,stderr:Buffer)=>resolve({error,stdout,stderr}))));
 assert.equal(output.error.code,'native_output_limit');assert.ok(output.stdout.length+output.stderr.length<=1024);
 for(const row of records.filter(r=>r.state==='running'))assert.throws(()=>process.kill(row.pid,0));
});

test('a PATH-supplied ps cannot bypass a revoked ownership guard or inject census options',async()=>{
 const root=realpathSync(mkdtempSync('/tmp/kteam-ps-')),bin=join(root,'bin'),marker=join(root,'marker');mkdirSync(bin);writeFileSync(join(bin,'ps'),'#!/bin/sh\nprintf bypass > '+marker);chmodSync(join(bin,'ps'),0o700);
 try{
  const error:any=await withHarnessProcessOwner({cwd:root,signal:AbortSignal.timeout(6000),assertCurrent:async()=>{throw Error('synthetic_revoked');},record:()=>{}},()=>new Promise(resolve=>{const child=spawn('ps',['-p','1','-o','lstart='],{env:{PATH:bin}});child.stdout.resume();child.stderr.resume();let failure:any;child.once('error',(e:any)=>{failure=e;});child.once('close',()=>resolve(failure));}));
  assert.match(error.message,/synthetic_revoked/);assert.equal(existsSync(marker),false);
  const result:any=await withHarnessProcessOwner({cwd:root,signal:AbortSignal.timeout(6000),assertCurrent:async()=>{throw Error('synthetic_revoked');},record:()=>{}},()=>promisify(execFile as any)('/bin/ps',['-p',String(process.pid),'-o','lstart='],{env:{PATH:bin},shell:true}));
  assert.ok(result.stdout.trim());assert.equal(existsSync(marker),false);
 }finally{rmSync(root,{recursive:true,force:true});}
});
