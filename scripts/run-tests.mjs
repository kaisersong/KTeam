// Runs every compiled test file. macOS/Linux default to Node file concurrency;
// KTEAM_TEST_CONCURRENCY may reduce parallelism on a busy developer machine.
// Windows only: bound file concurrency and each complete file (including multi-scenario integration suites).
// The full nine-scenario approval file measured 379 seconds; the whole run also has a watchdog so a
// file that never exits cannot hang CI for hours. No assertion changes.
// --test-force-exit is deliberately NOT used: on Windows + Node 24 a forced process.exit() that lands while undici
// (fetch) handles are still closing aborts the test process inside libuv
// ("Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 94"), seen in adapters.test
// and decision.test, and never before --test-force-exit was added.
import {spawnSync} from 'node:child_process';
import {readdirSync} from 'node:fs';
const files=readdirSync('dist/tests').filter(name=>name.endsWith('.test.js')).sort().map(name=>'dist/tests/'+name);
const windows=process.platform==='win32';
// A busy developer machine can reduce file parallelism without skipping tests.
const requested=process.env.KTEAM_TEST_CONCURRENCY;
if(requested!==undefined&&!/^(?:[1-9]|1[0-6])$/.test(requested))throw Error('invalid_test_concurrency');
const concurrency=requested?Math.min(windows?2:16,Number(requested)):windows?2:undefined;
const result=spawnSync(process.execPath,['--preserve-symlinks','--test',...(concurrency?['--test-concurrency='+concurrency]:[]),...(windows?['--test-timeout=600000']:[]),...files],{stdio:'inherit',...(windows?{timeout:40*60000,killSignal:'SIGKILL'}:{})});
if(result.error&&result.error.code!=='ETIMEDOUT')throw result.error;
if(result.error)console.error('test run exceeded the 40 minute Windows watchdog');
process.exitCode=result.status??1;
