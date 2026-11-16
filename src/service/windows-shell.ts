import {win32} from 'node:path';

/** Literal cmd.exe grammar. Backslashes are path separators, never POSIX escapes.
 * Expansion, command groups and escaped operators require a separate approval. */
export function windowsShellSegments(command:string):string[][]|undefined{
 if(!command.trim()||command.length>65536||/[\0\r\n%!]/.test(command))return;
 const segments:string[][]=[];let args:string[]=[],word='',quote=false,started=false;
 const flushWord=()=>{if(started){args.push(word);word='';started=false;}};
 for(let index=0;index<command.length;index++){
  const char=command[index]!;
  if(char==='"'){quote=!quote;started=true;continue;}
  if(!quote&&/[()^]/.test(char))return;
  if(!quote&&!started){const fd=/^[012]?>&[012](?=\s|$|[&|])/.exec(command.slice(index));if(fd){args.push(fd[0]);index+=fd[0].length-1;continue;}}
  if(!quote&&/[&|]/.test(char)){flushWord();if(!args.length)return;segments.push(args);args=[];if(command[index+1]===char)index++;continue;}
  if(!quote&&/[<>]/.test(char)){flushWord();args.push(char==='>'&&command[index+1]==='>'?(index++,'>>'):char);continue;}
  if(!quote&&/\s/.test(char)){flushWord();continue;}
  word+=char;started=true;
 }
 if(quote)return;flushWord();if(!args.length)return;segments.push(args);return segments.length<=100?segments:undefined;
}

/** Resolve each command's actual working directory and explicit path operands. */
export function windowsWorkingPaths(command:string,cwd:string):string[]|undefined{
 const segments=windowsShellSegments(command);if(!segments)return;
 let directory=win32.resolve(cwd);const paths=new Set<string>();
 for(const segment of segments){
  const [program,...args]=segment,head=program!.toLowerCase();
  if(head==='cd'||head==='chdir'){
   if(args[0]?.toLowerCase()==='/d')args.shift();
   if(args.length!==1||!args[0]||/^[a-z]:[^\\/]/i.test(args[0]))return;
   const next=win32.resolve(directory,args[0]);
   // cmd keeps per-drive working directories; only /d has unambiguous cross-drive semantics.
   if(segment[1]?.toLowerCase()!=='/d'&&win32.parse(next).root.toLowerCase()!==win32.parse(directory).root.toLowerCase())return;
   directory=next;continue;
  }
  if(['pushd','popd','set','setlocal','endlocal','call','cmd','cmd.exe','for','if','start'].includes(head)||/^[a-z]:$/i.test(head))return;
  if(/^[a-z]:[^\\/]/i.test(program!))return;
  paths.add(directory);
  if(win32.isAbsolute(program!))paths.add(win32.resolve(directory,program!));
  for(let index=0;index<args.length;index++){
   const arg=args[index]!;
   if(/^[012]?>&[012]$/.test(arg))continue;
   if(head==='findstr'&&/^\/(?:[bilvenmopsrx]+|[cfgd]:.*)$/i.test(arg)||head==='dir'&&/^\/[a-z](?::[^\\/]*)?$/i.test(arg))continue;
   if(['<','>','>>'].includes(arg)){
    const target=args[++index];if(!target||['<','>','>>'].includes(target))return;
    if(/^[a-z]:[^\\/]/i.test(target)||/^\\\\[?.]\\/.test(target))return;
    if(!/^nul$/i.test(target))paths.add(win32.resolve(directory,target));continue;
   }
   // Patterns are relative too: '..\\other\\*.ts' cannot inherit this directory's grant.
   if(/^[a-z]:[^\\/]/i.test(arg)||/^\\\\[?.]\\/.test(arg))return;
   if(win32.isAbsolute(arg)||/^(?:\.\.?[\\/])/.test(arg)||/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(arg)){
    const wildcard=arg.search(/[*?]/),path=wildcard<0?arg:win32.dirname(arg.slice(0,wildcard)+'file');
    paths.add(win32.resolve(directory,path));
   }
  }
 }
 return paths.size?[...paths]:[directory];
}

/** Read-only cmd queries may run without a reusable grant. Unknown commands use normal risk checks. */
export function readOnlyWindowsShell(command:string,literalAllowed:(word:string)=>boolean){
 const segments=windowsShellSegments(command);if(!segments)return false;
 return segments.every(([head,...args])=>{
  for(let index=0;index<args.length;index++){
   const word=args[index]!;if(/^[012]?>&[012]$/.test(word))continue;
   if(word==='>'&&/^nul$/i.test(args[index+1]??'')){index++;continue;}
   if(['<','>','>>'].includes(word)||!literalAllowed(word))return false;
  }
  const program=head!.toLowerCase();
  if(program==='cd'||program==='chdir')return args.length===1&&!args[0]!.startsWith('/')||args.length===2&&args[0]!.toLowerCase()==='/d';
  if(program==='echo')return !['on','off'].includes(args[0]?.toLowerCase()??'');
  return ['findstr','dir','type','where','ver','vol'].includes(program)&&!args.some(word=>/^\/(?:off|p)$/i.test(word));
 });
}
