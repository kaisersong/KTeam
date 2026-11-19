import {spawnSync} from 'node:child_process';
import {cpSync,existsSync,mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';

function failed(code,status,signal){
  const error=Error(code);
  error.status=status??null;
  error.signal=signal??null;
  return error;
}

export function commandNeedsShell(platform,command){return platform==='win32'&&/\.(?:cmd|bat)$/i.test(command);}
export function quoteCmdArgument(value){return '"'+String(value).replaceAll('"','""')+'"';}

/** Run one batch file. The path and each argument stay separately quoted. */
export function spawnBatchFile(scriptPath,args=[],options={}){
  const command=[quoteCmdArgument(scriptPath),...args.map(quoteCmdArgument)].join(' ');
  return spawnSync(options.comSpec??process.env.ComSpec??'cmd.exe',['/d','/s','/c',command],{
    cwd:options.cwd,env:options.env??process.env,stdio:options.stdio,encoding:options.encoding,
    windowsVerbatimArguments:true,windowsHide:true,
  });
}

function containsPath(parent,child){
  const root=realpathSync(parent);
  const file=realpathSync(child);
  return file===root||file.startsWith(root+sep);
}

function copyMobileSource(source,destination){
  cpSync(source,destination,{recursive:true,filter(path){return !path.split(sep).includes('node_modules');}});
}

/** Install into a private directory. Callers only receive that directory, so another run cannot read or write it. */
function runInstall(command,args,options){
  if(commandNeedsShell(process.platform,command))return spawnBatchFile(command,args,options);
  return spawnSync(command,args,{
    cwd:options.cwd,env:options.env??process.env,stdio:options.stdio,encoding:options.encoding,windowsHide:true,
  });
}

/**
 * Copy `options.mobile` into a new private directory and install there.
 * The writable tree is never the shared source. A child that keeps running after this process dies can only change the private directory.
 */
export function withMobileInstall(options,body=()=>undefined){
  const source=options?.mobile;
  if(!source)throw Error('mobile_directory_required');
  const sourceRoot=resolve(source);
  if(!existsSync(sourceRoot))throw Error('mobile_directory_required');
  const parent=mkdtempSync(join(tmpdir(),'kteam-mobile-install-'));
  const privateRoot=join(parent,'tree');
  try{
    copyMobileSource(sourceRoot,privateRoot);
    if(containsPath(sourceRoot,privateRoot))throw Error('mobile_install_not_private');
    const command=options.command??(process.platform==='win32'?'npm.cmd':'npm');
    const args=options.args??['ci','--ignore-scripts','--no-audit','--no-fund'];
    const result=runInstall(command,args,{cwd:privateRoot,stdio:options.stdio??'inherit',env:options.env??process.env});
    if(result.error)throw result.error;
    if(result.status!==0||result.signal)throw failed('mobile_install_failed',result.status,result.signal);
    return body(privateRoot);
  }finally{rmSync(parent,{recursive:true,force:true});}
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
