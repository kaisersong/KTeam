// Deliberate source update only: no network, no reads from upstream dirty files.
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,rmSync,mkdtempSync,realpathSync} from 'node:fs';
import {join,dirname,resolve,relative} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
const root=resolve(import.meta.dirname,'..'),lockPath=join(root,'sources.lock.json'),lock=JSON.parse(readFileSync(lockPath,'utf8'));
const revision=lock.runtime.revision,repo=resolve(root,'../xiaok-cli');
const temp=realpathSync(mkdtempSync(join(tmpdir(),'kteam-source-pin-')));
try{
 execFileSync('tar',['-x','-C',temp],{input:execFileSync('git',['-C',repo,'archive',revision,'src','desktop/shared','desktop/electron/assistant-inbox-service.ts','desktop/electron/assistant-inbox-store.ts','desktop/electron/assistant-triage.ts','desktop/electron/pdf-text.ts'],{maxBuffer:80*1024*1024})});
 const modules=JSON.parse(readFileSync(join(root,'scripts/runtime-exports.json'),'utf8'));
 const entry=Object.entries(modules).map(([file,names])=>`export {${names.join(',')}} from ${JSON.stringify(join(temp,file))};`).join('\n');
 const result=await build({stdin:{contents:entry,resolveDir:root,loader:'ts'},bundle:true,platform:'node',format:'esm',packages:'external',write:false,metafile:true,logLevel:'silent'});
 // Keep packaged workers/assets as well as the full transitive implementation.
 const paths=new Set([...lock.runtime.files.map(f=>f.upstreamPath),...Object.keys(result.metafile.inputs).map(f=>resolve(root,f)).filter(f=>f.startsWith(temp+'/')).map(f=>relative(temp,f))]);
 const files=[];
 for(const path of [...paths].sort()){
  const bytes=execFileSync('git',['-C',repo,'show',revision+':'+path],{maxBuffer:16*1024*1024}),file=join(lock.runtime.directory,path);
  mkdirSync(dirname(join(root,file)),{recursive:true});writeFileSync(join(root,file),bytes);
  files.push({file,upstreamPath:path,sha256:createHash('sha256').update(bytes).digest('hex')});
 }
 lock.runtime.revision=revision;lock.runtime.files=files;
 writeFileSync(lockPath,JSON.stringify(lock,null,2)+'\n');
 console.log(JSON.stringify({revision,files:files.length}));
}finally{rmSync(temp,{recursive:true,force:true});}
