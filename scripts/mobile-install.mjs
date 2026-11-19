import {spawnSync} from 'node:child_process';
import {mkdirSync,realpathSync} from 'node:fs';
import {createRequire} from 'node:module';
import {join,sep} from 'node:path';
import {DatabaseSync} from 'node:sqlite';

function failed(code,status,signal){
  const error=Error(code);
  error.status=status??null;
  error.signal=signal??null;
  return error;
}

function openInstallLock(lockDirectory){
  mkdirSync(lockDirectory,{recursive:true});
  const db=new DatabaseSync(join(lockDirectory,'lock.sqlite'));
  db.exec('PRAGMA busy_timeout=3600000');
  try{db.exec('BEGIN IMMEDIATE');}
  catch(error){db.close();throw error;}
  return {release(){try{db.exec('ROLLBACK');}catch{/* The connection closes next. */}db.close();}};
}

/** Hold the install lock through `body`, so a second run cannot replace node_modules while this run still reads it. */
export function withMobileInstall(options,body=()=>undefined){
  const mobile=options?.mobile;
  if(!mobile)throw Error('mobile_directory_required');
  const lock=openInstallLock(options.lockDirectory??join(mobile,'..','build','mobile-install-lock'));
  try{
    const command=options.command??(process.platform==='win32'?'npm.cmd':'npm');
    const args=options.args??['ci','--ignore-scripts','--no-audit','--no-fund'];
    const result=spawnSync(command,args,{cwd:mobile,stdio:options.stdio??'inherit',env:options.env??process.env});
    if(result.error)throw result.error;
    if(result.status!==0||result.signal)throw failed('mobile_install_failed',result.status,result.signal);
    return body();
  }finally{lock.release();}
}

export function installMobileDependencies(options){return withMobileInstall(options);}

/** Resolve only inside this mobile install. A root package is not a substitute. */
export function requireFromMobileInstall(mobile,specifier){
  const require=createRequire(join(mobile,'package.json'));
  let resolved;
  try{resolved=require.resolve(specifier);}
  catch(error){
    if(error?.code==='MODULE_NOT_FOUND')throw failed('mobile_dependency_missing:'+specifier);
    throw error;
  }
  let install;
  try{install=realpathSync(join(mobile,'node_modules'));}
  catch{install='';}
  if(!resolved.startsWith(sep)&&!/^[A-Za-z]:[\\/]/.test(resolved))throw failed('mobile_dependency_outside_mobile:'+specifier);
  const file=realpathSync(resolved);
  if(!install||(file!==install&&!file.startsWith(install+sep)))throw failed('mobile_dependency_outside_mobile:'+specifier);
  return require(specifier);
}
