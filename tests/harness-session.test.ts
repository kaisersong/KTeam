import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,realpathSync,rmSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {createHarness} from '../src/runtime/harness.js';
import {sharedRuntime} from '../src/runtime/native.js';
import {KTeamError} from '../src/errors.js';

async function fixture(){
 process.env.KTEAM_RUNTIME_ENTRY=resolve('build/shared/kteam-runtime.mjs');
 const root=realpathSync(mkdtempSync('/tmp/kteam-platform-')),config=join(root,'config'),cwd=join(root,'project');mkdirSync(config);mkdirSync(cwd);
 const before={config:process.env.KTEAM_MODEL_CONFIG_DIR,plugins:process.env.KTEAM_DISABLE_GLOBAL_PLUGINS};process.env.KTEAM_MODEL_CONFIG_DIR=config;process.env.KTEAM_DISABLE_GLOBAL_PLUGINS='1';
 const core=await sharedRuntime();
 const adapter={getModelName:()=> 'fixture',getModelPolicy:()=>({contextLimit:200000,compactThreshold:0.85}),async*stream(){yield {type:'text',delta:'done'};yield {type:'done'};}};
 const scope={root:join(root,'host-data'),botId:'bot-a',roomId:'room-a',bindingRevision:1,fingerprint:'fp-a',profileRevision:1};
 const open=async(extra={})=>{const h=await createHarness({scope:{...scope,...extra},workspace:cwd,signal:AbortSignal.timeout(20000),assertCurrent:async()=>{},onPrompt:async()=>true});return h.prepare!(adapter,'fixture','仅使用真实结果。',[]);};
 return {root,config,cwd,core,scope,open,close(){for(const[k,v]of Object.entries({KTEAM_MODEL_CONFIG_DIR:before.config,KTEAM_DISABLE_GLOBAL_PLUGINS:before.plugins}))if(v===undefined)delete process.env[k];else process.env[k]=v;rmSync(root,{recursive:true,force:true});}};
}
test('production platform factory preserves complete tool history and project instructions across runs, with room/binding isolation',async()=>{
 const f=await fixture();let owner:any;try{
  writeFileSync(join(f.cwd,'AGENTS.md'),'PROJECT_GUIDANCE_58');writeFileSync(join(f.cwd,'proof.txt'),'READ_PROOF_49');
  owner=await f.open();assert.match(owner.system,/PROJECT_GUIDANCE_58/);
  const names=owner.registry.getToolDefinitions().map((t:any)=>t.name);
  for(const name of ['read','write','bash','subagent','spawn_agent','followup_task','notebook_read','notebook_write','lsp'])assert.ok(names.includes(name),name);
  assert.ok(!names.includes('team_create'));
  assert.match(await owner.registry.executeTool('read',{file_path:'proof.txt'}),/READ_PROOF_49/);
  await owner.registry.executeTool('notebook_write',{content:'PRIVATE_ROOM_MEMORY_33'});
  owner.session.appendUserText('PERSISTED_SESSION_21');owner.session.appendAssistantBlocks([{type:'text',text:'KEPT_TOOL_RESULT_12'}]);await owner.close();owner=undefined;
  owner=await f.open();assert.match(JSON.stringify(owner.session.getMessages()),/PERSISTED_SESSION_21/);assert.match(owner.system,/PRIVATE_ROOM_MEMORY_33/);await owner.close();owner=undefined;
  owner=await f.open({roomId:'room-b'});assert.doesNotMatch(owner.system,/PRIVATE_ROOM_MEMORY_33/);assert.doesNotMatch(JSON.stringify(owner.session.getMessages()),/PERSISTED_SESSION_21/);await owner.close();owner=undefined;
  owner=await f.open({bindingRevision:2});assert.equal(owner.session.getMessages().length,0);
  assert.equal(existsSync(join(f.cwd,'.kteam/state/teams.json')),false);assert.equal(existsSync(join(f.cwd,'.kteam')),false);
 }finally{await owner?.close();f.close();}
});

