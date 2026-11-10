import {mkdirSync,writeFileSync,renameSync,rmSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
export function writeFileAtomicallySync(file:string,content:string){mkdirSync(dirname(file),{recursive:true,mode:0o700});const temp=file+'.'+randomUUID();try{writeFileSync(temp,content,{flag:'wx',mode:0o600});renameSync(temp,file);}finally{rmSync(temp,{force:true});}}
