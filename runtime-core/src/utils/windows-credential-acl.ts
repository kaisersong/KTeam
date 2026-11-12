import {spawnSync} from 'node:child_process';
import {lstatSync,readFileSync} from 'node:fs';
import {dirname,join,sep,win32} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

/** A fixed hash-checked ACL helper only; no shell, caller code, credential value or process selector. */
export function protectWindowsCredentialPath(path:string,directory:boolean):void{
 const fail=():never=>{throw Error('credential_path_unsafe');};
 if(process.platform!=='win32'||!['x64','arm64'].includes(process.arch))return fail();
 try{
  const root=dirname(fileURLToPath(import.meta.url)).split(sep).map(part=>part==='app.asar'?'app.asar.unpacked':part).join(sep);
  const folder=join(root,'native','win32-'+process.arch),exe=join(folder,'windows-credential-acl.exe'),manifest=join(folder,'windows-credential-acl.json');
  const read=(file:string,max:number)=>{const s=lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>max)return fail();const bytes=readFileSync(file);if(bytes.length>max)return fail();return bytes;};
  const original=read(manifest,4096),value=JSON.parse(original.toString('utf8'));
  if(!value||Object.keys(value).sort().join(',')!=='sha256,sourceSha256,target,version'||value.version!==1||value.target!=='win32-'+process.arch||![value.sha256,value.sourceSha256].every(hash=>typeof hash==='string'&&/^[a-f0-9]{64}$/.test(hash)))return fail();
  const current=()=>{if(!read(manifest,4096).equals(original)||createHash('sha256').update(read(exe,2*1024**2)).digest('hex')!==value.sha256)return fail();};
  current();
  const result=spawnSync(win32.toNamespacedPath(exe),[win32.toNamespacedPath(path),directory?'directory':'file'],{env:{},shell:false,stdio:['ignore','pipe','pipe'],encoding:'utf8',windowsHide:true,timeout:5000,maxBuffer:4096});
  current();
  if(result.error||result.status!==0||result.signal||JSON.parse(result.stdout).ok!==true)return fail();
 }catch{return fail();}
}
