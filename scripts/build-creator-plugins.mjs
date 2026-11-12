import {execFileSync} from 'node:child_process';
import {cpSync,existsSync,mkdirSync,readFileSync,rmSync,writeFileSync,readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {dirname} from 'node:path';
import {extractPinnedArchive} from './pinned-archive.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const lock=JSON.parse(readFileSync(join(root,'sources.lock.json'),'utf8')).creatorPlugins;
const target=process.env.KTEAM_PLUGIN_TARGET??`${process.platform}-${process.arch}`;
const cache=join(root,'.sources','creator-plugins-'+lock.revision);
const repository=process.env.KTEAM_PLUGINS_SOURCE??join(root,'.sources','creator-plugin-repository');
const run=(command,args,cwd=cache)=>{const env={...process.env,PYTHONDONTWRITEBYTECODE:'1'};if(process.platform==='win32'){if(command==='npm'){args=[process.env.npm_execpath??join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'),...args];command=process.execPath;}const search=process.env.PATH??process.env.Path??'';for(const key of Object.keys(env))if(key.toUpperCase()==='PATH')delete env[key];env.PATH=join(process.env.SystemRoot??'C:\\Windows','System32')+';'+search;}return execFileSync(command,args,{cwd,stdio:'inherit',env});};
mkdirSync(cache,{recursive:true});
if(!existsSync(join(cache,'.source-ready'))){
 let repo=repository;
 if(!existsSync(join(repo,'.git'))){repo=join(root,'.sources','creator-plugin-repository');if(!existsSync(join(repo,'.git')))run('git',['clone',lock.repository,repo],root);}
 const archive=execFileSync('git',['archive',lock.revision],{cwd:repo,maxBuffer:128*1024*1024});
 extractPinnedArchive(archive,cache);
 writeFileSync(join(cache,'.source-ready'),lock.revision);
}
const out=join(root,'build/plugins');rmSync(out,{recursive:true,force:true});mkdirSync(out,{recursive:true});
const report=join(cache,'plugins/kai-report-creator/mcp-servers/report-renderer');
if(!existsSync(join(report,'dist/server.bundle.js'))){run('npm',['ci','--ignore-scripts','--no-audit','--no-fund'],report);run('npm',['run','build'],report);run('npm',['run','build:bundle'],report);}
const runtimeLock=JSON.parse(readFileSync(join(cache,'runtime-lock.json'),'utf8')).runtimes['slide-python'];
const runtimeTarget=runtimeLock.targets[target];
const names=lock.names.filter(name=>name!=='kai-slide-creator'||runtimeTarget);
if(!runtimeTarget)console.log(`Slide creator unavailable on ${target}: upstream has no bundled interpreter; report creator remains available.`);
const runtime=join(cache,'plugins/kai-slide-creator/bundled-python',target);
// Reuse only a verified interpreter closure; a clean machine materialises the
// SHA-256-pinned archive using the upstream build script. No runtime downloads.
if(runtimeTarget&&!existsSync(join(runtime,runtimeLock.manifestName))){
 const local=join(repository,'plugins/kai-slide-creator/bundled-python',target);
 if(existsSync(join(local,runtimeLock.manifestName))){run(process.execPath,['scripts/vendor-runtimes.mjs','--verify','--runtime','slide-python','--target',target,'--root',local]);cpSync(local,runtime,{recursive:true,verbatimSymlinks:true});}
 else run(process.execPath,['scripts/vendor-runtimes.mjs','--runtime','slide-python','--target',target]);
}
if(runtimeTarget)run(process.execPath,['scripts/vendor-runtimes.mjs','--verify','--runtime','slide-python','--target',target]);
for(const name of names){
 const source=join(cache,'plugins',name),dest=join(out,name);mkdirSync(dest,{recursive:true});
 for(const part of ['plugin.json','skills','references','themes','schemas'])if(existsSync(join(source,part)))cpSync(join(source,part),join(dest,part),{recursive:true,dereference:true});
 if(name==='kai-report-creator')cpSync(join(report,'dist'),join(dest,'mcp-servers/report-renderer/dist'),{recursive:true});
 else{
  const server=join(dest,'mcp-servers/slide-renderer');mkdirSync(server,{recursive:true});
  for(const file of readdirSync(join(source,'mcp-servers/slide-renderer')))if(file.endsWith('.py'))cpSync(join(source,'mcp-servers/slide-renderer',file),join(server,file));
  cpSync(runtime,join(dest,'bundled-python',target),{recursive:true,verbatimSymlinks:true});
  const packages=join(dest,'python-packages');mkdirSync(packages);
  // Wheels are pinned by the git revision. Extract the matching target wheels
  // directly: no pip, user site-packages or shared mutable venv at runtime.
  const wheels=join(source,'bundled-wheels');const selected=readdirSync(wheels).filter(file=>file.endsWith('-none-any.whl')||(target==='darwin-arm64'?file.endsWith('-macosx_11_0_arm64.whl'):target==='win32-x64'?file.endsWith('-win_amd64.whl'):false));
  if(target!==`${process.platform}-${process.arch}`)throw Error('creator_cross_build_not_supported:'+target);
  run(join(runtime,runtimeTarget.launcherRelativePath),['-I','-B','-c',"import sys,zipfile;[zipfile.ZipFile(p).extractall(sys.argv[1]) for p in sys.argv[2:]]",packages,...selected.map(file=>join(wheels,file))]);
  // Probe the actual isolated MCP import closure, not just python --version.
  // In particular, Windows needs pywin32 plus its pinned package .pth paths.
  run(join(runtime,runtimeTarget.launcherRelativePath),['-I','-B','-c',"import site,sys;site.addsitedir(sys.argv[1]);from mcp.server.mcpserver import MCPServer;import bs4,jsonschema;print('Bundled slide MCP dependency closure verified')",packages]);
  writeFileSync(join(dest,'runtime.json'),JSON.stringify({target,launcher:join('bundled-python',target,runtimeTarget.launcherRelativePath)}));
 }
 // The upstream planners refer to plugin-level references. Make those assets
 // discoverable by the original skillFetchAssets catalog without symlinks.
 for(const skill of readdirSync(join(dest,'skills')))if(existsSync(join(dest,'skills',skill,'SKILL.md')))cpSync(join(dest,'references'),join(dest,'skills',skill,'references'),{recursive:true});
 cpSync(join(cache,'LICENSE'),join(dest,'LICENSE'));
}
const files=[];function walk(dir,base=''){for(const name of readdirSync(dir,{withFileTypes:true})){const path=join(dir,name.name),rel=join(base,name.name);if(name.isDirectory())walk(path,rel);else if(name.isFile())files.push({file:rel,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')});}}walk(out);
writeFileSync(join(out,'sources.json'),JSON.stringify({...lock,names,target,files},null,2));
console.log(`Bundled report and slide creators (${target}, ${files.length} files)`);
