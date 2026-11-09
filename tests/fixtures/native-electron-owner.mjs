import{resolve}from'node:path';import{runLocal}from'../../dist/src/runtime/local-process.js';
const result=await runLocal(resolve('tests/fixtures/native-commander.mjs'),['--version'],{cwd:process.cwd(),env:process.env,signal:AbortSignal.timeout(10000)});console.log(JSON.stringify(result));
