import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,realpathSync,readFileSync,renameSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {privateTempDir} from './helpers/private-temp.js';
import {TeamStore} from '../src/service/team-store.js';
import {codexWriteGrant,currentCodexWriteRoot,saveCodexWriteGrant} from '../src/service/codex-write-grants.js';
import {codexConnection,codexPolicy,codexWriteDenied} from '../src/runtime/codex-task-policy.js';

test('directory grants follow the selected member and directory identity, with revision fencing after revoke',()=>{
 const fixture=realpathSync(privateTempDir(join(tmpdir(),'kteam-codex-grants-'))), root=join(fixture,'data'),projects=join(fixture,'projects');
 mkdirSync(root);mkdirSync(projects);
 const store=new TeamStore(root);
 try {
  for(const botId of ['custom-name','other-member'])store.bind({botId,modelId:'local-agent:codex',model:'Codex',kind:'local-native',revision:7,fingerprint:'fixture'});
  const selected={botId:'custom-name',bindingRevision:7,allowWrite:true,grantRevision:0,path:null};
  assert.throws(()=>currentCodexWriteRoot(store,selected),/codex_write_grant_required/);
  assert.throws(()=>saveCodexWriteGrant(store,{botId:selected.botId,path:fixture,expectedRevision:0}),/codex_write_directory_invalid/);
  const grant=saveCodexWriteGrant(store,{botId:selected.botId,path:projects,expectedRevision:0});
  const task={...selected,grantRevision:grant.revision,path:grant.path};
  assert.equal(currentCodexWriteRoot(store,task),projects);
  assert.equal(codexWriteGrant(store,'other-member').path,null);
  assert.throws(()=>currentCodexWriteRoot(store,{...task,botId:'other-member'}),/codex_write_grant_changed/);
  saveCodexWriteGrant(store,{botId:selected.botId,path:null,expectedRevision:grant.revision});
  assert.throws(()=>currentCodexWriteRoot(store,task),/codex_write_grant_changed/);
  const replacement=saveCodexWriteGrant(store,{botId:selected.botId,path:projects,expectedRevision:grant.revision+1});
  renameSync(projects,projects+'-previous');mkdirSync(projects);
  assert.throws(()=>currentCodexWriteRoot(store,{...task,grantRevision:replacement.revision}),/codex_write_grant_changed/);
 }finally{store.close();rmSync(fixture,{recursive:true,force:true});}
});

test('Codex passes exact WebSocket booleans and rejects invalid types and unknown provider keys',()=>{
 const root=privateTempDir(join(tmpdir(),'kteam-codex-provider-'));
 const file=join(root,'config.toml');
 const provider='model_provider = "example"\n[model_providers.example]\nname = "Example"\n';
 const args=(field='')=>{
  writeFileSync(file,provider+field);
  return codexConnection({CODEX_HOME:root});
 };
 try{
  assert.equal(args().some(arg=>arg.includes('supports_websockets')),false);
  for(const value of [true,false]){
   const actual=args('supports_websockets = '+value+'\n');
   assert.equal(actual[actual.indexOf('model_providers.example.supports_websockets='+value)-1],'-c');
  }
  for(const value of ['"false"','0','[false]']){
   assert.throws(()=>args('supports_websockets = '+value+'\n'),/native_codex_provider_unsupported/);
  }
  assert.throws(()=>args('unsupported = false\n'),/native_codex_provider_unsupported/);
 }finally{rmSync(root,{recursive:true,force:true});}
});

const realCodex=process.env.KTEAM_REAL_CODEX_GRANT_TEST;
test('the installed Codex sandbox writes existing and future projects and denies sibling, temp and symlink writes',{skip:process.platform!=='darwin'||!realCodex},()=>{
 const fixture=realpathSync(privateTempDir(join(homedir(),'.kteam-codex-sandbox-'))), temp=realpathSync(privateTempDir(join(tmpdir(),'kteam-codex-outside-')));
 try {
  const projects=join(fixture,'projects'),existing=join(projects,'existing'),external=join(fixture,'sentinel'),externalTemp=join(temp,'sentinel');
  mkdirSync(existing,{recursive:true});writeFileSync(external,'external');writeFileSync(externalTemp,'temp');
  symlinkSync(external,join(projects,'outside-link'));symlinkSync(externalTemp,join(projects,'temp-link'));
  const run=(writeRoot:string|undefined,command:string)=>spawnSync(realCodex!,['sandbox','-P','kteam-scoped','-C',existing,...codexPolicy(existing,writeRoot),'/bin/sh','-c',command,'sh',external,externalTemp],{encoding:'utf8',timeout:15000});
  const allowed=run(projects,`set -eu
   printf original > marker
   mkdir ../new-project
   printf future > ../new-project/marker
   for target in ../outside-link ../temp-link "$1" "$2"; do
    if (printf changed > "$target") 2>/dev/null; then exit 18; fi
   done`);
  assert.equal(allowed.status,0,allowed.stderr);
  assert.equal(readFileSync(join(existing,'marker'),'utf8'),'original');
  assert.equal(readFileSync(join(projects,'new-project','marker'),'utf8'),'future');
  const readonly=run(undefined,'test "$(cat marker)" = original && if (printf changed > readonly) 2>/dev/null; then exit 19; fi');
  assert.equal(readonly.status,0,readonly.stderr);
  assert.equal(existsSync(join(existing,'readonly')),false);
  assert.equal(readFileSync(external,'utf8'),'external');
  assert.equal(readFileSync(externalTemp,'utf8'),'temp');
 }finally{rmSync(fixture,{recursive:true,force:true});rmSync(temp,{recursive:true,force:true});}
});

test('recognizes native file denials from a failed command or Codex’s actual error report',()=>{
 assert.equal(codexWriteDenied([{type:'command_execution',exit_code:1,aggregated_output:'zsh: operation not permitted: fixture'}]),true);
 assert.equal(codexWriteDenied([], '`exec_command` returned exit status `1`. The shell reported `zsh:1: operation not permitted: fixture-link`.'),true);
 assert.equal(codexWriteDenied([{type:'command_execution',exit_code:0,aggregated_output:'permission denied'}],'已读取文件'),false);
});
