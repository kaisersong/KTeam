import {tmpdir} from 'node:os';
import {rmSync} from 'node:fs';
export const tmpRoot=process.platform==='win32'?tmpdir():'/tmp';
/** Retry transient Windows sharing violations, but never hide an unclosed handle. */
export function removeTempRoot(path:string){rmSync(path,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
