// electron-builder 26.15.7 follows a symlink with stat while collecting the
// project. A files exclusion does not run before that stat. These two links
// are documentation references, not the desktop payload. When their targets
// are absent, the pack step moves the links aside and restores them afterwards.
import {lstatSync,mkdirSync,readdirSync,readlinkSync,renameSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

export const NON_PAYLOAD_LINKS=['design-qa.md','docs'];

export function packInputPlan(root){
  const entries=readdirSync(root);
  const hide=[];
  const links=[];
  const unexpected=[];
  for(const name of entries){
    const full=join(root,name);
    const info=lstatSync(full);
    if(!info.isSymbolicLink())continue;
    const target=readlinkSync(full);
    let statError;
    try{statSync(full);}catch(error){statError=error&&error.code;}
    const dangling=statError==='ENOENT';
    links.push({name,target,dangling});
    if(!dangling)continue;
    if(NON_PAYLOAD_LINKS.includes(name))hide.push(name);
    else unexpected.push(name);
  }
  if(unexpected.length){
    const error=new Error('pack_dangling_symlink:'+unexpected.sort().join(','));
    error.code='pack_dangling_symlink';
    throw error;
  }
  hide.sort();
  return {hide,links};
}

export function hideDanglingPackLinks(root){
  const plan=packInputPlan(root);
  const directory=join(tmpdir(),'kteam-pack-links-'+process.pid+'-'+Math.random().toString(16).slice(2));
  mkdirSync(directory,{recursive:true});
  const moved=[];
  try{
    for(const name of plan.hide){
      renameSync(join(root,name),join(directory,name));
      moved.push(name);
    }
  }catch(error){
    for(const name of moved)renameSync(join(directory,name),join(root,name));
    rmSync(directory,{recursive:true,force:true});
    throw error;
  }
  return {plan,restore(){
    for(const name of moved){
      const dest=join(root,name);
      try{lstatSync(dest);}catch(error){if(error&&error.code==='ENOENT'){renameSync(join(directory,name),dest);continue;}}
      throw new Error('pack_link_restore_blocked:'+name);
    }
    rmSync(directory,{recursive:true,force:true});
  }};
}

export function statVisiblePackEntries(root){
  const names=[];
  for(const name of readdirSync(root)){
    statSync(join(root,name));
    names.push(name);
  }
  return names.sort();
}
