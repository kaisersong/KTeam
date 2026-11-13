import {assertWindowsPrivate} from './helpers/private-path.js';
import {privateTempDir} from './helpers/private-temp.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync,mkdirSync,rmSync,existsSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const runtime=async()=>await import(pathToFileURL(resolve('build/shared/kteam-runtime.mjs')).href) as any;

test('credential protection cannot be forged by a caller-supplied process callback',async()=>{
 const {protectCredentialPath}=await runtime(),root=privateTempDir(join(tmpdir(),'kteam-acl-refusal-'));
 try{const missing=join(root,'missing');let called=false;
  assert.throws(()=>protectCredentialPath(missing,true,'win32',()=>{called=true;return {status:0,stdout:'{"ok":true}'};}),/credential_path_unsafe/);
  assert.equal(called,false);assert.equal(existsSync(missing),false);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('non-Windows credential protection never launches a process',async()=>{
 const {protectCredentialPath}=await runtime();let called=false;
 for(const platform of ['darwin','linux'])protectCredentialPath('/x',true,platform,()=>{called=true;return {status:0};});
 assert.equal(called,false);
});

test('real Windows ACL uses typed SID principals, protected rules and literal hostile paths',{skip:process.platform!=='win32'?'Windows ACLs exist only on Windows':false},async()=>{
 const {protectCredentialPath}=await runtime(),root=privateTempDir(join(tmpdir(),'kteam-acl-'));
 try{
  const dir=join(root,"o'brien $(calc) `x & mkdir pwned &"),file=join(dir,'store.json');mkdirSync(dir);writeFileSync(file,'{}');
  protectCredentialPath(dir,true);protectCredentialPath(file,false);
  for(const path of [dir,file])assertWindowsPrivate(path);
  assert.throws(()=>protectCredentialPath(file,true),/credential_path_unsafe/);assert.throws(()=>protectCredentialPath(dir,false),/credential_path_unsafe/);
  assert.equal(readFileSync(file,'utf8'),'{}');assert.equal(existsSync(join(root,'pwned')),false);
 }finally{rmSync(root,{recursive:true,force:true});}
});
