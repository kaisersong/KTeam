import {dirname,isAbsolute,join,relative,resolve,parse,sep} from 'node:path';
import {lstatSync,realpathSync,statSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
const canonicalDirectory=(path:string)=>process.platform==='win32'?realpathSync.native(path):realpathSync(path);
export const FILE_TOOLS=new Set(['read','write','edit']);
export const insideDirectory=(root:string,path:string)=>{const part=relative(root,path);return part===''||part!=='..'&&!part.startsWith('..'+sep)&&!isAbsolute(part);};
export function canonicalFile(path:string):string|undefined{
 let cursor=resolve(path);const suffix:string[]=[];
 for(;;){try{return join(canonicalDirectory(cursor),...suffix.reverse());}catch(error){try{lstatSync(cursor);return undefined;}catch(probe){if((probe as NodeJS.ErrnoException).code!=='ENOENT')return undefined;}if((error as NodeJS.ErrnoException).code!=='ENOENT')return undefined;const parent=dirname(cursor);if(parent===cursor)return undefined;suffix.push(cursor.slice(parent.length+(parent.endsWith(sep)?0:1)));cursor=parent;}}
}
export function fileTarget(name:string,input:Record<string,unknown>,cwd:string){if(!FILE_TOOLS.has(name)||typeof input.file_path!=='string'||!input.file_path.trim())return undefined;const raw=input.file_path;return resolve(cwd,raw==='~'?homedir():raw.startsWith('~/')?join(homedir(),raw.slice(2)):raw);}
function protectedPath(core:any,path:string){
 if(core.isSensitiveToolInvocation('read',{file_path:path}))return true;
 const parts=path.replace(/\\/g,'/').split('/').filter(Boolean),lower=path.replace(/\\/g,'/').toLowerCase();
 if(parts.some(part=>part.startsWith('.'))||/^\/Users\/[^/]+\/Library(?:\/|$)/i.test(path))return true;
 if(/^\/[A-Za-z]:/.test(lower)||/^[a-z]:\//.test(lower))return /(?:^|\/)(?:windows|program files(?: \(x86\))?|programdata)(?:\/|$)/.test(lower)||/(?:^|\/)appdata(?:\/|$)/.test(lower)&&!(insideDirectory(canonicalDirectory(homedir()),canonicalDirectory(tmpdir()))&&insideDirectory(canonicalDirectory(tmpdir()),canonicalFile(path)??path));
 return ['/System','/Library','/Applications','/usr','/bin','/sbin','/etc','/private/etc','/private/var','/opt','/dev','/proc','/sys','/boot','/root'].some(root=>insideDirectory(root.toLowerCase(),lower)&&!(root==='/private/var'&&insideDirectory(canonicalDirectory(tmpdir()).toLowerCase(),lower)));
}
export function sensitiveFileInvocation(core:any,name:string,input:Record<string,unknown>,cwd:string){const path=fileTarget(name,input,cwd);if(!path)return false;const actual=canonicalFile(path);return !actual||protectedPath(core,path)||protectedPath(core,actual);}
export interface DirectoryAccess {directory:string;target:string;requestedPath:string;anchor:{path:string;dev:number;ino:number}}
export function directoryAccess(core:any,name:string,input:Record<string,unknown>,cwd:string):DirectoryAccess|undefined{
 const path=fileTarget(name,input,cwd);if(!path||sensitiveFileInvocation(core,name,input,cwd))return undefined;
 const target=canonicalFile(path);if(!target)return undefined;
 try{if(statSync(target).isDirectory())return undefined;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')return undefined;}
 const directory=dirname(target);if(directory===parse(directory).root||['/users','/home','/volumes','/private','/tmp','/private/tmp'].includes(directory.toLowerCase())||protectedPath(core,directory))return undefined;
 let anchor=directory;for(;;){try{const info=statSync(anchor);if(!info.isDirectory())return undefined;return {directory,target,requestedPath:path,anchor:{path:anchor,dev:info.dev,ino:info.ino}};}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')return undefined;const parent=dirname(anchor);if(parent===anchor)return undefined;anchor=parent;}}
}
export function directoryAccessCurrent(access:DirectoryAccess){try{const info=statSync(access.anchor.path);return canonicalFile(access.requestedPath)===access.target&&info.dev===access.anchor.dev&&info.ino===access.anchor.ino&&canonicalDirectory(access.anchor.path)===access.anchor.path&&canonicalFile(access.directory)===access.directory;}catch{return false;}}