test('complete AgentRuntime turn checkpoints through the original SessionStore while process ownership is active',async()=>{
 const f=await fixture();let owner:any;try{
  owner=await f.open();const events:any[]=[];
  const adapter={getModelName:()=> 'fixture',getModelPolicy:()=>({contextLimit:200000,compactThreshold:0.85}),async*stream(){yield {type:'text',delta:'CHECKPOINT_TURN_86'};yield {type:'done'};}};
  const runtime=new f.core.AgentRuntime({adapter,registry:owner.registry,session:owner.session,systemPrompt:owner.system,checkpoint:owner.persist,controller:new f.core.AgentRunController(),maxIterations:2});
  await owner.runOwned(()=>runtime.run('VERIFY_TURN_63',(e:any)=>events.push(e),AbortSignal.timeout(6000)));
  assert.equal(events.some(e=>e.type==='run_failed'),false,events.filter(e=>e.type==='run_failed').map(e=>String(e.error?.stack)).join('\n'));assert.ok(events.some(e=>e.type==='run_completed'));
  await owner.close();owner=await f.open();assert.match(JSON.stringify(owner.session.getMessages()),/CHECKPOINT_TURN_86/);
 }finally{await owner?.close();f.close();}
});

test('revoked scope cannot launch a real plugin PreToolUse command before the tool execute guard',async()=>{
 const f=await fixture();let owner:any;try{
  const plugin=join(f.cwd,'.kteam/plugins/review');mkdirSync(plugin,{recursive:true});
  const marker=join(f.root,'must-not-start');
  writeFileSync(join(plugin,'plugin.json'),JSON.stringify({name:'review',version:'1.0.0',hooks:[{type:'command',events:['PreToolUse'],command:'printf synthetic > '+marker}]}));
  writeFileSync(join(f.cwd,'proof'),'read-only');let current=true;
  const h=await createHarness({scope:f.scope,workspace:f.cwd,signal:AbortSignal.timeout(5000),assertCurrent:async()=>{if(!current)throw Error('synthetic_revoked');},onPrompt:async()=>true});
  owner=await h.prepare!({getModelName:()=> 'fixture'},'fixture','proof',[]);current=false;
  const result=await owner.registry.executeTool('read',{file_path:'proof'});
  assert.match(result,/harness_scope_check_failed:scope_check_failed/);assert.equal(existsSync(marker),false);
 }finally{await owner?.close();f.close();}
});

test('hook admission preserves a safe cause and a failed check does not consume a once-only hook',async()=>{
 const f=await fixture();let owner:any;try{
  const plugin=join(f.cwd,'.kteam/plugins/review');mkdirSync(plugin,{recursive:true});
  const marker=join(f.root,'ran');
  writeFileSync(join(plugin,'plugin.json'),JSON.stringify({name:'review',version:'1.0.0',hooks:[{type:'command',once:true,events:['PreToolUse'],matcher:'read',command:'printf checked >> '+marker}]}));
  writeFileSync(join(f.cwd,'proof'),'read-only');let unavailable=false;
  const h=await createHarness({scope:f.scope,workspace:f.cwd,signal:AbortSignal.timeout(10000),assertCurrent:async()=>{if(unavailable)throw new KTeamError('broker_unavailable',503);},onPrompt:async()=>true});
  owner=await h.prepare!({getModelName:()=> 'fixture'},'fixture','proof',[]);unavailable=true;
  const failed=await owner.registry.executeTool('read',{file_path:'proof'});
  assert.match(failed,/harness_scope_check_failed:broker_unavailable/);assert.doesNotMatch(failed,/harness_scope_revoked/);assert.equal(existsSync(marker),false);
  unavailable=false;const results=await Promise.all([owner.registry.executeTool('read',{file_path:'proof'}),owner.registry.executeTool('read',{file_path:'proof'})]);for(const value of results)assert.match(value,/read-only/);assert.equal(readFileSync(marker,'utf8'),'checked');
 }finally{await owner?.close();f.close();}
});

