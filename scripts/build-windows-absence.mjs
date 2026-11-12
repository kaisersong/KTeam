import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync,renameSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
// This diagnostic is part of KTeam's own runtime. No installed app, user config or external checkout is read.
if(process.platform==='win32'){
 if(!['x64','arm64'].includes(process.arch))throw Error('windows_absence_arch_unsupported');
 const root=resolve('.'),core=join(root,'runtime-core/native/windows-installation-absence-core.h');
 const header=readFileSync(core),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
 const programs=['windows-installation-absence','windows-credential-acl','windows-process-observer'].map(name=>({name,source:join(root,'runtime-core/native',name+'.c'),input:readFileSync(join(root,'runtime-core/native',name+'.c'))}));
 const out=join(root,'build/shared/native','win32-'+process.arch);mkdirSync(out,{recursive:true});
 const stage=mkdtempSync(join(out,'.compile-'));
 try{
  let environment;try{
   const finder=join(process.env['ProgramFiles(x86)']??'C:\\Program Files (x86)','Microsoft Visual Studio/Installer/vswhere.exe');
   const installation=execFileSync(finder,['-latest','-products','*','-requires','Microsoft.VisualStudio.Component.VC.Tools.x86.x64','-property','installationPath'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:15000}).trim();
   if(!/^[A-Za-z]:\\[^"\r\n&|<>%^!]+$/.test(installation))throw Error();
   const setup=join(installation,'Common7/Tools/VsDevCmd.bat'),arch=process.arch==='x64'?'amd64':'arm64';
   const rows=execFileSync(join(process.env.SystemRoot??'C:\\Windows','System32/cmd.exe'),['/d','/s','/c','""'+setup+'" -no_logo -arch='+arch+' && set"'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],windowsVerbatimArguments:true,timeout:30000,maxBuffer:1024*1024});
   environment=Object.fromEntries(rows.split(/\r?\n/).filter(line=>/^[^=]+=/.test(line)).map(line=>{const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1)];}));
  }catch{throw Error('windows_absence_compiler_unavailable');}
  writeFileSync(join(stage,'windows-installation-absence-core.h'),header);
  for(const {name,source,input} of programs){
   const c=join(stage,name+'.c'),exe=join(stage,name+'.exe');writeFileSync(c,input);
   try{execFileSync('cl.exe',['/nologo','/std:c11','/W4','/WX','/O2','/MT','/GS','/guard:cf',c,'/Fe:'+exe,'/Fo:'+join(stage,name+'.obj'),'/link','/DYNAMICBASE','/NXCOMPAT','/GUARD:CF','shell32.lib','ole32.lib','advapi32.lib','uuid.lib'],{env:environment,cwd:stage,stdio:['ignore','pipe','pipe'],timeout:60000,maxBuffer:1024*1024});}catch(error){throw Error('windows_native_compile_failed:'+name+':'+String(error.stdout??error.stderr??'').slice(-2000));}
   const bytes=readFileSync(exe),offset=bytes.length>=64?bytes.readUInt32LE(60):-1;
   if(bytes.toString('ascii',0,2)!=='MZ'||offset<64||offset+24>bytes.length||bytes.toString('ascii',offset,offset+4)!=='PE\0\0'||bytes.readUInt16LE(offset+4)!==(process.arch==='x64'?0x8664:0xaa64))throw Error('windows_native_target_mismatch');
   if(!readFileSync(source).equals(input)||!readFileSync(core).equals(header))throw Error('windows_native_source_changed');
   const manifest={version:1,target:'win32-'+process.arch,sha256:sha(bytes),sourceSha256:sha(input),...(name==='windows-installation-absence'?{coreSha256:sha(header)}:{})};
   renameSync(exe,join(out,name+'.exe'));writeFileSync(join(out,name+'.json'),JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify({windowsNative:manifest.target,program:name,sourceSha256:manifest.sourceSha256}));
  }
 }finally{rmSync(stage,{recursive:true,force:true});}
}
