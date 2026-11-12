import {symlinkSync,statSync,lstatSync,realpathSync,linkSync,type PathLike} from 'node:fs';
import assert from 'node:assert/strict';

/** Exercise a real filesystem alias without requiring Windows Developer Mode. */
export function fixtureLink(target:PathLike,path:PathLike){
 if(process.platform!=='win32'){symlinkSync(target,path);return;}
 if(statSync(target).isDirectory()){symlinkSync(target,path,'junction');return;}
 try{symlinkSync(target,path,'file');}
 catch(error){
  if((error as NodeJS.ErrnoException).code!=='EPERM')throw error;
  let created;try{created=lstatSync(path);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  if(created){
   // Some Windows hosts create the reparse point before returning EPERM.
   assert.equal(created.isSymbolicLink(),true);
   assert.equal(realpathSync.native(path).toLowerCase(),realpathSync.native(target).toLowerCase());
  }else linkSync(target,path);
 }
}