test('unmatched plugin events do not perform extra remote scope checks',async()=>{
 const f=await fixture();let owner:any;try{
  const plugin=join(f.cwd,'.kteam/plugins/review');mkdirSync(plugin,{recursive:true});
  writeFileSync(join(plugin,'plugin.json'),JSON.stringify({name:'review',version:'1.0.0',hooks:[
   {events:['PreToolUse'],matcher:'write',command:'exit 2'},
   {events:['SessionEnd'],command:'exit 2'}
  ]}));
  writeFileSync(join(f.cwd,'proof'),'read-only');let checks=0;
  const h=await createHarness({scope:f.scope,workspace:f.cwd,signal:AbortSignal.timeout(10000),assertCurrent:async()=>{checks++;},onPrompt:async()=>true});
  owner=await h.prepare!({getModelName:()=> 'fixture'},'fixture','proof',[]);checks=0;
  assert.match(await owner.registry.executeTool('read',{file_path:'proof'}),/read-only/);
  assert.equal(checks,2,'only the bound tool pre/post guards, no unmatched hook guards');
 }finally{await owner?.close();f.close();}
});

test('the original Desktop PDF extractor is available through the guarded read tool',async()=>{
 const f=await fixture();let owner:any;try{
  const stream='BT /F1 18 Tf 30 100 Td (PDF_REAL_BODY_73) Tj ET';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>','<< /Length '+stream.length+' >>\nstream\n'+stream+'\nendstream'];
  let pdf='%PDF-1.4\n';const offsets=[0];for(const [i,body] of objects.entries()){offsets.push(Buffer.byteLength(pdf));pdf+=(i+1)+' 0 obj\n'+body+'\nendobj\n';}const xref=Buffer.byteLength(pdf);pdf+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF';
  writeFileSync(join(f.cwd,'proof.pdf'),pdf);owner=await f.open();assert.match(await owner.registry.executeTool('read',{file_path:'proof.pdf'}),/PDF_REAL_BODY_73/);
 }finally{await owner?.close();f.close();}
});

test('host-managed card and Skill tools cannot read or overwrite another private harness scope even after approval',async()=>{
 const f=await fixture();let owner:any;try{
  const foreign=join(f.scope.root,'another-bot');mkdirSync(foreign,{recursive:true});const skill=join(foreign,'secret.md');writeFileSync(skill,'---\nname: private-skill\ndescription: private source\n---\nFOREIGN_PRIVATE_BODY');
  owner=await f.open();const output=join(foreign,'card.a2ui.json');
  assert.match(await owner.registry.executeTool('render_ui',{title:'must fail',output_path:output,sections:[{kind:'text',content:'must not write'}]}),/harness_private_path_denied/);assert.equal(existsSync(output),false);
  assert.match(await owner.registry.executeTool('install_skill',{source:skill,scope:'global'}),/harness_private_path_denied/);
  assert.match(await owner.registry.executeTool('install_skill',{source:'  '+skill+'  ',scope:'global'}),/harness_private_path_denied/);const scopeKey=createHash('sha256').update(f.scope.botId+'\n'+f.scope.roomId).digest('hex');assert.equal(existsSync(join(f.scope.root,'harness-assets',scopeKey,'skills/private-skill.md')),false);
  assert.match(await owner.registry.executeTool('render_ui',{title:'must fail',output_path:'  '+output+'  ',sections:[{kind:'text',content:'must not write'}]}),/harness_private_path_denied/);assert.equal(existsSync(output),false);
  assert.doesNotMatch(await owner.registry.executeTool('read',{file_path:skill}),/FOREIGN_PRIVATE_BODY/);
 }finally{await owner?.close();f.close();}
});

test('real MCP stdio is supervised, records ownership before payload, and closes an EOF-ignoring provider',async()=>{
 const f=await fixture();let owner:any;const resources:any[]=[];try{
  writeFileSync(join(f.config,'settings.json'),JSON.stringify({mcpServers:{owned:{type:'stdio',command:process.execPath,args:[resolve('tests/fixtures/harness-mcp-sentinel.mjs'),join(f.root,'provider.pid')]}}}));
  const h=await createHarness({scope:f.scope,workspace:f.cwd,signal:AbortSignal.timeout(12000),assertCurrent:async()=>{},onPrompt:async()=>true,onProcess:r=>{resources.push(r);}});
  owner=await h.prepare!({getModelName:()=> 'fixture'},'fixture','proof',[]);
  assert.equal(existsSync(join(f.root,'provider.pid')),true);
  assert.match(await owner.registry.executeTool('mcp__owned__proof',{}),/MCP_REAL_PROCESS_92/);
  assert.ok(resources.some(r=>r.state==='preparing'&&r.pid));assert.ok(resources.some(r=>r.state==='running'&&r.birth));
  const pids=resources.filter(r=>r.state==='running').map(r=>r.pid);await owner.close();owner=undefined;
  for(const pid of pids)assert.throws(()=>process.kill(pid,0));
 }finally{await owner?.close();f.close();}
});

