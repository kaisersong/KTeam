import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const runtime=async()=>await import(pathToFileURL(resolve('build/shared/kteam-runtime.mjs')).href) as any;
const enoent=()=>Object.assign(new Error('missing'),{code:'ENOENT'});
const regular=(size:number)=>({isFile:()=>true,isSymbolicLink:()=>false,nlink:1,size});
function deps(files:Record<string,Buffer|'deny'>,run?:{status:number|null;stdout:string;error?:Error}){
 const warnings:string[]=[],runs:string[]=[];
 const find=(path:string)=>Object.entries(files).find(([name])=>path.endsWith(name))?.[1];
 return {warnings,runs,deps:{platform:'win32',arch:'x64',machine:'x86_64',root:'/app',warn:(m:string)=>warnings.push(m),
  lstat:(path:string)=>{const f=find(path);if(f===undefined)throw enoent();if(f==='deny')throw Object.assign(new Error('denied'),{code:'EACCES'});return regular(f.length);},
  readFile:(path:string)=>{const f=find(path);if(!f||f==='deny')throw enoent();return f;},
  run:(helper:string)=>{runs.push(helper);return {status:run?.status??0,signal:null,stdout:Buffer.from(run?.stdout??''),error:run?.error};}}};
}
const exe=Buffer.from('MZ fixture helper');
const manifest=(over:Record<string,unknown>={})=>Buffer.from(JSON.stringify({version:1,target:'win32-x64',sourceSha256:'a'.repeat(64),coreSha256:'b'.repeat(64),sha256:createHash('sha256').update(exe).digest('hex'),...over}));

test('Windows absence helper not bundled (both files absent): writes unavailable, with a warning, and nothing is run',async()=>{
 const {observeWindowsInstallationAbsence}=await runtime();
 const f=deps({});assert.equal(observeWindowsInstallationAbsence(f.deps),'unavailable');
 assert.equal(f.warnings.length,1);assert.match(f.warnings[0]!,/^windows_absence_helper_not_bundled: windows-installation-absence helper is not bundled/);assert.match(f.warnings[0]!,/issues\/74/);assert.deepEqual(f.runs,[]);
});

test('Windows absence helper present but wrong or failing still denies fallback',async()=>{
 const {observeWindowsInstallationAbsence}=await runtime();
 const cases:Array<[string,ReturnType<typeof deps>]>=[
  ['only the exe',deps({'windows-installation-absence.exe':exe})],
  ['only the manifest',deps({'windows-installation-absence.json':manifest()})],
  ['unreadable file',deps({'windows-installation-absence.exe':'deny','windows-installation-absence.json':manifest()})],
  ['malformed manifest',deps({'windows-installation-absence.exe':exe,'windows-installation-absence.json':Buffer.from('{"version":1}')})],
  ['hash mismatch',deps({'windows-installation-absence.exe':exe,'windows-installation-absence.json':manifest({sha256:'c'.repeat(64)})})],
  ['helper exits non-zero',deps({'windows-installation-absence.exe':exe,'windows-installation-absence.json':manifest()},{status:1,stdout:'{"kind":"ordinary","version":1}'})],
  ['helper fails to start',deps({'windows-installation-absence.exe':exe,'windows-installation-absence.json':manifest()},{status:null,stdout:'',error:new Error('spawn failed')})],
  ['unexpected answer',deps({'windows-installation-absence.exe':exe,'windows-installation-absence.json':manifest()},{status:0,stdout:'{"kind":"ordinary"}'})],
 ];
 for(const [name,f] of cases){assert.equal(observeWindowsInstallationAbsence(f.deps),'unavailable',name);assert.deepEqual(f.warnings,[],name);}
 // A correct helper is still authoritative, including when it reports an installed profile.
 const installed=deps({'windows-installation-absence.exe':exe,'windows-installation-absence.json':manifest()},{status:0,stdout:'{"kind":"installed","version":1}'});
 assert.equal(observeWindowsInstallationAbsence(installed.deps),'installed');assert.equal(installed.runs.length,1);
 const ordinary=deps({'windows-installation-absence.exe':exe,'windows-installation-absence.json':manifest()},{status:0,stdout:'{"kind":"ordinary","version":1}'});
 assert.equal(observeWindowsInstallationAbsence(ordinary.deps),'ordinary');
});

test('the absence fallback never applies off Windows or to an emulated architecture',async()=>{
 const {observeWindowsInstallationAbsence,readWindowsInstallationAbsence}=await runtime();
 assert.equal(observeWindowsInstallationAbsence({...deps({}).deps,platform:'darwin'}),'unavailable');
 assert.equal(observeWindowsInstallationAbsence({...deps({}).deps,arch:'ia32'}),'unavailable');
 assert.equal(observeWindowsInstallationAbsence({...deps({}).deps,machine:'aarch64'}),'unavailable');
 if(process.platform!=='win32')assert.equal(readWindowsInstallationAbsence(),'unavailable');
});
