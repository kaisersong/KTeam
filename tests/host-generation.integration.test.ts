import {processBirth} from '../src/runtime/platform-process.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {mkdirSync,writeFileSync,readFileSync,symlinkSync,rmSync,existsSync} from 'node:fs';
import {spawn,type ChildProcess} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {privateTempDir} from './helpers/private-temp.js';
import {initStandalone} from '../src/runtime/managed-services.js';
import {hostRequest} from '../src/service/client.js';
import {desktopGeneration} from '../desktop/host-generation.js';

async function fixture(){
 const parent=privateTempDir(join(tmpdir(),'kteam-gen-')),build=join(parent,'app-build');mkdirSync(build);
 for(const name of ['service-owner.cjs','service-child.cjs','services'])symlinkSync(resolve('build',name),join(build,name));
 const url=(name:string)=>JSON.stringify(pathToFileURL(resolve('dist/src',name)).href);
 const code=`(async()=>{const {startHost}=await import(${url('service/server.js')}),{loadConfig,upstreamOptions}=await import(${url('service/config.js')}),{ensureSharedServices}=await import(${url('runtime/services.js')});const root=process.env.KTEAM_DATA_DIR;await ensureSharedServices(loadConfig(root),root);const host=await startHost({root,upstream:upstreamOptions(loadConfig(root))});for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>void host.close());})().catch(e=>{console.error(e);process.exitCode=1;});`;
 writeFileSync(join(build,'host.cjs'),code);writeFileSync(join(build,'foreign.cjs'),code);
 const roots:string[]=[],children:ChildProcess[]=[];
 const request=(root:string)=>(route:string,value?:unknown):Promise<any>=>hostRequest(root,'kteam-main',route,value);
 const start=async(root:string,entry='host.cjs')=>{let logs='';const child=spawn(process.execPath,[join(build,entry)],{env:{...process.env,KTEAM_DATA_DIR:root,KTEAM_MODEL_CONFIG_DIR:join(root,'runtime'),KTEAM_SERVICE_OWNER_ENTRY:join(build,'service-owner.cjs'),KTEAM_RUNTIME_ENTRY:resolve('build/shared/kteam-runtime.mjs')},stdio:['ignore','pipe','pipe']});children.push(child);child.stdout!.on('data',b=>logs=(logs+b).slice(-4000));child.stderr!.on('data',b=>logs=(logs+b).slice(-4000));const deadline=Date.now()+20000;while(Date.now()<deadline){if(child.exitCode!==null)throw Error(logs);try{const h=await request(root)('/v1/handshake');return {child,handshake:h};}catch{}await new Promise(r=>setTimeout(r,50));}throw Error('generation_fixture_start_timeout:'+logs);};
 const root=async(name:string)=>{const path=join(parent,name);await initStandalone(path);roots.push(path);return path;};
 const generation=(path:string,revision='fixture-new')=>desktopGeneration({root:path,executable:process.execPath,buildDirectory:build,revision,request:request(path)});
 return {parent,build,root,start,request,generation,async close(){for(const child of children)if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await new Promise<void>(r=>{const t=setTimeout(()=>child.kill('SIGKILL'),5000);child.once('exit',()=>{clearTimeout(t);r();});});}for(const path of roots){try{const g=await generation(path,'cleanup');g.close();}catch{}}rmSync(parent,{recursive:true,force:true});}};
}
const mac={skip:process.platform!=='darwin'};
test('a real legacy host and its authenticated managed services retire; another root with identical commands is untouched',mac,async()=>{
 const f=await fixture();let lease:Awaited<ReturnType<typeof desktopGeneration>>|undefined,reused:Awaited<ReturnType<typeof desktopGeneration>>|undefined;try{
  const a=await f.root('a'),b=await f.root('b'),first=await f.start(a),other=await f.start(b);
  const prefs=await f.request(a)('/v1/app/preferences');await f.request(a)('/v1/app/preferences',{expectedRevision:prefs.preferences.revision,displayName:'Synthetic generation upgrade',fontSize:16});
  lease=await f.generation(a);assert.equal(lease.reuse,false);if(first.child.exitCode===null)await new Promise(r=>first.child.once('exit',r));assert.notEqual(first.child.exitCode,null);assert.equal((await f.request(b)('/v1/handshake')).instanceId,other.handshake.instanceId);assert.equal(other.child.exitCode,null);
  const next=await f.start(a);await lease.commit(next.child.pid!);lease.close();assert.notEqual(next.handshake.instanceId,first.handshake.instanceId);assert(next.handshake.ownerEpoch>first.handshake.ownerEpoch);assert.equal((await f.request(a)('/v1/app/preferences')).preferences.displayName,'Synthetic generation upgrade');
  reused=await f.generation(a);assert.equal(reused.reuse,true);reused.close();assert.equal((await f.request(a)('/v1/handshake')).instanceId,next.handshake.instanceId);assert.equal(existsSync(join(a,'desktop-generation/handoff.json')),false);
 }finally{reused?.close();lease?.close();await f.close();}
});
test('an authenticated host with a foreign entry point is not stopped or relabelled as the new desktop',mac,async()=>{
 const f=await fixture();try{const a=await f.root('a');const config=JSON.parse(readFileSync(join(a,'config.json'),'utf8'));delete config.managedServiceConfig;writeFileSync(join(a,'config.json'),JSON.stringify(config));const old=await f.start(a,'foreign.cjs');await assert.rejects(f.generation(a),/desktop_generation_unconfirmed/);assert.equal((await f.request(a)('/v1/handshake')).instanceId,old.handshake.instanceId);assert.equal(old.child.exitCode,null);}finally{await f.close();}
});

test('an unknown prior host-stop intent is reconciled without repeating the mutation',mac,async()=>{
 const f=await fixture();try{const root=await f.root('a'),config=JSON.parse(readFileSync(join(root,'config.json'),'utf8'));delete config.managedServiceConfig;writeFileSync(join(root,'config.json'),JSON.stringify(config));const old=await f.start(root),directory=join(root,'desktop-generation');mkdirSync(directory,{mode:0o700});
  writeFileSync(join(directory,'handoff.json'),JSON.stringify({version:1,executable:process.execPath,instanceId:old.handshake.instanceId,members:[{pid:old.child.pid!,ppid:process.pid,uid:process.getuid!(),birth:processBirth(old.child.pid!).replace(/\s+/g,' '),command:process.execPath+' '+join(f.build,'host.cjs'),role:'host'}],intents:[old.child.pid!]}),{mode:0o600});
  let stops=0;await assert.rejects(desktopGeneration({root,executable:process.execPath,buildDirectory:f.build,revision:'fixture-new',request:async(route,value)=>{if(route==='/v1/host/stop')stops++;return f.request(root)(route,value);}}),/desktop_generation_unconfirmed/);assert.equal(stops,0);assert.equal((await f.request(root)('/v1/handshake')).instanceId,old.handshake.instanceId);
 }finally{await f.close();}
});
