import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {mkdirSync,writeFileSync,readFileSync,realpathSync,rmSync,existsSync} from 'node:fs';
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
  const outside=join(f.root,'outside');mkdirSync(outside);assert.equal(await pm.check('bash',{command:'git -C "'+outside+'" status'}),'prompt');assert.equal(await pm.check('bash',{command:'printf OUTSIDE > "'+join(outside,'no.txt')+'"'}),'prompt');assert.equal(existsSync(join(outside,'no.txt')),false);
  f.restart();const restored=await f.make();assert.equal(await restored.h.registryOptions.permissionManager.check('bash',{command:'git status --porcelain | head -3'}),'allow');await restored.registry.executeTool('write',{file_path:'another/nested.txt',content:'restored'});assert.equal(f.approvals.list().length,0);
  f.approvals.permissions.revoke({id:f.approvals.permissions.list()[0]!.id});await assert.rejects(restored.h.assertCurrent(),/harness_permissions_changed/);
 }finally{f.close();}
});

test('granting one directory never approves a simultaneously pending operation in a different directory',async()=>{
 const f=await fixture();try{const {registry}=await f.make(),other=join(f.root,'other');mkdirSync(other);const a=registry.executeTool('write',{file_path:'one.txt',content:'allowed'}),b=registry.executeTool('write',{file_path:join(other,'two.txt'),content:'forbidden'});await f.pending(2);const pending=f.approvals.list().find(item=>item.directory===f.workspace)!;assert.ok(pending);await f.approvals.decide({id:pending.id,expectedHash:pending.hash,decision:'allow_directory_routine'});await a;assert.equal(f.approvals.list().length,1);assert.equal(existsSync(join(other,'two.txt')),false);const remaining=f.approvals.list()[0]!;await f.approvals.decide({id:remaining.id,expectedHash:remaining.hash,decision:'deny'});await b;assert.equal(existsSync(join(other,'two.txt')),false);}finally{f.close();}
});

