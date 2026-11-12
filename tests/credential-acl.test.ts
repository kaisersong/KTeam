import {assertWindowsPrivate} from './helpers/private-path.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const runtime=async()=>await import(pathToFileURL(resolve('build/shared/kteam-runtime.mjs')).href) as any;
const decode=(args:string[])=>Buffer.from(args[args.indexOf('-EncodedCommand')+1]!,'base64').toString('utf16le');

test('Windows credential ACL passes every SID as a SecurityIdentifier, never as an account-name string',async()=>{
 const {protectCredentialPath}=await runtime();const calls:any[]=[];
 const hostile="C:\\Users\\o'brien\\$(calc)\\`x\\credentials";
 protectCredentialPath(hostile,true,'win32',(file:string,args:string[],options:any)=>{calls.push({file,args,options});return {status:0};});
 assert.equal(calls.length,1);const {file,args,options}=calls[0];
 assert.equal(file,'powershell.exe');assert.ok(args.includes('-NonInteractive')&&args.includes('-NoProfile'));
 const script=decode(args);
 // The xiaok 1.6.3 bug: FileSystemAccessRule('S-1-5-…',…) resolves the string as an NTAccount name and throws.
 assert.doesNotMatch(script,/FileSystemAccessRule\(\s*\$principal\s*,/);
 assert.doesNotMatch(script,/foreach\(\$principal in @\(\$sid\.Value/);assert.doesNotMatch(script,/foreach\(\$principal in @\([^)]*'S-1-5-18'\s*,/);
 assert.match(script,/FileSystemAccessRule\]::new\(\[System\.Security\.Principal\.IdentityReference\]\$principal,/);
 assert.match(script,/SecurityIdentifier\]::new\('S-1-5-18'\)/);assert.match(script,/SecurityIdentifier\]::new\('S-1-5-32-544'\)/);
 assert.match(script,/WindowsIdentity\]::GetCurrent\(\)\.User/);
 // The path travels only through the environment; nothing from it is interpolated into the script.
 assert.equal(options.env.KTEAM_CREDENTIAL_ACL_PATH,hostile);assert.equal(options.env.KTEAM_CREDENTIAL_ACL_DIRECTORY,'1');
 assert.ok(!script.includes('o\'brien')&&!script.includes('$(calc)'));
 assert.equal(options.windowsHide,true);
 protectCredentialPath('C:\\x\\store.json',false,'win32',(_f:string,_a:string[],o:any)=>{calls.push(o);return {status:0};});assert.equal(calls[1].env.KTEAM_CREDENTIAL_ACL_DIRECTORY,'0');
});

test('Windows credential ACL fails closed when PowerShell reports any problem; other platforms never spawn it',async()=>{
 const {protectCredentialPath}=await runtime();
 assert.throws(()=>protectCredentialPath('C:\\x',true,'win32',()=>({status:1})),/credential_path_unsafe/);
 assert.throws(()=>protectCredentialPath('C:\\x',true,'win32',()=>({status:null,error:Error('ENOENT')})),/credential_path_unsafe/);
 let spawned=false;for(const platform of ['darwin','linux'])protectCredentialPath('/x',true,platform,()=>{spawned=true;return {status:0};});assert.equal(spawned,false);
});

test('real Windows ACL: only the current user, SYSTEM and Administrators keep access, inheritance is cut',{skip:process.platform!=='win32'?'Windows ACLs exist only on Windows':false},async()=>{
 const {protectCredentialPath}=await runtime();const root=mkdtempSync(join(tmpdir(),'kteam-acl-'));
 try{
  const dir=join(root,'credentials');mkdirSync(dir);const file=join(dir,'store.json');writeFileSync(file,'{}');
  protectCredentialPath(dir,true);protectCredentialPath(file,false);
  for(const path of [dir,file])assertWindowsPrivate(path);
 }finally{rmSync(root,{recursive:true,force:true});}
});
