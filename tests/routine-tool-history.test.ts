import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,mkdirSync,writeFileSync,readFileSync,readdirSync,rmSync,symlinkSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHarness} from '../src/runtime/harness.js';
import {TeamStore} from '../src/service/team-store.js';
import {ToolApprovals} from '../src/service/tool-approvals.js';
import {sharedRuntime} from '../src/runtime/native.js';
import {routineReadCommand,routineDocument,projectCommand} from '../src/runtime/routine-tools.js';

async function fixture(){
 process.env.KTEAM_RUNTIME_ENTRY=resolve('build/shared/xiaok-runtime.mjs');
 const root=realpathSync(mkdtempSync('/tmp/kteam-routine-')),cwd=join(root,'project with spaces'),config=join(root,'config'),state=join(root,'host-data');
 for(const path of [cwd,config,state])mkdirSync(path);
 const previous={config:process.env.KTEAM_MODEL_CONFIG_DIR,plugins:process.env.XIAOK_DISABLE_GLOBAL_PLUGINS};process.env.KTEAM_MODEL_CONFIG_DIR=config;process.env.XIAOK_DISABLE_GLOBAL_PLUGINS='1';
 return {root,cwd,config,state,core:await sharedRuntime(),close(){for(const[k,v]of Object.entries({KTEAM_MODEL_CONFIG_DIR:previous.config,XIAOK_DISABLE_GLOBAL_PLUGINS:previous.plugins}))if(v===undefined)delete process.env[k];else process.env[k]=v;rmSync(root,{recursive:true,force:true});}};
}
test('ordinary project inspection and document writing run through the production factory without involving the user',async()=>{
 const f=await fixture(),store=new TeamStore(f.state);let owner:any;
 try{
  execFileSync('git',['init','-q',f.cwd]);writeFileSync(join(f.cwd,'seed.md'),'seed');execFileSync('git',['-C',f.cwd,'add','seed.md']);execFileSync('git',['-C',f.cwd,'-c','user.name=Synthetic','-c','user.email=synthetic@example.test','commit','-qm','seed']);
  store.enqueue('synthetic-job','synthetic-room','synthetic-origin');const job=store.job('synthetic-job');let prompts=0;
  const h=await createHarness({scope:{root:f.state,botId:'synthetic-bot',roomId:'synthetic-room',bindingRevision:1,fingerprint:'synthetic',profileRevision:1},workspace:f.cwd,signal:AbortSignal.timeout(20000),assertCurrent:async()=>{},onPrompt:async()=>{prompts++;return false;},onTool:e=>{store.recordToolEvent(job,e);store.save(job);}});
  owner=await h.prepare!({getModelName:()=> 'fixture'},'fixture','Only actual results',[]);
  await owner.runOwned(async()=>{
   const result=await owner.registry.executeTool('bash',{command:'cd "'+f.cwd+'" && pwd -P && ls && echo "--- git ---" && git log -8 --date=short --pretty=\'%h %ad %s\' && git status -sb | head -30',workdir:f.root,timeout_ms:5000});assert.match(result,/project with spaces/);assert.match(result,/seed/);
   const body='DOCUMENT_BODY_PRIVATE_83\n'.repeat(2000);
   assert.match(await owner.registry.executeTool('write',{file_path:'assessment.md',content:body}),/已写入/);
   assert.match(await owner.registry.executeTool('edit',{file_path:'assessment.md',old_string:body,new_string:body+'updated'}),/已编辑/);
   assert.equal(readFileSync(join(f.cwd,'assessment.md'),'utf8'),body+'updated');assert.equal(prompts,0);
  });
  const persisted=JSON.stringify(store.job(job.id));assert.doesNotMatch(persisted,/DOCUMENT_BODY_PRIVATE_83|--- git ---/);assert.ok(job.toolTrace.length<=12);assert.ok(!job.toolTrace.some((e:any)=>e.result));assert.ok(job.toolTrace.some((e:any)=>e.name==='write'&&e.input?.includes('assessment.md')&&JSON.parse(e.input).characters>20000));
  const logs=readdirSync(join(f.state,'execution-logs')).map(n=>readFileSync(join(f.state,'execution-logs',n),'utf8')).join('');assert.match(logs,/git log/);assert.doesNotMatch(logs,/DOCUMENT_BODY_PRIVATE_83/);assert.match(logs,/characters/);
 }finally{await owner?.close();store.close();f.close();}
});
test('routine admission does not include writes disguised as inspection, sensitive paths, or documents escaping through a symlink',async()=>{
 const f=await fixture();try{
  for(const command of ['ls && rm note.md','git push origin main','git -c core.pager=sh log','git log --format=%s --output=proof','git log --date=short; touch proof','echo $(touch proof)','cat .env','cat .e*','sort -oresult input','sort --compress-program=sh','find . -exec sh {} ;','find . -fprint proof','uniq input output','cat '+join(f.state,'service.token')])assert.equal(routineReadCommand(f.core,{command,workdir:f.cwd},f.state),false,command);
  assert.equal(routineReadCommand(f.core,{command:'find src -maxdepth 2 -type d | sort && find src -name "*.ts" -o -name "*.tsx" | wc -l',workdir:f.cwd},f.state),true);
  const outside=join(f.root,'outside');mkdirSync(outside);symlinkSync(outside,join(f.cwd,'escape'));
  assert.equal(routineDocument('write',{file_path:join(f.cwd,'escape','new.md')},f.cwd),false);
  const unchanged={command:'cd "'+f.cwd+'" || touch proof',workdir:f.root};assert.deepEqual(projectCommand(unchanged),unchanged);
  writeFileSync(join(f.config,'settings.json'),JSON.stringify({permissions:{deny:['bash:*','write:*']}}));
  const h=await createHarness({workspace:f.cwd,signal:AbortSignal.timeout(5000),assertCurrent:async()=>{}});assert.equal(await h.registryOptions.permissionManager.check('bash',{command:'ls'}),'deny');assert.equal(await h.registryOptions.permissionManager.check('write',{file_path:'new.md',content:'draft'}),'deny');
 }finally{f.close();}
});
test('approval and existing history retain metadata instead of document bodies; debug output moves into bounded log files',async()=>{
 const f=await fixture();let store=new TeamStore(f.state),approvals=new ToolApprovals(store);
 try{
  const body='OLD_BODY_PRIVATE_47\n'.repeat(5000),waiting=approvals.ask({roomId:'r',botId:'b',jobId:'j',cwd:f.cwd},'write',{file_path:join(f.cwd,'assessment.md'),content:body},AbortSignal.timeout(5000),async()=>{});
  while(!approvals.list().length)await new Promise(r=>setTimeout(r,5));const pending=approvals.list()[0]!;assert.doesNotMatch(pending.display,/OLD_BODY_PRIVATE_47|content/);assert.match(pending.display,/assessment.md/);assert.equal(store.operation(pending.id).input,undefined);
  await approvals.decide({id:pending.id,expectedHash:pending.hash,decision:'deny'});assert.equal(await waiting,false);
  store.enqueue('legacy','r','origin');const job=store.job('legacy');job.toolTrace=Array.from({length:100},(_,i)=>({id:'old-'+i,name:i%2?'edit':'write',type:'tool_finished',state:'completed',input:JSON.stringify({file_path:'draft.md',content:body}),result:body+'\n已编辑: draft.md'}));store.save(job);
  store.saveOperation({id:'tool-approval:legacy',status:'cancelled',toolName:'write',input:{file_path:'draft.md',content:body},display:JSON.stringify({content:body}),hash:'kept-hash'},0);store.setState('compact-tool-history-v1',false);approvals.close();store.close();store=new TeamStore(f.state);approvals=new ToolApprovals(store);
  assert.ok(store.job('legacy').toolTrace.length<=12);assert.doesNotMatch(JSON.stringify(store.job('legacy')),/OLD_BODY_PRIVATE_47/);assert.equal(store.operation('tool-approval:legacy').hash,'kept-hash');assert.doesNotMatch(JSON.stringify(store.operation('tool-approval:legacy')),/OLD_BODY_PRIVATE_47/);
  for(let i=0;i<180;i++)store.recordToolEvent(job,{id:'large-'+i,name:'bash',type:'tool_finished',result:'x'.repeat(30000)});
  for(const name of readdirSync(join(f.state,'execution-logs')))assert.ok(readFileSync(join(f.state,'execution-logs',name)).byteLength<2*1024*1024+25000);
 }finally{approvals.close();store.close();f.close();}
});
