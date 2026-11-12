import assert from 'node:assert/strict';
import {processBirth} from '../../src/runtime/platform-process.js';
/**
 * Assert that a recorded owned process no longer exists. POSIX: exactly `kill(pid, 0)` must throw (unchanged).
 * Windows recycles pids quickly, so a bare kill(pid, 0) can hit an unrelated process that took the number (CI saw
 * this intermittently). There the check is identity-based like production: the recorded (pid, CreationDate) must
 * be gone. A record without a birth falls back to kill(pid, 0).
 */
export function assertProcessGone(record:{pid:number;birth?:string|undefined}){
 if(process.platform==='win32'&&record.birth){assert.notEqual(processBirth(record.pid),record.birth,JSON.stringify(record));return;}
 assert.throws(()=>process.kill(record.pid,0),JSON.stringify(record));
}
