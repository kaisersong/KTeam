import {build} from 'esbuild';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const lock=JSON.parse(readFileSync(join(root,'sources.lock.json'),'utf8'));
const source=resolve(root,lock.runtime.directory);
for(const file of lock.runtime.files)if(createHash('sha256').update(readFileSync(join(root,file.file))).digest('hex')!==file.sha256)throw Error('runtime_source_hash_mismatch:'+file.file);
const entry=`export {AgentRuntime} from ${JSON.stringify(join(source,'src/ai/runtime/agent-runtime.ts'))};
export {AgentSessionState} from ${JSON.stringify(join(source,'src/ai/runtime/session.ts'))};
export {AgentRunController} from ${JSON.stringify(join(source,'src/ai/runtime/controller.ts'))};
export {ToolRegistry} from ${JSON.stringify(join(source,'src/ai/tools/index.ts'))};
export {createAdapter} from ${JSON.stringify(join(source,'src/ai/models.ts'))};
export {resolveRuntimeModelBinding} from ${JSON.stringify(join(source,'src/ai/providers/control-plane.ts'))};
export {ConversationActivityOwnerClient} from ${JSON.stringify(join(source,'src/runtime/conversation-activity/owner-client.ts'))};
export {loadConfig} from ${JSON.stringify(join(source,'src/utils/config.ts'))};`;
mkdirSync(join(root,'build/shared'),{recursive:true});
const result=await build({stdin:{contents:entry,resolveDir:root,sourcefile:'xiaok-shared-entry.ts',loader:'ts'},bundle:true,platform:'node',format:'esm',target:'node22',outfile:join(root,'build/shared/xiaok-runtime.mjs'),metafile:true,
 nodePaths:[join(root,'node_modules')],
 packages:'bundle',external:['@napi-rs/keyring','better-sqlite3','onnxruntime-node','nodejieba','node-pty','electron'],banner:{js:"import { createRequire as __createRequire } from 'node:module'; const require=__createRequire(import.meta.url);"}});
writeFileSync(join(root,'build/shared/source-manifest.json'),JSON.stringify(Object.entries(result.metafile.inputs).filter(([file])=>file!=='xiaok-shared-entry.ts').map(([file])=>({file,sha256:createHash('sha256').update(readFileSync(resolve(root,file))).digest('hex')})),null,2));
