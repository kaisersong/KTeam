import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,realpathSync,rmSync,writeFileSync,readFileSync,symlinkSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ensureBundledYzjCli,configureBundledYzjCli} from '../src/runtime/bundled-yzj-cli.js';
import {ENTERPRISE_CLI_COMMANDS,getEnterpriseCliArtifact} from '../src/runtime/enterprise-cli-catalog.js';
import {connectorCommand} from '../src/runtime/connector-command.js';
import {EnterpriseConnectors} from '../src/service/enterprise-connectors.js';
import {YzjCliAuthService} from '../src/service/yzj-cli-auth-service.js';
import {initConfig} from '../src/service/config.js';
import {startHost} from '../src/service/server.js';
import {hostRequest} from '../src/service/client.js';

test('renewing the same Yunzhijia account retains its daily source identity across restart',async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'kteam-yzj-reauth-')));
 const historyPath=join(root,'history.json');
 let now=Date.parse('2026-11-24T07:00:00Z'),user='owner',signedIn=false;
 const orgId='fixture-org';
 const run=((_command:string,args:string[])=>{
  if(args[0]==='auth')signedIn=true;
  const output=args[0]==='whoami'&&signedIn?JSON.stringify({success:true,data:{orgId,openId:user,tokenStatus:'valid'}}):'';
  const status=signedIn?0:3;
  return spawn(process.execPath,['-e',`process.stdout.write(${JSON.stringify(output)});process.exitCode=${status};`],{stdio:['ignore','pipe','pipe'],windowsHide:true});
 }) as typeof spawn;
 const start=()=>new YzjCliAuthService({spawn:run,resolveBinary:()=>process.execPath,now:()=>now,connectionHistoryPath:historyPath});
 let connector=start();
 const wait=async(phase:string)=>{
  for(let index=0;index<120;index++){
   const state=connector.getState();
   if(state.phase===phase)return state;
   await delay(25);
  }
  assert.fail('connector did not reach '+phase);
 };
 const login=async()=>{
  await connector.control('login','user');
  return (await wait('authenticated')).connection!;
 };
 try{
  const initial=(await login()).connectedAt;
  assert.equal(initial,new Date(now).toISOString());
  await connector.dispose();
  connector=start();
  signedIn=false;
  await connector.control('check','user');
  await wait('signedOut');
  now+=86400000;
  const renewed=await login();
  assert.equal(renewed.connectedAt,initial);
  assert.equal(renewed.checkedAt,new Date(now).toISOString());
  user='another-user';
  now+=1000;
  assert.equal((await login()).connectedAt,new Date(now).toISOString());
  assert.equal(connector.connectedAt(orgId,'owner'),undefined);
  user='owner';
  now+=1000;
  assert.equal((await login()).connectedAt,new Date(now).toISOString());
 }finally{await connector.dispose();rmSync(root,{recursive:true,force:true});}
});

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

