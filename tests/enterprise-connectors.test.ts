import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,rmSync,writeFileSync,readFileSync,symlinkSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ensureBundledYzjCli,configureBundledYzjCli} from '../src/runtime/bundled-yzj-cli.js';
import {connectorCommand} from '../src/runtime/connector-command.js';
import {EnterpriseConnectors} from '../src/service/enterprise-connectors.js';
import {initConfig} from '../src/service/config.js';
import {startHost} from '../src/service/server.js';
import {hostRequest} from '../src/service/client.js';

test('bundled native CLI and process-local launcher execute; existing updated copy survives; symlinks fail closed',async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'kteam-cli-bundle-')));
 try{
  const cli=ensureBundledYzjCli({configDir:root});assert.equal((await connectorCommand(cli.binaryPath,['--version'])).stdout.trim(),'yzj-cli 0.1.8');
  const env:NodeJS.ProcessEnv={PATH:'/usr/bin:/bin'};const configured=configureBundledYzjCli({configDir:root,env})!;assert.ok(configured);assert.equal((process.platform==='win32'?spawnSync(process.env.ComSpec??'C:\\Windows\\System32\\cmd.exe',['/d','/s','/c','""'+join(configured.binDir,'yzj-cli.cmd')+'" --version"'],{encoding:'utf8',windowsVerbatimArguments:true,windowsHide:true,timeout:20000}).stdout.trim():(await connectorCommand(join(configured.binDir,'yzj-cli'),['--version'])).stdout.trim()),'yzj-cli 0.1.8');assert.ok(env.PATH!.startsWith(configured.binDir));
  writeFileSync(cli.binaryPath,'preserved-update');ensureBundledYzjCli({configDir:root});assert.equal(readFileSync(cli.binaryPath,'utf8'),'preserved-update');
  unlinkSync(cli.binaryPath);symlinkSync(join(root,'outside'),cli.binaryPath);assert.throws(()=>ensureBundledYzjCli({configDir:root}),/符号链接/);
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('owned subprocess timeout, cancellation and oversized output reach physical close',async()=>{
 await assert.rejects(connectorCommand(process.execPath,['-e','setInterval(()=>{},100)'],undefined,40),/timeout/);
 const controller=new AbortController();const work=connectorCommand(process.execPath,['-e','setInterval(()=>{},100)'],controller.signal);controller.abort();await assert.rejects(work,/cancelled/);
 await assert.rejects(connectorCommand(process.execPath,['-e',"process.stdout.write('x'.repeat(70000));setInterval(()=>{},100)"]),/output_limit/);
});

test('connector mutations fence stale/forged inputs, cancel duplicate and recover across owners without logging in',async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'kteam-cli-owner-')));let owner=new EnterpriseConnectors({configRoot:root});
 try{
  const view=await owner.view();assert.deepEqual(new Set(view.connectors.map(c=>c.provider)),new Set(['yzj','dingtalk','feishu','wecom']));const cloud=view.connectors[0]!;assert.equal(cloud.installed,true);
  await assert.rejects(owner.control({provider:'yzj',action:'login',expectedRevision:'stale'}),/connector_changed/);
  await assert.rejects(owner.control({provider:'yzj',action:'exec',expectedRevision:cloud.revision}),/connector_action_invalid/);
  await assert.rejects(owner.control({provider:'yzj',action:'check',expectedRevision:cloud.revision,requestSource:'user'}),/unknown_field/);
  const cancelled=await owner.control({provider:'yzj',action:'cancel',expectedRevision:cloud.revision});const current=cancelled.connectors[0]!;
  await owner.control({provider:'yzj',action:'cancel',expectedRevision:current.revision});
  await owner.close();owner=new EnterpriseConnectors({configRoot:root});assert.equal((await owner.view()).connectors[0]!.installed,true);
 }finally{await owner.close();rmSync(root,{recursive:true,force:true});}
});

