// electron-builder 26.15.7 follows a symlink with stat while collecting the
// project. A files exclusion does not run before that stat. Staging keeps the
// source tree unchanged: files are cloned or copied into a new inode, and the
// two known documentation links are left out. A link that resolves outside the
// project is copied only when it is the node_modules package root. The copy
// stops at that root: escaping links are not followed, and .git, .env, and
// .env.* stay out. Links that stay inside the project are rewritten relative
// to the stage. A cycle fails closed. Any other dangling link in the project
// fails closed. Fresh build identity is copied only after the build.
import {spawnSync} from 'node:child_process';
import {constants,copyFileSync,lstatSync,mkdirSync,readlinkSync,readdirSync,realpathSync,rmSync,statSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {basename,dirname,join,relative,resolve,sep} from 'node:path';

export const NON_PAYLOAD_LINKS=['design-qa.md','docs'];
export const PACK_ROOT_FILES=['package.json','package-lock.json','electron-builder.yml','LICENSE','NOTICE'];
export const FRESH_IDENTITY=['build/build-info.json','build/package-identity/build-info.json'];
const DESKTOP_ENTRIES=new Set(['assets','yzj-cli','bin','skills','app-update.yml']);
const cloneFlag=constants.COPYFILE_FICLONE??0;

export function commandStatus(result){
  if(!result||result.error||result.signal||result.status===null||result.status===undefined)return null;
  return result.status;
}

function failure(code,detail){const error=new Error(detail?code+':'+detail:code);error.code=code;return error;}
function canonical(path){try{return realpathSync(path);}catch{return resolve(path);}}
function display(path){return path.split(sep).join('/');}
function sensitiveName(name){return name==='.git'||name==='.env'||name.startsWith('.env.');}
function omitted(rel){
  return rel==='build/build-info.json'||rel==='build/package-identity'||rel.startsWith('build/package-identity/')||rel==='build/test-reports'||rel.startsWith('build/test-reports/');
}
function included(rel){
  const base=rel.split('/').at(-1)??'';
  if(!rel||base==='.git'||base==='.env'||base.startsWith('.env.')||omitted(rel))return false;
  if(PACK_ROOT_FILES.includes(rel))return true;
  if(rel==='vendor/splash/THIRD-PARTY-NOTICES.txt')return true;
  if(rel==='build'||rel.startsWith('build/'))return true;
  if(rel==='node_modules'||rel.startsWith('node_modules/'))return true;
  if(rel==='desktop/app-update.yml')return true;
  const desktop=rel.startsWith('desktop/')?rel.slice('desktop/'.length):'';
  if(!desktop)return false;
  const entry=desktop.split('/')[0];
  return DESKTOP_ENTRIES.has(entry);
}

function symlinkFacts(full){
  const target=readlinkSync(full);
  try{statSync(full);return {target,dangling:false,loop:false};}
  catch(error){if(error&&error.code==='ELOOP')return {target,dangling:true,loop:true};if(error&&error.code==='ENOENT')return {target,dangling:true,loop:false};throw error;}
}

export function packInputPlan(root){
  const hide=[];
  const links=[];
  const unexpected=[];
  const cycles=[];
  const visit=(dir)=>{
    for(const name of readdirSync(dir)){
      if(dir===root&&(name==='.git'||sensitiveName(name)))continue;
      const full=join(dir,name);
      const rel=display(relative(root,full));
      const info=lstatSync(full);
      if(info.isSymbolicLink()){
        const facts=symlinkFacts(full);
        links.push({name:rel,target:facts.target,dangling:facts.dangling});
        if(facts.loop){cycles.push(rel);continue;}
        if(!facts.dangling)continue;
        if(!rel.includes('/')&&NON_PAYLOAD_LINKS.includes(name))hide.push(name);
        else unexpected.push(rel);
        continue;
      }
      if(info.isDirectory())visit(full);
    }
  };
  visit(root);
  if(cycles.length)throw failure('pack_stage_symlink_cycle',cycles.sort().join(','));
  if(unexpected.length)throw failure('pack_dangling_symlink',unexpected.sort().join(','));
  hide.sort();
  return {hide,links};
}

function copyIndependent(from,to){copyFileSync(from,to,cloneFlag);}

export function stagePackTree(root,destination){
  const source=realpathSync(resolve(root));
  const requested=resolve(destination);
  const parent=canonical(dirname(requested));
  const target=join(parent,basename(requested));
  if(target===source||target.startsWith(source+sep))throw failure('pack_stage_inside_source');
  const plan=packInputPlan(source);
  const hidden=new Set(plan.hide);
  rmSync(target,{recursive:true,force:true});
  mkdirSync(target,{recursive:true});
  try{mirror(source,target,source,target,hidden,'');}
  catch(error){rmSync(target,{recursive:true,force:true});throw error;}
  return {plan,destination:target};
}

function insidePath(root,path){return path===root||path.startsWith(root+sep);}
function dependencyRootLink(rel){
  const parts=rel.split('/');
  if(parts[0]!=='node_modules')return false;
  if(parts.length===2)return parts[1]!=='.bin'&&!parts[1].startsWith('.');
  return parts.length===3&&parts[1].startsWith('@')&&parts[2]!=='';
}
// Copy one explicit dependency root. Do not follow a link out of that root:
// those targets are private checkouts, home data, or documentation trees.
function copyDependency(from,to,packageRoot,stagedRoot){
  if(from!==packageRoot&&sensitiveName(basename(from)))return;
  const info=lstatSync(from);
  if(info.isSymbolicLink()){
    const facts=symlinkFacts(from);
    if(facts.loop)throw failure('pack_stage_symlink_cycle',from);
    if(facts.dangling)return;
    const resolved=resolve(dirname(from),facts.target);
    let real;try{real=realpathSync(resolved);}catch(error){if(error&&error.code==='ELOOP')throw failure('pack_stage_symlink_cycle',resolved);throw error;}
    if(!insidePath(packageRoot,real))return;
    symlinkSync(relative(dirname(to),join(stagedRoot,relative(packageRoot,real)))||'.',to);
    return;
  }
  if(info.isDirectory()){
    mkdirSync(to,{recursive:true});
    for(const name of readdirSync(from))copyDependency(join(from,name),join(to,name),packageRoot,stagedRoot);
    return;
  }
  if(info.isFile()){copyIndependent(from,to);return;}
  throw failure('pack_stage_unsupported',from);
}
function mirror(src,dest,source,stageRoot,hidden,rel){
  for(const name of readdirSync(src)){
    const next=rel?rel+'/'+name:name;
    if(hidden.has(next)||!rel&&sensitiveName(name)||omitted(next)||!included(next)&&!includedPrefix(next))continue;
    const from=join(src,name),to=join(dest,name),info=lstatSync(from);
    if(info.isSymbolicLink()){
      const facts=symlinkFacts(from);
      if(facts.dangling)throw failure('pack_dangling_symlink',next);
      const resolved=resolve(dirname(from),facts.target);
      let realTarget;
      try{realTarget=realpathSync(resolved);}
      catch(error){
        if(error&&error.code==='ELOOP')throw failure('pack_stage_symlink_cycle',next);
        if(error&&error.code==='ENOENT')throw failure('pack_dangling_symlink',next);
        throw error;
      }
      // A logical path inside the project stays inside after dependency roots are copied.
      // realpath also accepts an absolute link whose prefix differs only by a directory alias.
      const logicalInside=insidePath(source,resolved),realInside=insidePath(source,realTarget);
      if(logicalInside||realInside){
        const basis=logicalInside?resolved:realTarget;
        const stagedTarget=join(stageRoot,relative(source,basis));
        symlinkSync(relative(dirname(to),stagedTarget)||'.',to);
      }else if(dependencyRootLink(next)){
        const packageRoot=realpathSync(resolved);
        copyDependency(packageRoot,to,packageRoot,to);
      }else throw failure('pack_external_link_unscoped',next);
      continue;
    }
    if(info.isDirectory()){
      if(!hasIncludedDescendant(next)&&!included(next))continue;
      mkdirSync(to);
      mirror(from,to,source,stageRoot,hidden,next);
      continue;
    }
    if(!included(next))continue;
    if(!info.isFile())throw failure('pack_stage_unsupported',next);
    copyIndependent(from,to);
  }
}
function includedPrefix(rel){
  if(rel==='vendor'||rel==='vendor/splash'||rel==='desktop'||rel==='build'||rel==='node_modules')return true;
  if(rel.startsWith('desktop/'))return DESKTOP_ENTRIES.has(rel.slice('desktop/'.length).split('/')[0]);
  if(rel.startsWith('build/')||rel.startsWith('node_modules/')||rel.startsWith('vendor/'))return true;
  return false;
}
function hasIncludedDescendant(rel){return includedPrefix(rel);}

export function placeFreshIdentity(source,destination){
  for(const rel of FRESH_IDENTITY){
    const from=join(source,rel);
    let info;try{info=lstatSync(from);}catch{throw failure('pack_identity_missing',rel);}
    if(!info.isFile()||info.isSymbolicLink())throw failure('pack_identity_missing',rel);
    const to=join(destination,rel);
    mkdirSync(dirname(to),{recursive:true});
    copyIndependent(from,to);
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
    if(options.requireIdentity!==false)placeFreshIdentity(root,staged);
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
