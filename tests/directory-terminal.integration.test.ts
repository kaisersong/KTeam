import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {chmodSync,mkdirSync,writeFileSync,readFileSync,realpathSync,rmSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {privateTempDir} from './helpers/private-temp.js';
import {TeamStore} from '../src/service/team-store.js';
import {ToolApprovals} from '../src/service/tool-approvals.js';
import {createHarness} from '../src/runtime/harness.js';
import {sharedRuntime} from '../src/runtime/native.js';
import {directoryAccess} from '../src/service/directory-access.js';
import {commandAccess} from '../src/service/terminal-access.js';
const pause=()=>new Promise(resolve=>setTimeout(resolve,5));
async function fixture(){
 const root=privateTempDir(join(tmpdir(),'kteam-directory-terminal-')),workspace=join(root,'project'),config=join(root,'config');mkdirSync(workspace);mkdirSync(config);const previous=process.env.KTEAM_MODEL_CONFIG_DIR;process.env.KTEAM_MODEL_CONFIG_DIR=config;
 const core=await sharedRuntime();let store=new TeamStore(root),approvals=new ToolApprovals(store);const controller=new AbortController(),registries:any[]=[];
 const make=async(base=workspace)=>{const h=await createHarness({workspace:base,permissions:{store:approvals.permissions,botId:'member',bindingRevision:1},signal:controller.signal,assertCurrent:async()=>{},onPrompt:(name,input,meta)=>{const {assertCurrent,...facts}=meta;return approvals.ask({roomId:'room',jobId:'job',botId:'member',bindingRevision:1,...facts},name,input,controller.signal,assertCurrent);}});const registry=new core.ToolRegistry(h.registryOptions,h.tools);registries.push(registry);return {h,registry};};
 const pending=async(count=1)=>{const until=Date.now()+5000;while(approvals.list().reduce((n,item)=>n+item.pendingOperationCount,0)<count){if(Date.now()>until)throw Error('approval_timeout');await pause();}return approvals.list()[0]!;};
 return {root,workspace,core,make,pending,get store(){return store;},get approvals(){return approvals;},restart(){approvals.close();for(const registry of registries)registry.dispose();store.close();store=new TeamStore(root);approvals=new ToolApprovals(store);},close(){controller.abort();approvals.close();for(const registry of registries)registry.dispose();store.close();if(previous===undefined)delete process.env.KTEAM_MODEL_CONFIG_DIR;else process.env.KTEAM_MODEL_CONFIG_DIR=previous;rmSync(root,{recursive:true,force:true});}};
}
test('one directory decision covers actual file, terminal and Git operations, nested paths and restart; dangerous and outside operations still prompt',async()=>{
 const f=await fixture();try{
  execFileSync('git',['init','--quiet',f.workspace]);const {h,registry}=await f.make();const first=registry.executeTool('write',{file_path:'reports/one.txt',content:'one'}),pending=await f.pending();assert.equal(pending.directory,realpathSync(f.workspace));
  await f.approvals.decide({id:pending.id,expectedHash:pending.hash,decision:'allow_directory_routine'});await first;
  await registry.executeTool('edit',{file_path:'reports/one.txt',old_string:'one',new_string:'two'});
  const output=await registry.executeTool('bash',{command:process.platform==='win32'?'git status --porcelain':'mkdir -p reports/nested; printf DIRECTORY_OK > reports/nested/proof.txt; git status --porcelain | head -3',timeout_ms:5000});assert.doesNotMatch(output,/denied|not approved|拒绝/i);if(process.platform!=='win32')assert.equal(readFileSync(join(f.workspace,'reports/nested/proof.txt'),'utf8'),'DIRECTORY_OK');assert.equal(f.approvals.list().length,0);
  const pm=h.registryOptions.permissionManager;
  for(const command of ['rm reports/one.txt','git reset --hard','git clean -fd','git branch -D branch','git push origin main','sudo ls','node -e "require(\'fs\').unlinkSync(\'reports/one.txt\')"','git config core.sshCommand malicious'])assert.notEqual(await pm.check('bash',{command}),'allow',command);
  const outside=join(f.root,'outside');mkdirSync(outside);assert.equal(await pm.check('bash',{command:'git -C "'+outside+'" status'}),'allow');assert.equal(await pm.check('bash',{command:'printf OUTSIDE > "'+join(outside,'no.txt')+'"'}),'prompt');assert.equal(existsSync(join(outside,'no.txt')),false);
  f.restart();const restored=await f.make();assert.equal(await restored.h.registryOptions.permissionManager.check('bash',{command:'git status --porcelain | head -3'}),'allow');await restored.registry.executeTool('write',{file_path:'another/nested.txt',content:'restored'});assert.equal(f.approvals.list().length,0);
  f.approvals.permissions.revoke({id:f.approvals.permissions.list()[0]!.id});await assert.rejects(restored.h.assertCurrent(),/harness_permissions_changed/);
 }finally{f.close();}
});

test('granting one directory never approves a simultaneously pending operation in a different directory',async()=>{
 const f=await fixture();try{const {registry}=await f.make(),other=join(f.root,'other');mkdirSync(other);const a=registry.executeTool('write',{file_path:'one.txt',content:'allowed'}),b=registry.executeTool('write',{file_path:join(other,'two.txt'),content:'forbidden'});await f.pending(2);const pending=f.approvals.list().find(item=>item.directory===f.workspace)!;assert.ok(pending);await f.approvals.decide({id:pending.id,expectedHash:pending.hash,decision:'allow_directory_routine'});await a;assert.equal(f.approvals.list().length,1);assert.equal(existsSync(join(other,'two.txt')),false);const remaining=f.approvals.list()[0]!;await f.approvals.decide({id:remaining.id,expectedHash:remaining.hash,decision:'deny'});await b;assert.equal(existsSync(join(other,'two.txt')),false);}finally{f.close();}
});

test('the supplied compound Git workflow reuses its directory grant across changed scripts, commands and restart',async()=>{
 if(process.platform==='win32')return; // The supplied for/do shell syntax is POSIX; other directory tests execute on Windows too.
 const f=await fixture();try{
  const seed=join(f.root,'seed'),upstreams=join(f.root,'upstreams');mkdirSync(seed);mkdirSync(upstreams);execFileSync('git',['init','--quiet',seed]);writeFileSync(join(seed,'proof.txt'),'fixture');execFileSync('git',['-C',seed,'add','.']);execFileSync('git',['-C',seed,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--quiet','-m','fixture']);const revision=execFileSync('git',['-C',seed,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
  for(const name of ['kswarm','intent-broker'])execFileSync('git',['-C',seed,'worktree','add','--quiet','--detach',join(upstreams,name),'HEAD']);
  mkdirSync(join(f.workspace,'scripts'));writeFileSync(join(f.workspace,'scripts/verify-sources.mjs'),readFileSync(resolve('scripts/verify-sources.mjs')));writeFileSync(join(f.workspace,'baseline.txt'),'fixture');writeFileSync(join(f.workspace,'sources.lock.json'),JSON.stringify({vendoredFiles:[],references:[],productBaseline:{file:'baseline.txt',sha256:createHash('sha256').update('fixture').digest('hex')},sources:['kswarm','intent-broker'].map(name=>({name,revision}))}));
  const command=`git -C ${upstreams}/kswarm status --porcelain | head -3; git -C ${upstreams}/intent-broker status --porcelain | head -3; for repo in kswarm intent-broker; do d=${upstreams}/$repo; gitdir=$(git -C "$d" rev-parse --git-dir); mkdir -p "$gitdir/info"; echo node_modules >> "$gitdir/info/exclude"; done; cd ${f.workspace} && KTEAM_UPSTREAM_ROOT=${upstreams} node scripts/verify-sources.mjs && echo SOURCES-OK`;
  let current=await f.make(f.root);const first=current.registry.executeTool('bash',{command,timeout_ms:10000,workdir:f.root}),pending=await f.pending();assert.equal(pending.canAlways,true);assert.equal(pending.commandScoped,false);assert.deepEqual(pending.directories,[realpathSync(f.root)]);await f.approvals.decide({id:pending.id,expectedHash:pending.hash,decision:'allow_directory_routine'});assert.match(await first,/SOURCES-OK/);
  assert.match(await current.registry.executeTool('bash',{command,timeout_ms:10000,workdir:f.root}),/SOURCES-OK/);assert.equal(f.approvals.list().length,0);
  assert.equal(await current.h.registryOptions.permissionManager.check('bash',{command:command+'; echo CHANGED',workdir:f.root}),'allow');
  f.restart();current=await f.make(f.root);assert.equal(await current.h.registryOptions.permissionManager.check('bash',{command,workdir:f.root}),'allow');
  writeFileSync(join(f.workspace,'scripts/verify-sources.mjs'),'console.log("changed script inside approved directory")');assert.equal(await current.h.registryOptions.permissionManager.check('bash',{command,workdir:f.root}),'allow');
  for(const highRisk of ['rm -rf '+f.workspace,'git reset --hard','git push origin main'])assert.notEqual(await current.h.registryOptions.permissionManager.check('bash',{command:highRisk,workdir:f.root}),'allow');
 }finally{f.close();}
});

test('legacy file-only directory grants require an explicit new decision before covering terminal commands',async()=>{
 const f=await fixture();try{execFileSync('git',['init','--quiet',f.workspace]);const scope={botId:'member',bindingRevision:1,cwd:f.workspace};f.approvals.permissions.rememberDirectory(scope,directoryAccess(f.core,'write',{file_path:join(f.workspace,'legacy.txt')},f.workspace)!);
 const row=f.store.stateEntries('tool-directory-permission:')[0]!;const legacy={...row.value};delete legacy.operations;f.store.setState(row.key,legacy);
 const {registry,h}=await f.make();assert.equal(await h.registryOptions.permissionManager.check('write',{file_path:'legacy.txt',content:'legacy'}),'allow');assert.equal(await h.registryOptions.permissionManager.check('bash',{command:'mkdir -p terminal-granted'}),'prompt');
 const result=registry.executeTool('bash',{command:'mkdir -p terminal-granted'}),pending=await f.pending();await f.approvals.decide({id:pending.id,expectedHash:pending.hash,decision:'allow_directory_routine'});await result;assert.equal(f.approvals.permissions.list()[0]!.operations,'routine');assert.equal(await h.registryOptions.permissionManager.check('bash',{command:'mkdir -p terminal-granted'}),'allow');
 }finally{f.close();}
});


test('the screenshot branch-and-merge workflow offers repository authorization, survives restart and respects deny',async()=>{
 if(process.platform==='win32')return;
 const f=await fixture();try{
  const git=(...args:string[])=>execFileSync('git',['-C',f.workspace,...args],{encoding:'utf8'}).trim();
  git('init','--quiet');writeFileSync(join(f.workspace,'proof.txt'),'base');git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--quiet','-m','base');git('branch','origin/release/1.1.6');git('branch','origin/main');
  const command=`cd ${f.workspace} && git checkout -b release/1.1.6 origin/release/1.1.6 2>&1 | tail -1 && git merge origin/main --no-edit 2>&1 | tail -6; echo ===; git status -s | head`;
  let current=await f.make(f.root);assert.equal(await current.h.registryOptions.permissionManager.check('bash',{command,workdir:f.root}),'prompt');
  const execution=current.registry.executeTool('bash',{command,workdir:f.root}),pending=await f.pending();assert.equal(pending.canAlways,true);assert.deepEqual(pending.directories,[realpathSync(f.workspace)]);assert.equal(git('branch','--list','release/1.1.6'),'');
  await f.approvals.decide({id:pending.id,expectedHash:pending.hash,decision:'allow_directory_routine'});assert.match(await execution,/===/);assert.equal(git('branch','--show-current'),'release/1.1.6');
  f.restart();current=await f.make(f.root);assert.equal(await current.h.registryOptions.permissionManager.check('bash',{command,workdir:f.root}),'allow');
  for(const unsafe of ['git checkout -f origin/main','git checkout -- proof.txt','git merge --abort','git merge -s custom origin/main','git push origin main'])assert.notEqual(await current.h.registryOptions.permissionManager.check('bash',{command:`cd ${f.workspace} && ${unsafe}`,workdir:f.root}),'allow',unsafe);
  writeFileSync(join(f.workspace,'blocked.txt'),'keep');writeFileSync(join(f.root,'config/settings.json'),JSON.stringify({permissions:{deny:['bash:git merge*']}}));const denied=await f.make(f.root);assert.equal(await denied.h.registryOptions.permissionManager.check('bash',{command,workdir:f.root}),'deny');
 }finally{f.close();}
});


test('one trusted directory covers new programs, multiline scripts and changed syntax; high-risk commands have separate persistent approval',async()=>{
 if(process.platform==='win32')return;
 const f=await fixture();try{
  const tool=join(f.workspace,'novel-project-audit');writeFileSync(tool,'#!/bin/sh\nprintf NOVEL_TOOL_OK\n');chmodSync(tool,0o700);
  let current=await f.make();const first=current.registry.executeTool('write',{file_path:'grant.txt',content:'directory grant'}),pending=await f.pending();await f.approvals.decide({id:pending.id,expectedHash:pending.hash,decision:'allow_directory_routine'});await first;
  const script="python3 - <<'PY'\nfrom pathlib import Path\nPath('script-output.txt').write_text('TRUSTED_SCRIPT_OK')\nprint('TRUSTED_SCRIPT_OK')\nPY";
  for(const command of [script,'./novel-project-audit',"sh -c 'printf WRAPPER_OK'",'git checkout -b a-new-branch'])assert.equal(await current.h.registryOptions.permissionManager.check('bash',{command}),'allow',command);
  assert.match(await current.registry.executeTool('bash',{command:script}),/TRUSTED_SCRIPT_OK/);assert.match(await current.registry.executeTool('bash',{command:'./novel-project-audit'}),/NOVEL_TOOL_OK/);assert.equal(f.approvals.list().length,0);
  f.restart();current=await f.make();assert.equal(await current.h.registryOptions.permissionManager.check('bash',{command:script}),'allow');
  writeFileSync(join(f.workspace,'remove-me.txt'),'not deleted before explicit approval');const command='rm -f remove-me.txt',removal=current.registry.executeTool('bash',{command}),highRisk=await f.pending();assert.equal(highRisk.highRisk,true);assert.equal(highRisk.commandScoped,true);assert.equal(highRisk.canAlways,true);assert.equal(existsSync(join(f.workspace,'remove-me.txt')),true);
  await f.approvals.decide({id:highRisk.id,expectedHash:highRisk.hash,decision:'allow_always'});await removal;assert.equal(existsSync(join(f.workspace,'remove-me.txt')),false);
  f.restart();current=await f.make();assert.equal(await current.h.registryOptions.permissionManager.check('bash',{command}),'allow');assert.equal(await current.h.registryOptions.permissionManager.check('bash',{command:'rm -f another.txt'}),'prompt');
  const sibling=join(f.root,'sibling');mkdirSync(sibling);assert.equal(await current.h.registryOptions.permissionManager.check('bash',{command:'./novel-project-audit --output=../sibling/result.txt'}),'prompt');
  const other=await createHarness({workspace:f.workspace,permissions:{store:f.approvals.permissions,botId:'another-member',bindingRevision:1},signal:AbortSignal.timeout(10000),assertCurrent:async()=>{}});assert.equal(await other.registryOptions.permissionManager.check('bash',{command:script}),'prompt');assert.equal(await other.registryOptions.permissionManager.check('bash',{command}),'prompt');
  const exact=f.approvals.permissions.list().find(grant=>grant.kind==='command')!;f.approvals.permissions.revoke({id:exact.id});const after=await f.make();assert.equal(await after.h.registryOptions.permissionManager.check('bash',{command}),'prompt');assert.equal(await after.h.registryOptions.permissionManager.check('bash',{command:script}),'allow');
  writeFileSync(join(f.root,'config/settings.json'),JSON.stringify({permissions:{deny:['bash:rm*','bash:python3*']}}));const denied=await f.make();assert.equal(await denied.h.registryOptions.permissionManager.check('bash',{command}),'deny');assert.equal(await denied.h.registryOptions.permissionManager.check('bash',{command:script}),'deny');
 }finally{f.close();}
});
