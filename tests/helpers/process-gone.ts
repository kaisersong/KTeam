import assert from 'node:assert/strict';
import {processBirth,sameProcessBirth} from '../../src/runtime/platform-process.js';
/**
 * Assert that a recorded owned process no longer exists. POSIX: exactly `kill(pid, 0)` must throw (unchanged).
 * Windows recycles pids quickly, so a bare kill(pid, 0) can hit an unrelated process that took the number (CI saw
 * this intermittently). There the check is identity-based like production: the recorded (pid, CreationDate) must
 * be gone. A record without a birth falls back to kill(pid, 0).
 */
export function assertProcessGone(record:{pid:number;birth?:string|undefined}){
 if(process.platform==='win32'&&record.birth){assert.equal(sameProcessBirth(processBirth(record.pid),record.birth),false,JSON.stringify(record));return;}
 assert.throws(()=>process.kill(record.pid,0),JSON.stringify(record));
}

/** Observe a bounded Windows drain without killing anything or confusing a recycled PID with its old owner. */
export async function waitForProcessGone(record:{pid:number;birth?:string|undefined},timeoutMs=3000){
 if(process.platform==='win32'){
  const alive=()=>{if(record.birth)return sameProcessBirth(processBirth(record.pid),record.birth);try{process.kill(record.pid,0);return true;}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')return false;throw error;}};
  const end=Date.now()+timeoutMs;while(alive()&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,25));
 }
 assertProcessGone(record);
}
