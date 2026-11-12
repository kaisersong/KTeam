// Runs the compiled test files. macOS/Linux: exactly `node --preserve-symlinks --test dist/tests/*.test.js`.
// Windows only (port in progress): a failing test that leaves a server open must not hang CI for hours,
// so each test is bounded. Open handles must still close; forcing exit can hide leaks and crash libuv.
import {spawnSync} from 'node:child_process';
import {readdirSync} from 'node:fs';
const files=readdirSync('dist/tests').filter(name=>name.endsWith('.test.js')).sort().map(name=>'dist/tests/'+name);
const windows=process.platform==='win32'?['--test-timeout=180000']:[];
const result=spawnSync(process.execPath,['--preserve-symlinks','--test',...windows,...files],{stdio:'inherit'});
if(result.error)throw result.error;
process.exitCode=result.status??1;
