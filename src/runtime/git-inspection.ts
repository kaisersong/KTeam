import {existsSync,lstatSync,readFileSync,realpathSync,statSync} from 'node:fs';
import {dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {KTeamError,fields,record,text} from '../errors.js';
import {runLocal} from './local-process.js';
import {WINDOWS_SYSTEM_ENV} from './local-agents.js';

export const gitInspectionName='git_inspect';
const operations=['refs','history','containing_branches','fetch_refspec'] as const;
const quote=(value:string)=>"'"+value.replaceAll("'","'\\''")+"'";
const contained=(root:string,path:string)=>{
 const rel=relative(root,path);
 return rel!== '..'&&!rel.startsWith('..'+sep)&&!isAbsolute(rel);
};

export function gitInspection(value:unknown,workspace:string){
 const input=record(value);fields(input,['repository','operation','revision','remote','limit']);
 const operation=text(input.operation,'git_operation');
 if(!operations.some(candidate=>candidate===operation))throw new KTeamError('git_inspection_invalid');
 if((input.revision!==undefined&&!['history','containing_branches'].includes(operation))||
    (input.remote!==undefined&&operation!=='fetch_refspec')||(input.limit!==undefined&&operation==='fetch_refspec'))throw new KTeamError('git_inspection_invalid');
 const requested=resolve(workspace,input.repository===undefined?'.':text(input.repository,'repository',4096));
 const repository=realpathSync(requested),gitDirectory=join(repository,'.git');
 const repositoryStat=statSync(repository),gitStat=lstatSync(gitDirectory);
 // First-party metadata only. Linked worktrees and paths that jump through a
 // symlink require the existing terminal path and its additional scope checks.
 if(!contained(workspace,repository)||requested!==repository||!gitStat.isDirectory()||
    ['commondir','config.worktree','objects/info/alternates','objects/info/http-alternates'].some(path=>existsSync(join(gitDirectory,path))))throw new KTeamError('git_inspection_scope_denied',403);
 const metadata=['HEAD','config','refs','objects','packed-refs','reftable'].map(name=>join(gitDirectory,name)).filter(path=>{
  try{return !!lstatSync(path);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}
 });
 if(metadata.some(path=>realpathSync(path)!==path))throw new KTeamError('git_inspection_scope_denied',403);
 const config=join(gitDirectory,'config'),configStat=lstatSync(config);
 if(!configStat.isFile()||configStat.nlink!==1||configStat.size>256*1024)
  throw new KTeamError('git_inspection_scope_denied',403);
 // These Git commands load repository config. Keep the typed tool within
 // the repository by rejecting configurations that include another file.
 if(/^\s*\[\s*include(?:if)?(?=[\s.\]])/im.test(readFileSync(config,'utf8')))
  throw new KTeamError('git_inspection_scope_denied',403);
 const limit=input.limit??20;
 if(typeof limit!=='number'||!Number.isInteger(limit)||limit<1||limit>100)throw new KTeamError('git_inspection_invalid');
 const revision=input.revision===undefined?'HEAD':text(input.revision,'revision');
 // Accept ref names and commit IDs. Do not pass options, reflog expressions, or path selectors.
 if(!/^[A-Za-z0-9][A-Za-z0-9._/~-]*$/.test(revision)||revision.includes('..'))throw new KTeamError('git_inspection_invalid');
 const remote=input.remote===undefined?'origin':text(input.remote,'remote');
 if(!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(remote))throw new KTeamError('git_inspection_invalid');
 const args=operation==='refs'?['for-each-ref','--format=%(refname) %(objectname)',`--count=${limit}`]:
  operation==='history'?['log',`-${limit}`,'--format=%H %cI %s',revision,'--']:
  operation==='containing_branches'?['branch','-a','--contains',revision]:
  ['config','--get-all',`remote.${remote}.fetch`];
 const identity=[repositoryStat.dev,repositoryStat.ino,gitStat.dev,gitStat.ino,configStat.ino,configStat.mtimeMs,configStat.ctimeMs];
 return {repository,gitDirectory,metadata,identity,operation,args,limit,command:'git '+args.map(arg=>/^[A-Za-z0-9._/=-]+$/.test(arg)?arg:quote(arg)).join(' ')};
}

export function createGitInspectionTool(workspace:string,redact:(value:string)=>string,authorize:(input:Record<string,unknown>)=>Promise<boolean>){
 return {permission:'safe',definition:{name:gitInspectionName,description:'读取当前工作目录内的 Git 仓库。支持引用、提交历史、包含指定提交的分支、远端抓取规则。只读查询优先使用本工具。',inputSchema:{type:'object',additionalProperties:false,required:['operation'],properties:{repository:{type:'string'},operation:{type:'string',enum:operations},revision:{type:'string'},remote:{type:'string'},limit:{type:'integer',minimum:1,maximum:100}}}},async execute(input:Record<string,unknown>,context:{signal:AbortSignal}){
  if(!await authorize(input))throw new KTeamError('git_inspection_scope_denied',403);
  const target=gitInspection(input,workspace);
  const paths=process.platform==='win32'?[process.env.ProgramFiles,process.env.ProgramW6432,process.env['ProgramFiles(x86)']].filter(Boolean).map(root=>join(root!,'Git','bin','git.exe')):['/usr/bin/git','/usr/local/bin/git'];
  const executable=paths.find(path=>existsSync(path));
  if(!executable)throw new KTeamError('git_inspection_unavailable',503);
  const env:NodeJS.ProcessEnv={PATH:dirname(executable),GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:process.platform==='win32'?'NUL':'/dev/null',GIT_NO_LAZY_FETCH:'1',GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0',GIT_NO_REPLACE_OBJECTS:'1'};
  if(process.platform==='win32')for(const name of WINDOWS_SYSTEM_ENV)if(process.env[name])env[name]=process.env[name];
  const gitArgs=target.operation==='fetch_refspec'?['config','--file',join(target.gitDirectory,'config'),'--no-includes',...target.args.slice(1)]:
   target.operation==='history'?[...target.args.slice(0,3),'--no-show-signature','--no-notes','--no-decorate',...target.args.slice(3)]:target.args;
  const result=await runLocal(executable,['--no-pager','-c','protocol.allow=never','-c','core.fsmonitor=false','--git-dir='+target.gitDirectory,'--work-tree='+target.repository,...gitArgs],{
   cwd:target.repository,env,signal:context.signal,timeoutMs:10000,onSpawn:async()=>{
    if(!await authorize(input)||JSON.stringify(target)!==JSON.stringify(gitInspection(input,workspace)))throw new KTeamError('git_inspection_scope_denied',403);
   },
  });
  if(result.code!==0&&!(target.operation==='fetch_refspec'&&result.code===1&&!result.stderr.trim()))throw new KTeamError('git_inspection_failed',409);
  return redact(result.stdout).slice(0,32000).split(/\r?\n/).filter(Boolean).slice(0,target.limit).join('\n');
 }};
}
