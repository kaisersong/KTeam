import {isAbsolute,resolve,relative,extname,dirname,join} from 'node:path';
import {realpathSync,statSync} from 'node:fs';
import {homedir} from 'node:os';

/** Lift only an unambiguous literal leading cd; execution and approval use one cwd. */
export function projectCommand(input:Record<string,unknown>){
 if(typeof input.command!=='string')return input;
 const match=input.command.match(/^\s*cd\s+(?:--\s+)?(?:"([^"$`\\\r\n]+)"|'([^'\r\n]+)'|(\/[^\s;&|<>$`\\'"]+))\s*&&\s*([\s\S]+)$/);
 const path=match?.[1]??match?.[2]??match?.[3];if(!path||!isAbsolute(path))return input;
 try{const workdir=realpathSync(path);if(statSync(workdir).isDirectory())return {...input,command:match![4]!,workdir};}catch{}
 return input;
}
function words(segment:string){return (segment.match(/"[^"\r\n]*"|'[^'\r\n]*'|[^\s"']+/g)??[]).map(w=>/^['"]/.test(w)?w.slice(1,-1):w);}
export function routineReadCommand(core:any,input:Record<string,unknown>,privateRoot?:string){
 const command=input.command;if(typeof command!=='string'||command.length>16000||/[$`<>\\{}!]|(?<!&)&(?!&)/.test(command))return false;
 const parsed=core.parseCommandSegments(command);if(!parsed.valid||!parsed.segments.length)return false;
 return parsed.segments.every((segment:string)=>{
  const [name,...args]=words(segment);if(!name)return false;
  if(args.some(a=>{const path=resolve(String(input.workdir??'.'),a==='~'?homedir():a.startsWith('~/')?resolve(homedir(),a.slice(2)):a);let canonical=path;try{canonical=realpathSync(path);}catch{}const child=privateRoot?relative(privateRoot,canonical):undefined;return core.isSensitiveToolInvocation('read',{file_path:canonical})||child!==undefined&&(child===''||!child.startsWith('..')&&!isAbsolute(child));}))return false;
  if(['cat','head','tail'].includes(name)&&args.some(a=>/[*?\[]/.test(a)))return false;
  if(name==='git'){
   const [operation,...options]=args;
   if(operation==='status')return options.every(a=>/^-(?:s|b|sb|bs)$|^--(?:short|branch|porcelain(?:=[12])?|untracked-files(?:=(?:no|normal|all))?)$/.test(a));
   if(operation==='log')return options.every(a=>/^-\d+$|^--(?:oneline|all|decorate(?:=(?:short|full|no))?|max-count=\d+)$/.test(a));
   if(operation==='rev-parse')return options.every(a=>/^--(?:show-toplevel|show-prefix|git-dir|is-inside-work-tree|short)$|^HEAD$/.test(a));
   if(operation==='branch')return options.length===1&&options[0]==='--show-current';
   return false;
  }
  if(['pwd','ls','cat','head','tail','wc','echo','printf'].includes(name))return true;
  if(name==='sort')return args.every(a=>!a.startsWith('-')||/^-(?:r|n|u|f|b|V)$|^--(?:reverse|numeric-sort|unique)$/.test(a));
  if(name==='cd')return args.length===1&&isAbsolute(args[0]!);
  if(name==='find')return !args.some(a=>['-exec','-execdir','-ok','-okdir','-delete','-fprint','-fprint0','-fprintf','-fls'].includes(a));
  return false;
 });
}
export function routineDocument(name:string,input:Record<string,unknown>,workspace:string){
 if(!['write','edit'].includes(name)||typeof input.file_path!=='string'||!['.md','.mdx','.txt','.rst','.adoc'].includes(extname(input.file_path).toLowerCase()))return false;
 let actual=resolve(input.file_path),parent=actual;const suffix:string[]=[];
 for(;;){try{actual=join(realpathSync(parent),...suffix.reverse());break;}catch{const next=dirname(parent);if(next===parent)return false;suffix.push(parent.slice(next.length+1));parent=next;}}
 const path=relative(workspace,actual);return path!==''&&!path.startsWith('..')&&!isAbsolute(path);
}
