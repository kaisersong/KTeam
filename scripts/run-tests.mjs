// Runs the compiled test files. macOS/Linux: exactly `node --preserve-symlinks --test dist/tests/*.test.js`.
// Windows only (port in progress): a failing test that leaves a server open must not hang CI for hours,
// so the runner exits once every test has reported, and a single test is bounded. No assertion changes.
// Exception: adapters.test.js runs without --test-force-exit. Its stale-socket case destroys sockets mid-request;
// on Windows + Node 24 the forced process.exit() then lands while undici's handles are still closing and libuv
// aborts the process ("Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 94").
// It never happened before --test-force-exit was added. That file closes every server it opens and exits on its own.
import {spawnSync} from 'node:child_process';
import {readdirSync} from 'node:fs';
const files=readdirSync('dist/tests').filter(name=>name.endsWith('.test.js')).sort().map(name=>'dist/tests/'+name);
const run=(args,list)=>{if(!list.length)return 0;const result=spawnSync(process.execPath,['--preserve-symlinks','--test',...args,...list],{stdio:'inherit'});if(result.error)throw result.error;return result.status??1;};
if(process.platform!=='win32'){process.exitCode=run([],files);}
else{
 const natural=new Set(['dist/tests/adapters.test.js']);
 const forced=run(['--test-force-exit','--test-timeout=180000'],files.filter(f=>!natural.has(f)));
 const plain=run(['--test-timeout=180000'],files.filter(f=>natural.has(f)));
 process.exitCode=forced||plain;
}
