import {createHash} from 'node:crypto';
import {readFileSync,realpathSync,statSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {terminalCommands,terminalRequiresConfirmation} from './terminal-permissions.js';
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const reservedVariable=/^(?:PATH|HOME|SHELL|ENV|BASH_ENV|BASHOPTS|SHELLOPTS|CDPATH|IFS|NODE_OPTIONS|NODE_PATH|PYTHONPATH|PYTHONHOME|LD_.*|DYLD_.*|GIT_.*|BASH_FUNC_.*|NPM_CONFIG_.*)$/i;
const environment=/^(?:CI|NODE_ENV|NO_COLOR|FORCE_COLOR|KTEAM_UPSTREAM_ROOT)=/;
const commands=new Set(['git','ls','pwd','echo','printf','cat','head','tail','wc','rg','grep','sort','uniq','cut','mkdir','touch','cp','tee','node','python','python3','npm','pnpm','yarn','cd']);
/** Literal shell words only. Dynamic programs and shell expansion never become directory-wide grants. */
function words(segment:string){
 const result:string[]=[];let word='',quote='',started=false;
 for(let i=0;i<segment.length;i++){const c=segment[i]!;if(quote){if(c===quote)quote='';else if(c==='\\')return;else word+=c;started=true;}else if(c==='"'||c==="'"){quote=c;started=true;}else if(/\s/.test(c)){if(started){result.push(word);word='';started=false;}}else if(c==='>'||c==='<'){if(started){result.push(word);word='';started=false;}const op=segment[i+1]===c?c+c:c;if(op.length===2)i++;result.push(op);}else if(/[\\`$*?{}\[\]()]/.test(c))return;else{word+=c;started=true;}}
 if(quote)return;if(started)result.push(word);return result;
}
const readGit=new Set(['status','diff','log','show','rev-parse','ls-files','ls-tree','describe','check-ignore','check-attr','version','--version','add','commit','branch']);
/** Directory references that must ALL be covered, including git -C and explicit path arguments. */
export function terminalPaths(core:any,command:string,cwd:string):string[]|undefined{
 if(command.length>16384||terminalRequiresConfirmation(core,command))return;
 const segments=terminalCommands(core,command);if(!segments||segments.length>100)return;
 let directory=realpathSync(cwd);const paths=new Set<string>();
 for(const segment of segments){
  const args=words(segment);if(!args?.length)return;
  while(args.length&&environment.test(args[0]!)){const value=args.shift()!;if(value.startsWith('KTEAM_UPSTREAM_ROOT='))paths.add(resolve(directory,value.slice(value.indexOf('=')+1)));}
  const program=args.shift();if(!program||!commands.has(program))return;
  // Redirection affects a separate path; it cannot be hidden behind a granted workdir.
  for(let i=0;i<args.length;i++)if(['>','>>','<'].includes(args[i]!)){const target=args[i+1];if(!target||['>','>>','<'].includes(target))return;if(target!=='/dev/null')paths.add(resolve(directory,target));args.splice(i,2);i--;}
  if(args.some(arg=>arg==='<<'||/^\d*[<>]&/.test(arg)))return;
  if(program==='cd'){if(args.length!==1||args[0]==='-')return;directory=resolve(directory,args[0]!);continue;}
  if(program==='git'){
   let repo=directory;
   while(args[0]?.startsWith('-')&&args[0]!=='--version'){
    const option=args.shift();if(option==='-C'){const target=args.shift();if(!target)return;repo=resolve(repo,target);}else if(option!=='--no-pager'&&option!=='--literal-pathspecs')return;
   }
   const subcommand=args.shift();if(!subcommand||!readGit.has(subcommand))return;
   if(args.some(arg=>/^(?:--delete|-D|-d|--exec|--ext-diff|--textconv|--output|--config-env)(?:=|$)/.test(arg)))return;
   paths.add(repo);
   // Explicit absolute/path arguments require their own directory authority.
   for(const arg of args){const value=arg.includes('=')?arg.slice(arg.indexOf('=')+1):arg.startsWith('-')&&/^-[A-Za-z][\/]/.test(arg)?arg.slice(2):arg;if((!arg.startsWith('-')||value!==arg)&&(/[/\\]/.test(value)||value==='..'))paths.add(resolve(repo,value));}
   continue;
  }
  if(['node','python','python3'].includes(program)){
   paths.add(directory);
   // Local script execution is trusted only within the explicitly approved directory.
   if(args.length===1&&['--version','-v'].includes(args[0]!))continue;
   if(!args.length||args[0]!.startsWith('-'))return;
   paths.add(resolve(directory,args[0]!));
   for(const arg of args.slice(1)){const value=arg.includes('=')?arg.slice(arg.indexOf('=')+1):arg;if(/[/\\]/.test(value)&&(!arg.startsWith('-')||value!==arg))paths.add(resolve(directory,value));}
   continue;
  }
  if(['npm','pnpm','yarn'].includes(program)){
   paths.add(directory);
   if(args.length===1&&['--version','-v'].includes(args[0]!))continue;
   if(!['run','test','build','typecheck','check'].includes(args[0]??'')||args.some(arg=>/^(?:--prefix|--dir|--cwd|-C|--config|--userconfig)(?:=|$)/.test(arg)))return;
   continue;
  }
  if(program==='echo'||program==='printf'||program==='pwd')continue;
  // Options that execute code or bypass normal paths are not routine file commands.
  if(args.some(arg=>/^(?:--pre|--pre-glob|--exec|--exec-batch|-e|-f|--files-from)(?:=|$)/.test(arg)))return;
  if(program==='ls'&&!args.some(arg=>!arg.startsWith('-')))paths.add(directory);
  for(const arg of args)if(!arg.startsWith('-'))paths.add(resolve(directory,arg));
 }
 return paths.size?[...paths]:[directory];
}
type SourceFile={path:string;requestedPath:string;sha256:string};
export interface CommandAccess {commandHash:string;directory:string;anchor:{dev:number;ino:number};scripts:SourceFile[];directories:{path:string;requestedPath:string;dev:number;ino:number}[];gitFiles:SourceFile[]}
/** Full-command approval, never a wildcard grant for an unparseable shell program. */
export function commandAccess(core:any,command:string,cwd:string):CommandAccess|undefined{try{return inspectCommand(core,command,cwd);}catch{return undefined;}}
function inspectCommand(core:any,command:string,cwd:string):CommandAccess|undefined{
 if(!command||command.length>16384||/[`\\]/.test(command)||core.classifyBashCommand(command).level!=='safe'||core.requiresAlwaysCommandConfirmation(command)||core.isSensitiveToolInvocation('bash',{command,workdir:cwd}))return;
 const segments=core.parseCommandSegments(command).segments as string[];if(!segments.length||segments.length>100)return;
 let directory=realpathSync(cwd);const scripts:SourceFile[]=[],gitFiles:SourceFile[]=[],directories=new Map<string,CommandAccess['directories'][number]>(),variables=new Map<string,string[]>();
 const addDirectory=(requestedPath:string)=>{if(directories.size>=128&&!directories.has(requestedPath))throw Error('command_directory_limit');const path=realpathSync(requestedPath),stat=statSync(path);if(!stat.isDirectory())throw Error('command_directory_changed');directories.set(requestedPath,{path,requestedPath,dev:stat.dev,ino:stat.ino});};
 const source=(requestedPath:string):SourceFile=>{const path=realpathSync(requestedPath),stat=statSync(path);if(!stat.isFile()||stat.size>1024*1024)throw Error('command_source_changed');return {path,requestedPath,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')};};
 const expand=(value:string):string[]=>{const match=/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/.exec(value);if(!match)return [value];const values=variables.get(match[1]!);if(!values||values.length>16)throw Error('dynamic_command_directory');const result=values.flatMap(replacement=>expand(value.slice(0,match.index)+replacement+value.slice(match.index+match[0].length)));if(result.length>32)throw Error('command_directory_limit');return result;};
 const repository=(requestedPath:string)=>{addDirectory(requestedPath);const dot=join(requestedPath,'.git'),stat=statSync(dot);if(stat.isDirectory()){addDirectory(dot);return;}const fact=source(dot),match=/^gitdir: (.+)\r?\n?$/.exec(readFileSync(fact.path,'utf8'));if(!match)throw Error('invalid_git_directory');gitFiles.push(fact);addDirectory(resolve(requestedPath,match[1]!.trim()));};
 addDirectory(directory);
 for(let raw of segments){
  raw=raw.trim().replace(/^do\s+/, '');
  if(raw==='done')continue;
  const loop=/^for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([A-Za-z0-9_. /-]+)$/.exec(raw);if(loop){if(reservedVariable.test(loop[1]!))return;const values=loop[2]!.trim().split(/\s+/);if(values.length>16)return;variables.set(loop[1]!,values);continue;}
  // Substitution commands are also emitted as separate segments by the core parser.
  const assignment=/^([A-Za-z_][A-Za-z0-9_]*)=([^\s;]+)$/.exec(raw);if(assignment){if(reservedVariable.test(assignment[1]!))return;variables.set(assignment[1]!,expand(assignment[2]!));continue;}const substitution=/^([A-Za-z_][A-Za-z0-9_]*)=\$\([\s\S]*\)$/.exec(raw);if(substitution){if(reservedVariable.test(substitution[1]!))return;continue;}
  while(environment.test(raw)){const match=/^[A-Z_]+=(?:[^\s]+)\s+/.exec(raw);if(!match)return;if(match[0].startsWith('KTEAM_UPSTREAM_ROOT=')){const value=match[0].trim().slice('KTEAM_UPSTREAM_ROOT='.length);for(const path of expand(value))addDirectory(resolve(directory,path));}raw=raw.slice(match[0].length);}
  const program=/^([A-Za-z][A-Za-z0-9_-]*)(?:\s|$)/.exec(raw)?.[1];if(!program||!commands.has(program))return;
  // Reuse mandatory terminal exclusions on every inner command, including substitutions.
  const literal=raw.replace(/\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/g,'VALUE');
  if(terminalRequiresConfirmation(core,literal))return;
  if(['git','npm','pnpm','yarn'].includes(program)&&!terminalPaths(core,literal,cwd))return;
  if(program==='git'){const args=words(raw.replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g,(_match,name)=>'KTEAMVAR'+name+'END'));if(!args)return;let repos=[directory];for(let index=1;index<args.length;index++){if(args[index]==='-C'){const value=args[++index];if(!value)return;const paths=expand(value.replace(/KTEAMVAR([A-Za-z_][A-Za-z0-9_]*)END/g,(_match,name)=>'$'+name));if(repos.length*paths.length>64)return;repos=repos.flatMap(base=>paths.map(path=>resolve(base,path)));}else if(!args[index]!.startsWith('-'))break;}for(const repo of repos)repository(repo);}
  if(program==='cd'){const args=words(raw);if(args?.length!==2||args[1]==='-')return;directory=resolve(directory,args[1]!);addDirectory(directory);}
  if(['node','python','python3'].includes(program)){
   const args=words(raw);if(args?.length===2&&['--version','-v'].includes(args[1]!))continue;
   if(!args||args.length<2||args[1]!.startsWith('-'))return;
   const requestedPath=resolve(directory,args[1]!);scripts.push(source(requestedPath));addDirectory(dirname(requestedPath));
  }
 }
 const root=realpathSync(cwd),stat=statSync(root);if(!stat.isDirectory())return;
 return {commandHash:digest([command,root]),directory:root,anchor:{dev:stat.dev,ino:stat.ino},scripts,directories:[...directories.values()],gitFiles};
}
export function commandAccessCurrent(access:CommandAccess){try{const stat=statSync(access.directory);return realpathSync(access.directory)===access.directory&&stat.dev===access.anchor.dev&&stat.ino===access.anchor.ino&&access.directories.every(directory=>{const current=statSync(directory.path);return realpathSync(directory.requestedPath)===directory.path&&current.dev===directory.dev&&current.ino===directory.ino;})&&[...access.scripts,...access.gitFiles].every(script=>statSync(script.path).isFile()&&statSync(script.path).size<=1024*1024&&realpathSync(script.requestedPath)===script.path&&createHash('sha256').update(readFileSync(script.path)).digest('hex')===script.sha256);}catch{return false;}}
