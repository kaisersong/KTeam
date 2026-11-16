import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join,resolve,delimiter} from 'node:path';
import {tmpdir} from 'node:os';
import {privateTempDir} from './helpers/private-temp.js';
for(const mode of ['once-drop','permanent-drop','invalid-ticket','existing-invalid','existing-valid','rejected'])test('notarization ticket '+mode+' retains the signed artifact validation gate',{skip:process.platform==='win32'},()=>{
 const root=privateTempDir(join(tmpdir(),'kteam-notary-retry-')),bin=join(root,'bin'),count=join(root,'staple-count'),validations=join(root,'validate-count');mkdirSync(bin);
 const executable=(name:string,text:string)=>writeFileSync(join(bin,name),'#!/bin/bash\nset -eu\n'+text,{mode:0o700});
 executable('sleep','exit 0\n');
 executable('xcrun',`case "$1 $2" in
 'stapler staple') n=0; test ! -e "$FIXTURE_COUNT" || n=$(cat "$FIXTURE_COUNT"); n=$((n+1)); echo "$n" > "$FIXTURE_COUNT"; if { [ "$n" -eq 1 ] && [ "$FIXTURE_MODE" != existing-invalid ] && [ "$FIXTURE_MODE" != existing-valid ]; } || [ "$FIXTURE_MODE" = permanent-drop ] || { [ "$FIXTURE_MODE" = once-drop ] && [ "$n" -eq 2 ]; }; then exit 68; fi;;
 'stapler validate') n=0; test ! -e "$FIXTURE_VALIDATIONS" || n=$(cat "$FIXTURE_VALIDATIONS"); echo "$((n+1))" > "$FIXTURE_VALIDATIONS"; if { [ "$FIXTURE_MODE" = invalid-ticket ] || [ "$FIXTURE_MODE" = existing-invalid ]; }; then exit 65; fi;;
 'notarytool submit') echo '{"id":"fixture-notary-id"}';;
 'notarytool info') if [ "$FIXTURE_MODE" = rejected ]; then echo '{"status":"Rejected"}'; else echo '{"status":"Accepted"}'; fi;;
 'notarytool log') echo '{"issues":[]}';;
 *) exit 97;;
esac\n`);
 try{
  const target=join(root,'KTeam.dmg'),key=join(root,'fixture.p8');writeFileSync(target,'synthetic artifact');writeFileSync(key,'synthetic key');
  const run=spawnSync('/bin/bash',[resolve('scripts/notarize-macos.sh'),target],{encoding:'utf8',timeout:10000,env:{...process.env,PATH:bin+delimiter+process.env.PATH,APPLE_API_KEY:key,APPLE_API_KEY_ID:'fixture',APPLE_API_ISSUER:'fixture',RUNNER_TEMP:root,NOTARY_ARCHIVE_KEY:'fixture-source',NOTARY_REUSE_IN_PROGRESS:'false',NOTARY_TIMEOUT_SECONDS:'10',NOTARY_POLL_INTERVAL_SECONDS:'1',FIXTURE_COUNT:count,FIXTURE_VALIDATIONS:validations,FIXTURE_MODE:mode}});
  assert.equal(run.error,undefined);assert.equal(run.status,['once-drop','existing-valid'].includes(mode)?0:1,run.stdout+'\n'+run.stderr);assert.equal(readFileSync(target,'utf8'),'synthetic artifact');
  const attempts=Number(readFileSync(count,'utf8'));assert.equal(attempts,mode==='once-drop'?3:['rejected','existing-valid'].includes(mode)?1:6);
  if(mode==='once-drop')assert.equal(Number(readFileSync(validations,'utf8')),1);if(mode==='invalid-ticket')assert.equal(Number(readFileSync(validations,'utf8')),5);if(mode==='existing-invalid')assert.equal(Number(readFileSync(validations,'utf8')),6);if(mode==='existing-valid')assert.equal(Number(readFileSync(validations,'utf8')),1);
 }finally{rmSync(root,{recursive:true,force:true});}
});