test('the supplied compound Git workflow supports exact persistent approval and rejects changed commands or changed local scripts',async()=>{
 if(process.platform==='win32')return; // The supplied for/do shell syntax is POSIX; other directory tests execute on Windows too.
 const f=await fixture();try{
  const seed=join(f.root,'seed'),upstreams=join(f.root,'upstreams');mkdirSync(seed);mkdirSync(upstreams);execFileSync('git',['init','--quiet',seed]);writeFileSync(join(seed,'proof.txt'),'fixture');execFileSync('git',['-C',seed,'add','.']);execFileSync('git',['-C',seed,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--quiet','-m','fixture']);const revision=execFileSync('git',['-C',seed,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
  for(const name of ['kswarm','intent-broker'])execFileSync('git',['-C',seed,'worktree','add','--quiet','--detach',join(upstreams,name),'HEAD']);
  mkdirSync(join(f.workspace,'scripts'));writeFileSync(join(f.workspace,'scripts/verify-sources.mjs'),readFileSync(resolve('scripts/verify-sources.mjs')));writeFileSync(join(f.workspace,'baseline.txt'),'fixture');writeFileSync(join(f.workspace,'sources.lock.json'),JSON.stringify({vendoredFiles:[],references:[],productBaseline:{file:'baseline.txt',sha256:createHash('sha256').update('fixture').digest('hex')},sources:['kswarm','intent-broker'].map(name=>({name,revision}))}));
  const command=`git -C ${upstreams}/kswarm status --porcelain | head -3; git -C ${upstreams}/intent-broker status --porcelain | head -3; for repo in kswarm intent-broker; do d=${upstreams}/$repo; gitdir=$(git -C "$d" rev-parse --git-dir); mkdir -p "$gitdir/info"; echo node_modules >> "$gitdir/info/exclude"; done; cd ${f.workspace} && KTEAM_UPSTREAM_ROOT=${upstreams} node scripts/verify-sources.mjs && echo SOURCES-OK`;
  assert.ok(commandAccess(f.core,command,f.root));let current=await f.make(f.root);const first=current.registry.executeTool('bash',{command,timeout_ms:10000,workdir:f.root}),pending=await f.pending();assert.equal(pending.canAlways,true);assert.equal(pending.commandScoped,true);assert.equal(pending.directory,undefined);await f.approvals.decide({id:pending.id,expectedHash:pending.hash,decision:'allow_always'});assert.match(await first,/SOURCES-OK/);assert.equal(f.approvals.permissions.list()[0]!.kind,'command');assert.ok(f.approvals.permissions.list()[0]!.access.gitFiles.length>=2);assert.match(f.approvals.permissions.list()[0]!.display,/verify-sources/);
  assert.match(await current.registry.executeTool('bash',{command,timeout_ms:10000,workdir:f.root}),/SOURCES-OK/);assert.equal(f.approvals.list().length,0);
  assert.equal(await current.h.registryOptions.permissionManager.check('bash',{command:command+'; echo CHANGED',workdir:f.root}),'prompt');
  assert.equal(commandAccess(f.core,command+'; rm -rf '+f.workspace,f.root),undefined);
  for(const unsafe of ['PATH=/unexpected; git status','for PATH in unexpected; do git status; done','x=rm; $x keep.txt','git config core.sshCommand unsafe'])assert.equal(commandAccess(f.core,unsafe,f.root),undefined,unsafe);
  const dot=join(upstreams,'kswarm','.git'),originalDot=readFileSync(dot,'utf8');writeFileSync(dot,readFileSync(join(upstreams,'intent-broker','.git'),'utf8'));assert.equal(await current.h.registryOptions.permissionManager.check('bash',{command,workdir:f.root}),'prompt');writeFileSync(dot,originalDot);
  f.restart();current=await f.make(f.root);assert.equal(await current.h.registryOptions.permissionManager.check('bash',{command,workdir:f.root}),'allow');
  writeFileSync(join(f.workspace,'scripts/verify-sources.mjs'),'throw new Error("changed script must not execute")');assert.equal(await current.h.registryOptions.permissionManager.check('bash',{command,workdir:f.root}),'prompt');
  const next=current.registry.executeTool('bash',{command,workdir:f.root});const changed=await f.pending();writeFileSync(join(f.workspace,'scripts/verify-sources.mjs'),'throw new Error("changed again")');await assert.rejects(f.approvals.decide({id:changed.id,expectedHash:changed.hash,decision:'allow_always'}),/tool_command_changed/);await next;assert.equal(f.approvals.list().length,0);
 }finally{f.close();}
});


test('legacy file-only directory grants require an explicit new decision before covering terminal commands',async()=>{
 const f=await fixture();try{execFileSync('git',['init','--quiet',f.workspace]);const scope={botId:'member',bindingRevision:1,cwd:f.workspace};f.approvals.permissions.rememberDirectory(scope,directoryAccess(f.core,'write',{file_path:join(f.workspace,'legacy.txt')},f.workspace)!);
 const row=f.store.stateEntries('tool-directory-permission:')[0]!;const legacy={...row.value};delete legacy.operations;f.store.setState(row.key,legacy);
 const {registry,h}=await f.make();assert.equal(await h.registryOptions.permissionManager.check('write',{file_path:'legacy.txt',content:'legacy'}),'allow');assert.equal(await h.registryOptions.permissionManager.check('bash',{command:'git status --porcelain'}),'prompt');
 const result=registry.executeTool('bash',{command:'git status --porcelain'}),pending=await f.pending();await f.approvals.decide({id:pending.id,expectedHash:pending.hash,decision:'allow_directory_routine'});await result;assert.equal(f.approvals.permissions.list()[0]!.operations,'routine');assert.equal(await h.registryOptions.permissionManager.check('bash',{command:'git status --porcelain'}),'allow');
 }finally{f.close();}
});