test('opening settings restores all existing CLI logins after each host restart without initiating login', {skip:process.platform==='win32'}, async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'kteam-cli-restore-')));
 const savedPath=process.env.PATH;
 const marker=join(root,'status-checks');
 const installed=[['yzj','authenticated'],['dingtalk','connected'],['feishu','connected']];
 function fixture(file:string,args:string,provider:string,result:unknown){
  mkdirSync(join(file,'..'),{recursive:true});
  const script=`#!/bin/sh
if [ "$*" = '--version' ]; then echo 'yzj-cli 0.1.8'; exit; fi
if [ "$*" != '${args}' ]; then echo unexpected >> "${marker}"; exit 1; fi
echo ${provider} >> "${marker}"
cat <<'STATUS'
${JSON.stringify(result)}
STATUS
`;
  writeFileSync(file,script,{mode:0o700});
  return script;
 }
 try{
  const cloud=ensureBundledYzjCli({configDir:root});
  fixture(cloud.binaryPath,'whoami','yzj',{success:true,data:{openId:'fixture-user',orgId:'fixture-org'}});
  for(const provider of ['dingtalk','feishu'] as const){
   const {version}=getEnterpriseCliArtifact(provider,process.platform,process.arch)!;
   const dir=join(root,'tools','enterprise-cli',provider,`${process.platform}-${process.arch}`,version);
   const args=provider==='dingtalk'?'auth status --readonly --format json':'auth status --json';
   const result=provider==='dingtalk'
    ? {success:true,authenticated:true,user_id:'fixture-user',token_valid:true}
    : {appId:'fixture-app',identities:{user:{available:true,openId:'fixture-user',tokenStatus:'valid'}}};
   const script=fixture(join(dir,ENTERPRISE_CLI_COMMANDS[provider]),args,provider,result);
   writeFileSync(join(dir,'installed.json'),JSON.stringify({version,sha256:createHash('sha256').update(script).digest('hex')}));
  }
  for(let start=0;start<2;start++){
   const owner=new EnterpriseConnectors({configRoot:root,openExternal:async()=>assert.fail('status must not open authorization')});
   try{
    const rows=()=>owner.view().then(view=>view.connectors.filter(row=>row.installed));
    const first=await Promise.all([rows(),rows()]);
    assert.ok(first.every(snapshot=>snapshot.length===installed.length&&snapshot.every(row=>!['ready','idle'].includes(row.phase))));
    let snapshot=await rows();
    for(let poll=0;poll<100&&snapshot.some(row=>row.phase==='checking');poll++){
     await delay(25);
     snapshot=await rows();
    }
    assert.deepEqual(snapshot.map(row=>[row.provider,row.phase]),installed);
   }finally{await owner.close();}
  }
  assert.deepEqual(readFileSync(marker,'utf8').trim().split('\n').sort(),installed.flatMap(([provider])=>[provider,provider]).sort());
 }finally{
  if(savedPath===undefined)delete process.env.PATH;
  else process.env.PATH=savedPath;
  rmSync(root,{recursive:true,force:true});
 }
});

test('real host exposes connector semantic routes only to authenticated main client',async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'kteam-cli-host-')));initConfig(root,{version:1,brokerUrl:'http://127.0.0.1:1',kswarmUrl:'http://127.0.0.1:1'});const host=await startHost({root,upstream:{brokerUrl:'http://127.0.0.1:1',kswarmUrl:'http://127.0.0.1:1'}});
 try{
  await assert.rejects(hostRequest(root,'kteam-companion','/v1/app/enterprise-connectors'),/app_settings_forbidden/);
  await assert.rejects(hostRequest(root,'kteam-companion','/v1/app/enterprise-connectors',{provider:'yzj',action:'login',expectedRevision:'forged'}),/app_settings_forbidden/);
  const state:any=await hostRequest(root,'kteam-main','/v1/app/enterprise-connectors');assert.equal(state.connectors.length,4);assert.equal(state.messageChannel.provider,'yzj');assert.equal(state.messageChannel.nativeCards,false);assert.equal(state.connectors[0].defaultMessageChannel,true);
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
  const script=`const m=require(${JSON.stringify(bundle)});const cli=m.configureBundledYzjCli({configDir:${JSON.stringify(root)},packageRoot:${JSON.stringify(packageRoot)}});if(!cli)process.exit(1);const win=process.platform==='win32',launcher=require('node:path').join(cli.binDir,win?'yzj-cli.cmd':'yzj-cli');const result=require('node:child_process').spawnSync(win?process.env.ComSpec:launcher,win?['/d','/s','/c','\"\"'+launcher+'\" --version\"']:['--version'],{encoding:'utf8',windowsVerbatimArguments:win,windowsHide:true,timeout:20000});if(result.error)throw result.error;if(result.status!==0)throw Error(result.stderr);console.log(result.stdout);`;
  const child=await new Promise<{code:number|null;stdout:string;stderr:string}>(async(resolve,reject)=>{const previous=process.env.KTEAM_DESKTOP_RESOURCES;process.env.KTEAM_DESKTOP_RESOURCES=process.cwd()+'/desktop';try{resolve(await connectorCommand(process.execPath,['-e',script]));}catch(e){reject(e);}finally{if(previous===undefined)delete process.env.KTEAM_DESKTOP_RESOURCES;else process.env.KTEAM_DESKTOP_RESOURCES=previous;}});
  assert.equal(child.code,0,child.stderr);assert.match(child.stdout,/yzj-cli 0.1.8/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
