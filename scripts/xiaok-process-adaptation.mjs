import {join} from 'node:path';
export const ownedHarnessProcesses=root=>({name:'kteam-harness-owned-processes',setup(build){build.onResolve({filter:/^(?:node:)?child_process$/},args=>{
 if(args.importer.includes('/vendor/xiaok-runtime/')||/\/node_modules\/(?:@modelcontextprotocol|cross-spawn)\//.test(args.importer))return {path:join(root,'src/runtime/harness-child-process.ts')};
});}});
