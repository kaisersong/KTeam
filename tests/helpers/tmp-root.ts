import {tmpdir} from 'node:os';
import {rmSync} from 'node:fs';
/** Temp root for tests: unchanged /tmp on macOS/Linux (short unix socket paths), the user temp dir on Windows. */
export const tmpRoot=process.platform==='win32'?tmpdir():'/tmp';
/**
 * Remove a test temp dir. macOS/Linux: exactly rmSync(recursive, force). Windows cannot delete a file another
 * handle still holds (the pinned intent-broker keeps its event-store SQLite open until process exit), so a
 * leftover there is left to the runner's temp cleanup instead of failing an already-asserted test.
 */
export function removeTempRoot(path:string){
 if(process.platform!=='win32'){rmSync(path,{recursive:true,force:true});return;}
 try{rmSync(path,{recursive:true,force:true,maxRetries:5,retryDelay:100});}catch(error){if(!['EBUSY','EPERM'].includes((error as NodeJS.ErrnoException).code??''))throw error;}
}
