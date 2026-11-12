import assert from 'node:assert/strict';
import {lstatSync} from 'node:fs';
import {assertWindowsPrivate} from '../../src/service/windows-security.js';
import {randomBytes} from 'node:crypto';
import {dirname,basename,join} from 'node:path';
import {realpathSync,existsSync} from 'node:fs';
import {ensurePrivateRoot} from '../../src/service/config.js';
/** Windows mkdtemp inherits the Temp ACL; create the test's private leaf with the production ACL contract. */
export function privateTempDir(prefix:string){const parent=realpathSync(dirname(prefix));for(let attempt=0;attempt<100;attempt++){const path=join(parent,basename(prefix)+randomBytes(6).toString('base64url').slice(0,6));if(existsSync(path))continue;ensurePrivateRoot(path);return realpathSync(path);}throw Error('private_temp_collision');}

/** Assert the same private access contract using the platform permission mechanism. */
export function assertPrivateMode(path:string,mode:0o600|0o700){const stat=lstatSync(path);assert.equal(stat.isSymbolicLink(),false);assert.equal(mode===0o700?stat.isDirectory():stat.isFile(),true);if(process.platform==='win32')assertWindowsPrivate(path,mode===0o700);else assert.equal(stat.mode&0o777,mode);}