test('SIGKILL of a harness owner reaps its actual MCP provider through the IPC supervisor',async()=>{
 const {fork}=await import('node:child_process');const f=await fixture();let parent:any;try{
  writeFileSync(join(f.config,'settings.json'),JSON.stringify({mcpServers:{owned:{type:'stdio',command:process.execPath,args:[resolve('tests/fixtures/harness-mcp-sentinel.mjs'),join(f.root,'provider.pid')]}}}));
  parent=fork(resolve('tests/fixtures/harness-owner-crash.mjs'),[],{cwd:process.cwd(),silent:true,env:{...process.env,KTEAM_TEST_ROOT:f.root}});parent.stdout.resume();parent.stderr.resume();
  const ready:any=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('MCP owner startup timed out')),15000);parent.once('message',(m:any)=>{clearTimeout(timer);resolve(m);});parent.once('exit',()=>{clearTimeout(timer);reject(Error('MCP owner exited before ready'));});});
  const provider=Number((await import('node:fs')).readFileSync(join(f.root,'provider.pid'),'utf8'));assert.ok(provider);assert.ok(ready.records.some((r:any)=>r.state==='running'));
  const ended=new Promise(r=>parent.once('exit',r));parent.kill('SIGKILL');await ended;
  const alive=()=>{try{process.kill(provider,0);return true;}catch{return false;}};
  const until=Date.now()+6000;while(alive()&&Date.now()<until)await new Promise(r=>setTimeout(r,30));assert.equal(alive(),false);
 }finally{if(parent&&parent.exitCode===null&&parent.signalCode===null)parent.kill('SIGKILL');f.close();}
});

test('original Worktree allocate/release and recovery GC use owned Git and lsof processes',async()=>{
 const f=await fixture(),records:any[]=[];let platform:any;try{
  const git=(args:string[])=>execFileSync('git',args,{cwd:f.cwd,encoding:'utf8'});
  git(['init','-q']);git(['config','user.email','fixture@localhost']);git(['config','user.name','Fixture']);writeFileSync(join(f.cwd,'source.txt'),'fixture');git(['add','source.txt']);git(['commit','-qm','fixture']);
  const processOwner={cwd:f.cwd,signal:AbortSignal.timeout(20000),assertCurrent:async()=>{},record:(r:any)=>{records.push(r);}};
  await f.core.withHarnessProcessOwner(processOwner,async()=>{
   platform=await f.core.createPlatformRuntimeContext({cwd:f.cwd,builtinCommands:[],assertCurrent:processOwner.assertCurrent,stateRootDir:join(f.root,'platform-state'),teamService:{}});await platform.mcpReady;
   const first=await platform.worktreeManager.allocate({owner:'fixture',taskId:'task-release',branch:'fixture-release',cleanup:'delete'});assert.equal(existsSync(first.path),true);await platform.worktreeManager.release(first.path);assert.equal(existsSync(first.path),false);
   const second=await platform.worktreeManager.allocate({owner:'fixture',taskId:'task-gc',branch:'fixture-gc',cleanup:'delete'});
   const path=join(f.cwd,'.worktrees/.kteam-worktree-registry'),registry=JSON.parse(readFileSync(path,'utf8'));registry.leases.find((r:any)=>r.path===second.path).state='released';writeFileSync(path,JSON.stringify(registry));
   const result=await platform.worktreeManager.gc({dryRun:false});assert.ok(result.removed.includes('fixture-gc'),JSON.stringify(result));assert.equal(existsSync(second.path),false);
  });
  assert.ok(records.filter(r=>r.state==='running').length>=5);for(const r of records.filter(r=>r.state==='running'))assert.throws(()=>process.kill(r.pid,0));
 }finally{await platform?.dispose();f.close();}
});
