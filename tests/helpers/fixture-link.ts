import {symlinkSync,statSync,lstatSync,readlinkSync,linkSync,type PathLike} from 'node:fs';
import {dirname,resolve,win32} from 'node:path';
import assert from 'node:assert/strict';

/** Exercise a real filesystem alias without requiring Windows Developer Mode. */
export function fixtureLink(target:PathLike,path:PathLike){
 if(process.platform!=='win32'){symlinkSync(target,path);return;}
 let directory=false;try{directory=statSync(target).isDirectory();}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 if(directory){symlinkSync(target,path,'junction');return;}
 try{symlinkSync(target,path,'file');}
 catch(error){
  if((error as NodeJS.ErrnoException).code!=='EPERM')throw error;
  let created;try{created=lstatSync(path);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  if(created){
   // Some Windows hosts create the reparse point before returning EPERM.
   assert.equal(created.isSymbolicLink(),true);
   assert.equal(win32.toNamespacedPath(resolve(dirname(String(path)),readlinkSync(path))).toLowerCase(),win32.toNamespacedPath(resolve(String(target))).toLowerCase());
  }else linkSync(target,path);
 }
}
