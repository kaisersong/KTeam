import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,statSync,rmSync,existsSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {inspectOperation} from '../src/protocol/operation-inspection.js';
import {snapshotDatabase} from '../src/runtime/database-snapshot.js';
import {unexecutedModelToolOutput} from '../src/protocol/model-tool-output.js';
import {TeamWorkspace} from '../src/service/team-workspace.js';
import {executionState} from '../src/service/execution-state.js';
import {TeamStore} from '../src/service/team-store.js';
import {TeamCoordinator} from '../src/service/coordination.js';
import {sharedRuntime,modelIdentity} from '../src/runtime/native.js';
import {commandAccess} from '../src/service/terminal-access.js';
import {realUpstreams} from './helpers/real-upstreams.js';

test('approval facts expose actual legacy paths and require separate inspection before destructive changes',()=>{
 const details=inspectOperation('bash',{command:'ls -la /old/env; rm -rf /old/env; cp -R /old/template /new/env; cd /old/project; npm run dev'},'/new/project');
 assert.equal(details.destructive,true);assert.equal(details.mixedInspection,true);
 assert.ok(details.facts.some(f=>f.kind==='delete'&&f.target==='/old/env'));
 assert.ok(details.facts.some(f=>f.kind==='copy'&&f.target==='/old/template'));
 assert.ok(details.facts.some(f=>f.kind==='overwrite'&&f.target==='/new/env'));
 assert.ok(details.facts.some(f=>f.reason.includes('切换')&&f.target==='/old/project'));
 assert.ok(details.facts.some(f=>f.kind==='process'));
 assert.equal(inspectOperation('bash',{command:'rm -rf ./env'},'/project').mixedInspection,false);
 const windows=inspectOperation('bash',{command:String.raw`dir C:\old\env & rmdir /s /q C:\old\env & cd /d C:\old\project`},String.raw`C:\new\project`);
 assert.equal(windows.mixedInspection,true);assert.ok(windows.facts.some(f=>f.kind==='delete'&&f.target===String.raw`C:\old\env`));assert.ok(windows.facts.some(f=>f.reason.includes('切换')&&f.target===String.raw`C:\old\project`));assert.ok(!windows.facts.some(f=>/\\[sq]$/i.test(f.target)));
 const relative=inspectOperation('write',{file_path:String.raw`..\report.txt`},String.raw`C:\new\project`);assert.equal(relative.facts[0]?.target,String.raw`C:\new\report.txt`);
});
test('raw provider control markup is rejected even after normal prose or with malformed calls',()=>{
 for(const value of ['done\n<｜｜DSML｜｜ invoke name="update_shared_context">','<||DSML|| calls>','<tool_call>bad'])assert.equal(unexecutedModelToolOutput(value),true);
 assert.equal(unexecutedModelToolOutput('请更新共享纪要。'),false);
});
test('consistent database snapshot during WAL writes is private, validated and never overwrites or switches writer',async()=>{
 const root=mkdtempSync(join(tmpdir(),'kteam-snapshot-')),source=join(root,'source.sqlite'),destination=join(root,'snapshot.sqlite'),db=new DatabaseSync(source);let timer:ReturnType<typeof setInterval>|undefined;
 try{
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE entries (id INTEGER PRIMARY KEY, value TEXT); BEGIN');for(let i=0;i<10000;i++)db.prepare('INSERT INTO entries(value) VALUES (?)').run('fictional-'+i);db.exec('COMMIT');
  let writes=0;timer=setInterval(()=>{db.prepare('INSERT INTO entries(value) VALUES (?)').run('live-'+writes++);},1);
  const manifest=await snapshotDatabase({source,destination},root,async()=>{},()=>{});clearInterval(timer);timer=undefined;
  assert.equal(manifest.integrity,'ok');assert.equal(manifest.writerSwitched,false);assert.equal(manifest.visibility,'private');
  const copy=new DatabaseSync(destination,{readOnly:true});try{const count=(copy.prepare('SELECT count(*) AS n FROM entries').get() as any).n;assert.ok(count>=10000);assert.ok(count<=10000+writes);assert.equal(manifest.tables[0].rows,count);}finally{copy.close();}
  if(process.platform!=='win32')assert.equal(statSync(destination).mode&0o777,0o600);
  const before=readFileSync(destination);await assert.rejects(snapshotDatabase({source,destination},root,async()=>{},()=>{}),/EEXIST/);assert.deepEqual(readFileSync(destination),before);
  const denied=join(root,'denied.sqlite');await assert.rejects(snapshotDatabase({source,destination:denied},root,async()=>{throw Error('denied');},()=>{}),/denied/);assert.equal(existsSync(denied),false);
  db.prepare('INSERT INTO entries(value) VALUES (?)').run('still-only-writer');assert.ok((db.prepare('SELECT count(*) AS n FROM entries').get() as any).n>manifest.tables[0].rows);
 }finally{if(timer)clearInterval(timer);db.close();rmSync(root,{recursive:true,force:true});}
});
test('team workspace synchronizes owner-held profiles, fences old approvals and exposes scoped current permissions',async()=>{
 process.env.KTEAM_RUNTIME_ENTRY=resolve('build/shared/kteam-runtime.mjs');const f=await realUpstreams(),host=join(f.root,'host'),workspace=join(f.root,'project'),configRoot=join(f.root,'config'),oldConfig=process.env.KTEAM_MODEL_CONFIG_DIR;for(const d of [host,workspace,configRoot])mkdirSync(d);process.env.KTEAM_MODEL_CONFIG_DIR=configRoot;
 const store=new TeamStore(host);
 try{
  const core=await sharedRuntime(),config=await core.loadConfig();config.providers.openai={protocol:'openai_legacy',apiKey:'fixture-key',baseUrl:'http://127.0.0.1:1/v1'};config.models.fixture={provider:'openai',model:'fixture'};config.defaultModelId='fixture';writeFileSync(join(configRoot,'config.json'),JSON.stringify(config));
  const coordinator=new TeamCoordinator(f.upstream,store,1,{catalog:async()=>({defaultModelId:'fixture'}),identity:modelIdentity}),a=await coordinator.createMember({name:'开发',modelId:'fixture',requestId:'feedback-a'},{requestSource:'user'}),b=await coordinator.createMember({name:'负责人',modelId:'fixture',requestId:'feedback-b'},{requestSource:'user'}),group=await coordinator.createGroup({title:'反馈验证',memberAgentIds:[a.bot.id,b.bot.id],requestId:'feedback-group'},{requestSource:'user'}),roomId=group.room.roomId;
  const service=new TeamWorkspace(f.upstream,store),old=store.settings(roomId)!.revision;
  store.saveOperation({id:'tool-approval:old',roomId,botId:a.bot.id,status:'pending',expiresAt:Date.now()+60000},0);
  const saved=await service.save(roomId,{path:workspace,expectedRevision:0});assert.equal(saved.failures.length,0);assert.ok(saved.members.every((m:any)=>m.synced&&m.workspace===workspace));assert.equal(store.settings(roomId)!.revision,old+1);assert.equal(store.operation('tool-approval:old').reason,'workspace_changed');
  await assert.rejects(service.save(roomId,{path:workspace,expectedRevision:0}),/team_workspace_changed/);
  await assert.rejects(service.view(a.roomId),/room_actor_forbidden/);
  const current=await executionState(f.upstream,store,a.bot.id,roomId);assert.equal(current.approvals.length,0);assert.ok(current.members.every(m=>m.workspace===workspace));assert.equal(current.recent[0]!.reason,'workspace_changed');
  assert.equal(commandAccess(core,'rm -rf ./env',workspace),undefined);assert.equal(commandAccess(core,'git reset --hard',workspace),undefined);
 }finally{store.close();if(oldConfig===undefined)delete process.env.KTEAM_MODEL_CONFIG_DIR;else process.env.KTEAM_MODEL_CONFIG_DIR=oldConfig;await f.close();}
});

test('configuration evidence removes nested credential fields, preserves original bytes and does not overwrite evidence',async()=>{
 const {redactEvidence,exportEvidence}=await import('../src/runtime/evidence-redaction.js'),{realpathSync}=await import('node:fs'),root=realpathSync(mkdtempSync(join(tmpdir(),'kteam-evidence-'))),source=join(root,'config.json'),destination=join(root,'evidence.json');
 try{const original=JSON.stringify({providers:{demo:{apiKey:'fictional-secret-value',password:'not-a-real-password',baseUrl:'https://example.invalid'}},nested:[{access_token:'fictional-token'}]});writeFileSync(source,original,{mode:0o600});const value=redactEvidence(original,text=>({text}));assert.ok(!value.includes('fictional-secret-value'));assert.ok(!value.includes('not-a-real-password'));assert.ok(!value.includes('fictional-token'));assert.ok(value.includes('example.invalid'));
 await exportEvidence({source,destination},root,async()=>{},()=>{},text=>({text}));assert.equal(readFileSync(source,'utf8'),original);assert.equal(readFileSync(destination,'utf8'),value);await assert.rejects(exportEvidence({source,destination},root,async()=>{},()=>{},text=>({text})),/EEXIST/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
