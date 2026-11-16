import {statSync} from 'node:fs';
import {dirname} from 'node:path';
import {directoryAccess,directoryGrantAccess,canonicalFile,insideDirectory,type DirectoryAccess} from './directory-access.js';
import {terminalPaths,terminalWorkingPaths} from './terminal-access.js';
/** No inferred common ancestor: every distinct directory is shown and granted explicitly. */
export function toolDirectoryAccesses(core:any,name:string,input:Record<string,unknown>,cwd:string):DirectoryAccess[]{
 if(name!=='bash'){const access=directoryAccess(core,name,input,cwd);return access?[access]:[];}
 try{
  const command=String(input.command??''),paths=terminalPaths(core,command,cwd)??terminalWorkingPaths(core,command,cwd);if(!paths)return [];
  const result=new Map<string,DirectoryAccess>();
  for(const path of paths){const actual=canonicalFile(path);if(!actual)return [];let isDirectory=false;try{isDirectory=statSync(actual).isDirectory();}catch{}
   // A shell may cd into a child project while its harness starts in the parent.
   // File operands need authority for their own parent, never an inferred ancestor.
   const access=isDirectory?directoryGrantAccess(core,path):directoryAccess(core,'write',{file_path:path},dirname(path));if(!access)return [];result.set(access.directory,access);
  }
  return [...result.values()].filter(access=>![...result.values()].some(other=>other!==access&&other.directory!==access.directory&&insideDirectory(other.directory,access.directory)));
 }catch{return [];}
}
