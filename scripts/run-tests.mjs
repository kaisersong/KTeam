// Runs the compiled test files. macOS/Linux: exactly `node --preserve-symlinks --test dist/tests/*.test.js`.
// Windows only (port in progress): a single test is bounded (--test-timeout), and the whole run has a watchdog so a
// file that never exits cannot hang CI for hours. No assertion changes.
// --test-force-exit is deliberately NOT used: on Windows + Node 24 a forced process.exit() that lands while undici
// (fetch) handles are still closing aborts the test process inside libuv
// ("Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 94"), seen in adapters.test
// and decision.test, and never before --test-force-exit was added.
import {spawnSync} from 'node:child_process';
import {readdirSync} from 'node:fs';
const files=readdirSync('dist/tests').filter(name=>name.endsWith('.test.js')).sort().map(name=>'dist/tests/'+name);
const windows=process.platform==='win32';
const result=spawnSync(process.execPath,['--preserve-symlinks','--test',...(windows?['--test-timeout=180000']:[]),...files],{stdio:'inherit',...(windows?{timeout:40*60000,killSignal:'SIGKILL'}:{})});
if(result.error&&result.error.code!=='ETIMEDOUT')throw result.error;
if(result.error)console.error('test run exceeded the 40 minute Windows watchdog');
process.exitCode=result.status??1;