test('real host exposes connector semantic routes only to authenticated main client',async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'kteam-cli-host-')));initConfig(root,{version:1,brokerUrl:'http://127.0.0.1:1',kswarmUrl:'http://127.0.0.1:1'});const host=await startHost({root,upstream:{brokerUrl:'http://127.0.0.1:1',kswarmUrl:'http://127.0.0.1:1'}});
 try{
  await assert.rejects(hostRequest(root,'kteam-companion','/v1/app/enterprise-connectors'),/app_settings_forbidden/);
  await assert.rejects(hostRequest(root,'kteam-companion','/v1/app/enterprise-connectors',{provider:'yzj',action:'login',expectedRevision:'forged'}),/app_settings_forbidden/);
  const state:any=await hostRequest(root,'kteam-main','/v1/app/enterprise-connectors');assert.equal(state.connectors.length,4);
  await assert.rejects(hostRequest(root,'kteam-main','/v1/app/enterprise-connectors',{provider:'yzj',action:'check',expectedRevision:'forged'}),/connector_changed/);
 }finally{await host.close();rmSync(root,{recursive:true,force:true});}
});

test('updater verifies native candidates, rejects duplicate owners, preserves working version on failure and reclaims dead-owner lock',async()=>{
 const {createRequire}=await import('node:module');const {mkdirSync,copyFileSync,existsSync}=await import('node:fs');
 const {updateCli}=createRequire(import.meta.url)('../../desktop/yzj-cli/runner.cjs');const root=realpathSync(mkdtempSync(join(tmpdir(),'kteam-cli-update-')));
 try{
  const cli=ensureBundledYzjCli({configDir:root});const original=readFileSync(cli.binaryPath);const input={binaryPath:cli.binaryPath,force:true};
  const deps={fetchMetadata:async()=>({version:'0.1.8'}),log:()=>{},install:async({destination}:{destination:string})=>copyFileSync(cli.binaryPath,destination)};
  const lock=join(cli.binDir,'.update-lock');mkdirSync(lock);writeFileSync(join(lock,'owner.json'),JSON.stringify({pid:process.pid}));await assert.rejects(updateCli(input,deps),/已在运行/);
  writeFileSync(join(lock,'owner.json'),JSON.stringify({pid:2147483647}));await updateCli(input,deps);assert.deepEqual(readFileSync(cli.binaryPath),original);assert.equal(existsSync(lock),false);
  await assert.rejects(updateCli(input,{...deps,fetchMetadata:async()=>({version:'99.0.0'})}),/版本.*不一致/);assert.deepEqual(readFileSync(cli.binaryPath),original);assert.equal(existsSync(lock),false);
  await updateCli(input,deps);assert.equal((await connectorCommand(cli.binaryPath,['--version'])).stdout.trim(),'yzj-cli 0.1.8');
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('desktop CommonJS bundle launches the packaged runner with Electron-compatible Node arguments',async()=>{
 const {build}=await import('esbuild');const {createRequire}=await import('node:module');const {dirname,resolve}=await import('node:path');const root=realpathSync(mkdtempSync(join(tmpdir(),'kteam-cli-cjs-')));
 try{
  const entry=resolve('src/runtime/bundled-yzj-cli.ts'),bundle=join(root,'bundled.cjs'),packageRoot=dirname(createRequire(import.meta.url).resolve('@yunzhijia/cli/package.json'));
  await build({entryPoints:[entry],outfile:bundle,bundle:true,platform:'node',format:'cjs',logLevel:'silent'});
  const script=`const m=require(${JSON.stringify(bundle)});const cli=m.configureBundledYzjCli({configDir:${JSON.stringify(root)},packageRoot:${JSON.stringify(packageRoot)}});if(!cli)process.exit(1);console.log(require('node:child_process').execFileSync(require('node:path').join(cli.binDir,'yzj-cli'),['--version'],{encoding:'utf8'}));`;
  const child=await new Promise<{code:number|null;stdout:string;stderr:string}>(async(resolve,reject)=>{const previous=process.env.KTEAM_DESKTOP_RESOURCES;process.env.KTEAM_DESKTOP_RESOURCES=process.cwd()+'/desktop';try{resolve(await connectorCommand(process.execPath,['-e',script]));}catch(e){reject(e);}finally{if(previous===undefined)delete process.env.KTEAM_DESKTOP_RESOURCES;else process.env.KTEAM_DESKTOP_RESOURCES=previous;}});
  assert.equal(child.code,0,child.stderr);assert.match(child.stdout,/yzj-cli 0.1.8/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
