import {join} from 'node:path';
// Third-party packages bundled into the KTeam runtime (MCP SDK, cross-spawn) spawn through
// KTeam's owned child_process module so every harness child stays scoped and recorded.
// KTeam's own runtime-core sources import that module directly.
export const ownedChildProcess=root=>({name:'kteam-owned-child-process',setup(build){build.onResolve({filter:/^(?:node:)?child_process$/},args=>{
 if(/[\\/]node_modules[\\/](?:@modelcontextprotocol|cross-spawn)[\\/]/.test(args.importer))return {path:join(root,'src/runtime/harness-child-process.ts')};
});}});
