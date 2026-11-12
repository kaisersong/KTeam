import {spawnSync} from 'node:child_process';
import {existsSync,lstatSync,readFileSync} from 'node:fs';
import {basename,dirname,join,resolve,win32} from 'node:path';
import {createHash} from 'node:crypto';

/** Only this bundled observer and its fixed metadata operations may be launched. */
export function windowsObservationCommand(args:readonly string[]){
 if(process.platform!=='win32')return undefined;
 const entry=process.env.KTEAM_RUNTIME_ENTRY;
 const main=process.argv[1]??'',name=basename(main);
 const root=entry?dirname(resolve(entry)):
  name==='native-child.cjs'||name==='host.cjs'?join(dirname(main),'shared'):
  name==='native-child.js'?resolve(dirname(main),'../../../build/shared'):
  name==='cli.js'?resolve(dirname(main),'../../build/shared'):resolve('build/shared');
 const folder=join(root,'native','win32-'+process.arch),manifest=join(folder,'windows-process-observer.json'),exe=join(folder,'windows-process-observer.exe');
 // Source CLI also works before native assets have been built, using its original
 // fixed system PowerShell observation. A partial or changed native asset is an error.
 if(!existsSync(manifest)&&!existsSync(exe))return undefined;
 const fail=():never=>{throw Error('windows_process_observation_unavailable');};
 try{
  const read=(file:string,max:number)=>{const s=lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.size>max)return fail();const bytes=readFileSync(file);if(bytes.length>max)return fail();return bytes;};
  const original=read(manifest,4096),value=JSON.parse(original.toString('utf8'));
  if(!value||Object.keys(value).sort().join(',')!=='sha256,sourceSha256,target,version'||value.version!==1||value.target!=='win32-'+process.arch||![value.sha256,value.sourceSha256].every(hash=>typeof hash==='string'&&/^[a-f0-9]{64}$/.test(hash)))return fail();
  const verify=()=>{if(!read(manifest,4096).equals(original)||createHash('sha256').update(read(exe,2*1024**2)).digest('hex')!==value.sha256)return fail();};
  const birth=args.length===2&&args[0]==='birth'&&/^\d+$/.test(args[1]!)&&Number(args[1])>=1&&Number(args[1])<=0xffffffff;
  const usage=args.length===2&&args[0]==='usage'&&typeof args[1]==='string'&&win32.isAbsolute(args[1])&&args[1].length<=32760&&!args[1].includes('\0');
  if(args.length!==0&&!birth&&!usage)return fail();
  verify();return Object.freeze({file:win32.toNamespacedPath(exe),args:Object.freeze(usage?['usage',win32.toNamespacedPath(args[1]!)]:[...args]),verify});
 }catch{return fail();}
}

/** Fixed process metadata only. Worktree usage goes through its original owned execFile. */
export function windowsProcessObservation(args:readonly string[]):string|undefined{
 const command=windowsObservationCommand(args);if(!command)return undefined;
 if(args.length!==0&&args[0]!=='birth')throw Error('windows_process_observation_unavailable');
 const result=spawnSync(command.file,[...command.args],{env:{},shell:false,stdio:['ignore','pipe','pipe'],windowsHide:true,encoding:'utf8',timeout:5000,maxBuffer:16*1024*1024});
 command.verify();if(result.error||result.status!==0||result.signal)throw Error('windows_process_observation_unavailable');
 const text=result.stdout.trim();
 if(args.length?text!==''&&!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{7}Z$/.test(text):text.split(/\r?\n/).some(line=>!/^\d+ \d+$/.test(line)))throw Error('windows_process_observation_unavailable');
 return text;
}
