import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import {ownedChildProcess} from './owned-child-process.mjs';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
execFileSync(process.execPath,['scripts/build-creator-plugins.mjs'],{stdio:'inherit'});
const root=fileURLToPath(new URL('../',import.meta.url));
const source=join(root,'runtime-core');
execFileSync(process.execPath,['scripts/build-windows-absence.mjs'],{stdio:'inherit'});
const modules=JSON.parse(readFileSync(join(root,'scripts/runtime-exports.json'),'utf8'));
const entry=`export {withHarnessProcessOwner} from ${JSON.stringify(join(root,'src/runtime/harness-child-process.ts'))};\n`+Object.entries(modules).map(([file,names])=>`export {${names.join(',')}} from ${JSON.stringify(join(source,file))};`).join('\n');
mkdirSync(join(root,'build/shared'),{recursive:true});
const result=await build({stdin:{contents:entry,resolveDir:root,sourcefile:'kteam-shared-entry.ts',loader:'ts'},bundle:true,platform:'node',format:'esm',target:'node22',outfile:join(root,'build/shared/kteam-runtime.mjs'),metafile:true,
 nodePaths:[join(root,'node_modules')],
 plugins:[ownedChildProcess(root)],packages:'bundle',external:['pdfjs-dist','pdfjs-dist/*','@napi-rs/keyring','better-sqlite3','onnxruntime-node','nodejieba','node-pty','electron'],banner:{js:"import { createRequire as __createRequire } from 'node:module'; const require=__createRequire(import.meta.url);"}});
writeFileSync(join(root,'build/shared/source-manifest.json'),JSON.stringify(Object.entries(result.metafile.inputs).filter(([file])=>file!=='kteam-shared-entry.ts').map(([file])=>({file,sha256:createHash('sha256').update(readFileSync(resolve(root,file))).digest('hex')})),null,2));

await build({entryPoints:[join(source,"src/ai/tools/glob-worker.mjs")],bundle:true,platform:"node",format:"esm",target:"node22",outfile:join(root,"build/shared/glob-worker.mjs"),banner:{js:"import { createRequire as __createRequire } from 'node:module'; const require=__createRequire(import.meta.url);"}});

// The same harness entry is shared by installed diagnostics/other trusted main owners.
await build({stdin:{contents:`export {createHarness} from ${JSON.stringify(join(root,'src/runtime/harness.ts'))}; export {nativeTurn,modelCatalog} from ${JSON.stringify(join(root,'src/runtime/native.ts'))};`,resolveDir:root,sourcefile:'kteam-harness-entry.ts',loader:'ts'},bundle:true,platform:'node',format:'esm',target:'node22',outfile:join(root,'build/shared/kteam-harness.mjs'),external:['pdfjs-dist','pdfjs-dist/*','@napi-rs/keyring','better-sqlite3','onnxruntime-node','nodejieba','node-pty','electron'],banner:{js:"import { createRequire as __createRequire } from 'node:module'; const require=__createRequire(import.meta.url);"}});
