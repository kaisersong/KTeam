// electron-builder 26.15.7 follows a symlink with stat while collecting the
// project. A files exclusion does not run before that stat. These two links
// are documentation references, not the desktop payload. Packing copies the
// inputs into a temporary tree and leaves every source path in place.
import {spawnSync} from 'node:child_process';
import {copyFileSync,lstatSync,mkdirSync,readlinkSync,readdirSync,realpathSync,rmSync,statSync,symlinkSync,linkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename,dirname,join,resolve,sep} from 'node:path';

export const NON_PAYLOAD_LINKS=['design-qa.md','docs'];

export function commandStatus(result){
  if(!result||result.error||result.signal||result.status===null||result.status===undefined)return null;
  return result.status;
}

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

function failure(code){const error=new Error(code);error.code=code;return error;}
function canonical(path){try{return realpathSync(path);}catch{return resolve(path);}}

export function stagePackTree(root,destination){
  const source=realpathSync(resolve(root));
  const requested=resolve(destination);
  const parent=canonical(dirname(requested));
  const target=join(parent,basename(requested));
  if(target===source||target.startsWith(source+sep))throw failure('pack_stage_inside_source');
  const plan=packInputPlan(source);
  const omit=new Set([...plan.hide,'.git','release']);
  rmSync(target,{recursive:true,force:true});
  mkdirSync(target,{recursive:true});
  try{mirror(source,target,source,omit,true);}
  catch(error){rmSync(target,{recursive:true,force:true});throw error;}
  return {plan,destination:target};
}

function insideSource(source,path){const resolved=resolve(path);return resolved===source||resolved.startsWith(source+sep);}
function mirror(src,dest,source,omit,top){
  for(const name of readdirSync(src)){
    if(top&&omit.has(name))continue;
    const from=join(src,name),to=join(dest,name),info=lstatSync(from);
    if(info.isSymbolicLink()){
      const link=readlinkSync(from);
      const resolved=resolve(dirname(from),link);
      symlinkSync(insideSource(source,resolved)?link:resolved,to);
      continue;
    }
    if(info.isDirectory()){mkdirSync(to);mirror(from,to,source,omit,false);continue;}
    if(!info.isFile())throw failure('pack_stage_unsupported:'+name);
    const inModules=from.includes(sep+'node_modules'+sep);
    if(inModules){try{linkSync(from,to);continue;}catch(error){if(!error||error.code!=='EXDEV')throw error;}}
    copyFileSync(from,to);
  }
}

export function statVisiblePackEntries(root){
  const names=[];
  for(const name of readdirSync(root)){
    statSync(join(root,name));
    names.push(name);
  }
  return names.sort();
}

export function runPack(options){
  const root=realpathSync(resolve(options.root));
  const stdio=options.stdio??'inherit';
  const env=options.env??process.env;
  const built=spawnSync(options.build[0],options.build.slice(1),{cwd:root,stdio,env});
  if(commandStatus(built)!==0)return commandStatus(built)??1;
  const destination=options.stage??join(tmpdir(),'kteam-pack-stage-'+process.pid+'-'+Math.random().toString(16).slice(2));
  let status=1,staged=destination;
  try{
    staged=stagePackTree(root,destination).destination;
    const packed=spawnSync(options.pack[0],options.pack.slice(1),{cwd:staged,stdio,env});
    if(commandStatus(packed)!==0)status=commandStatus(packed)??1;
    else if(!options.verify)status=0;
    else{
      const verified=spawnSync(options.verify[0],options.verify.slice(1),{cwd:root,stdio,env});
      status=commandStatus(verified)??1;
    }
  }finally{
    if(!options.keepStage&&staged!==root&&!staged.startsWith(root+sep))rmSync(staged,{recursive:true,force:true});
  }
  return status;
}
