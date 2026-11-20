import {spawnSync} from 'node:child_process';
import {copyFileSync,existsSync,mkdirSync,mkdtempSync,readdirSync,readlinkSync,realpathSync,rmSync,symlinkSync} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {basename,delimiter,dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';

function failed(code,status,signal){
  const error=Error(code);
  error.status=status??null;
  error.signal=signal??null;
  return error;
}

export function commandNeedsShell(platform,command){return platform==='win32'&&/\.(?:cmd|bat)$/i.test(command);}
export function quoteCmdArgument(value){return '"'+String(value).replaceAll('"','""')+'"';}

/** Run one batch file. Each argument stays quoted. cmd /s drops one outer pair, so that pair is added around them. */
export function spawnBatchFile(scriptPath,args=[],options={}){
  const command='"'+[quoteCmdArgument(scriptPath),...args.map(quoteCmdArgument)].join(' ')+'"';
  return spawnSync(options.comSpec??process.env.ComSpec??'cmd.exe',['/d','/s','/c',command],{
    cwd:options.cwd,env:options.env??process.env,stdio:options.stdio,encoding:options.encoding,
    windowsVerbatimArguments:true,windowsHide:true,timeout:options.timeout,
  });
}

function containsPath(parent,child){
  const root=realpathSync.native(parent);
  const file=realpathSync.native(child);
  return file===root||file.startsWith(root+sep);
}

function linkEscapes(root,linkPath){
  let resolved;
  try{resolved=realpathSync.native(linkPath);}
  catch{resolved=resolve(dirname(linkPath),readlinkSync(linkPath));}
  const fromRoot=relative(root,resolved);
  return fromRoot==='..'||fromRoot.startsWith('..'+sep)||isAbsolute(fromRoot);
}

/** Refuse a symlink whose target is outside this source. Links that stay inside are kept. */
function assertNoEscapingLink(sourceRoot){
  const root=realpathSync.native(sourceRoot);
  const visit=(directory)=>{
    for(const entry of readdirSync(directory,{withFileTypes:true})){
      if(entry.name==='node_modules')continue;
      const path=join(directory,entry.name);
      if(entry.isSymbolicLink()){
        if(linkEscapes(root,path))throw Error('mobile_install_link_escapes');
        continue;
      }
      if(entry.isDirectory())visit(path);
    }
  };
  visit(root);
}

function copyMobileSource(source,destination){
  const root=realpathSync.native(source);
  mkdirSync(destination,{recursive:true});
  const visit=(directory,destDir)=>{
    for(const entry of readdirSync(directory,{withFileTypes:true})){
      if(entry.name==='node_modules')continue;
      const from=join(directory,entry.name);
      const to=join(destDir,entry.name);
      if(entry.isSymbolicLink()){
        let resolved;
        try{resolved=realpathSync.native(from);}
        catch{resolved=resolve(directory,readlinkSync(from));}
        symlinkSync(relative(directory,resolved),to);
        continue;
      }
      if(entry.isDirectory()){mkdirSync(to);visit(from,to);continue;}
      copyFileSync(from,to);
    }
  };
  visit(root,destination);
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
  assertNoEscapingLink(sourceRoot);
  const parent=mkdtempSync(join(tmpdir(),'kteam-mobile-install-'));
  const privateRoot=join(parent,'tree');
  try{
    copyMobileSource(sourceRoot,privateRoot);
    if(containsPath(sourceRoot,privateRoot))throw Error('mobile_install_not_private');
    const env=options.env??process.env;
    const args=options.args??['ci','--ignore-scripts','--no-audit','--no-fund'];
    const npm=env.npm_execpath;
    const useNodeNpm=!options.command&&npm&&isAbsolute(npm)&&basename(npm).toLowerCase()==='npm-cli.js'&&existsSync(npm);
    // A relative npm.cmd can make cmd's %~dp0 resolve inside the private install's cwd.
    const windowsNpm=()=>Object.entries(env).find(([name])=>name.toLowerCase()==='path')?.[1]?.split(delimiter)
      .filter(directory=>isAbsolute(directory)).map(directory=>join(directory,'npm.cmd')).find(existsSync);
    const command=options.command??(useNodeNpm?process.execPath:process.platform==='win32'?windowsNpm():'npm');
    if(!command)throw failed('mobile_install_npm_unavailable');
    const result=runInstall(command,useNodeNpm?[npm,...args]:args,{cwd:privateRoot,stdio:options.stdio??'inherit',env});
    if(result.error)throw result.error;
    if(result.status!==0||result.signal)throw failed('mobile_install_failed',result.status,result.signal);
    return body(realpathSync.native(privateRoot));
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
  try{install=realpathSync.native(join(mobile,'node_modules'));}
  catch{install='';}
  if(!resolved.startsWith(sep)&&!/^[A-Za-z]:[\\/]/.test(resolved))throw failed('mobile_dependency_outside_mobile:'+specifier);
  const file=realpathSync.native(resolved);
  if(!install||(file!==install&&!file.startsWith(install+sep)))throw failed('mobile_dependency_outside_mobile:'+specifier);
  return require(specifier);
}
