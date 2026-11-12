import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync,mkdirSync,cpSync,lstatSync,realpathSync,existsSync} from 'node:fs';
import {join,posix,dirname,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {list,extract} from 'tar';

// Git's pinned plugin archive has a SKILL.md file alias. Windows may leave a
// symlink behind while reporting EPERM, so neither extraction nor copying may
// depend on the machine's symlink privilege. Materialize only aliases of regular
// files from this same archive; never follow a filesystem link or leave the root.
export function extractPinnedArchiveWithoutLinks(archive,target){
 const temporary=realpathSync.native(mkdtempSync(join(tmpdir(),'kteam-source-archive-')));
 try{
  const file=join(temporary,'source.tar'),folder=join(temporary,'extracted');
  writeFileSync(file,archive,{mode:0o600});mkdirSync(folder);
  const entries=new Map(),names=new Set();
  const safe=name=>{if(typeof name!=='string'||!name||name.includes('\\')||name.includes(':')||posix.isAbsolute(name)||name.split('/').includes('..'))throw Error('pinned_archive_unsafe_path');const value=name.replace(/\/+$/,'');if(!value||posix.normalize(value)!==value)throw Error('pinned_archive_unsafe_path');return value;};
  list({file,sync:true,strict:true,onReadEntry:entry=>{
   const name=safe(entry.path),key=name.toLowerCase();
   if(names.has(key)||entries.size>=100000)throw Error('pinned_archive_duplicate_path');
   if(!['File','Directory','SymbolicLink'].includes(entry.type))throw Error('pinned_archive_unsupported_type');
   names.add(key);entries.set(name,{type:entry.type,link:entry.linkpath});
  }});
  for(const name of entries.keys())for(let parent=posix.dirname(name);parent!=='.';parent=posix.dirname(parent))if(entries.get(parent)?.type!=='Directory')throw Error('pinned_archive_unsafe_parent');
  extract({file,cwd:folder,sync:true,strict:true,filter:(_name,entry)=>entry.type!=='SymbolicLink'});
  const original=(name,seen=new Set())=>{if(seen.has(name))throw Error('pinned_archive_link_cycle');seen.add(name);const entry=entries.get(name);if(entry?.type==='File')return name;if(entry?.type!=='SymbolicLink'||!entry.link||posix.isAbsolute(entry.link)||entry.link.includes('\\')||entry.link.includes(':'))throw Error('pinned_archive_unsafe_link');return original(safe(posix.join(posix.dirname(name),entry.link)),seen);};
  for(const [name,entry] of entries)if(entry.type==='SymbolicLink'){
   const source=join(folder,original(name)),stat=lstatSync(source);
   if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw Error('pinned_archive_unsafe_link');
   cpSync(source,join(folder,name),{errorOnExist:true,force:false});
  }
  const destination=existsSync(target)?realpathSync.native(target):join(realpathSync.native(dirname(target)),basename(target));
  cpSync(folder,destination,{recursive:true,verbatimSymlinks:true});
 }finally{rmSync(temporary,{recursive:true,force:true});}
}

// POSIX keeps its original tar extraction. Windows materializes archive-local
// file aliases without relying on symlink privileges or narrow native argv.
export function extractPinnedArchive(archive,target){
 if(process.platform==='win32')return extractPinnedArchiveWithoutLinks(archive,target);
 const temporary=mkdtempSync(join(tmpdir(),'kteam-source-archive-'));
 try{const file=join(temporary,'source.tar');writeFileSync(file,archive,{mode:0o600});execFileSync('tar',['-xf',file,'-C',target],{stdio:'inherit'});}
 finally{rmSync(temporary,{recursive:true,force:true});}
}
