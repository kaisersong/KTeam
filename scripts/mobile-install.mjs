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

export function commandNeedsShell(platform,command){return platform==='win32'&&/\.(?:cmd|bat)$/i.test(command);}
export function quoteCmdArgument(value){return '"'+String(value).replaceAll('"','""')+'"';}

/** Run one batch file. The path is a single quoted argv, not an unquoted shell command line. */
export function spawnBatchFile(scriptPath,args=[],options={}){
  const command=[quoteCmdArgument(scriptPath),...args.map(quoteCmdArgument)].join(' ');
  return spawnSync(options.comSpec??process.env.ComSpec??'cmd.exe',['/d','/s','/c',command],{
    cwd:options.cwd,env:options.env??process.env,stdio:options.stdio,encoding:options.encoding,
    windowsVerbatimArguments:true,windowsHide:true,
  });
}

const ownedSupervisor=`
import {spawn,spawnSync} from 'node:child_process';
import {watch} from 'node:fs';
const parent=Number(process.argv[1]);
const spec=JSON.parse(process.argv[2]);
const child=spawn(spec.command,spec.args,{cwd:spec.cwd,env:process.env,stdio:'inherit',shell:spec.shell,windowsHide:true,detached:process.platform!=='win32'});
let stopping=false;
const stop=()=>{
  if(stopping)return;
  stopping=true;
  if(!child.pid){process.exit(1);return;}
  if(process.platform==='win32')spawnSync('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});
  else {try{process.kill(-child.pid,'SIGKILL');}catch{try{child.kill('SIGKILL');}catch{/* already gone */}}}
  process.exit(1);
};
const parentGone=()=>{try{process.kill(parent,0);return false;}catch{return true;}};
const timer=setInterval(()=>{if(parentGone())stop();},50);
if(process.platform==='linux'){try{watch('/proc/'+parent,()=>stop());}catch{/* The poll remains. */}}
for(const signal of ['SIGTERM','SIGINT','SIGHUP'])process.on(signal,stop);
child.on('exit',(code,signal)=>{clearInterval(timer);if(signal){try{process.kill(process.pid,signal);}catch{/* Fall through. */}setTimeout(()=>process.exit(1),100);return;}process.exit(code??1);});
`;

function spawnOwned(command,args,options){
  const spec=JSON.stringify({command,args,cwd:options.cwd,shell:commandNeedsShell(process.platform,command)});
  return spawnSync(process.execPath,['--input-type=module','-e',ownedSupervisor,String(process.pid),spec],{
    cwd:options.cwd,env:options.env??process.env,stdio:options.stdio??'inherit',windowsHide:true,
  });
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
    const result=spawnOwned(command,args,{cwd:mobile,stdio:options.stdio??'inherit',env:options.env??process.env});
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
