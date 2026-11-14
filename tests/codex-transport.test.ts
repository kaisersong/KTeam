import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,rmSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {privateTempDir as mkdtempSync} from './helpers/private-temp.js';
import {fileURLToPath} from 'node:url';
import {SessionProbe,resolveLaunch} from '../src/runtime/codex-transport.js';
const fake=fileURLToPath(new URL('../../tests/fixtures/codex-transport-fake.mjs',import.meta.url));
test('native Codex transport pins named profile on thread/turn/probe and declines permission expansion',async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'kteam-codex-transport-'))),log=join(root,'requests.json');
 const probe=new SessionProbe({executable:fake,prefixArgs:[log],cwd:root,permissions:'kteam-fixture',runtimeWorkspaceRoots:[root],environment:{PATH:process.env.PATH},timeoutMs:2000});
 try{
  await probe.connect();const bound=await probe.create();assert.equal(bound.activePermissionProfile.id,'kteam-fixture');
  const {turnId}=await probe.start('nonce');await probe.waitFor('turn/completed',e=>e.params.turn.id===turnId);
  await probe.executeProbe({command:['/bin/echo','probe'],processId:'test',permissionProfile:'evil'} as any);await probe.stopProbe('test');
  const observed=JSON.parse(readFileSync(log,'utf8'));
  for(const method of ['thread/start','turn/start']){const request=observed.requests.find((r:any)=>r.method===method);assert.equal(request.params.permissions,'kteam-fixture');assert.equal(Object.hasOwn(request.params,'sandbox'),false);}
  const thread=observed.requests.find((r:any)=>r.method==='thread/start');assert.equal(thread.params.approvalPolicy,'never');assert.deepEqual(thread.params.runtimeWorkspaceRoots,[root]);
  assert.equal(thread.params.allowProviderModelFallback,false);assert.deepEqual(thread.params.environments,[]);assert.deepEqual(thread.params.selectedCapabilityRoots,[]);
  assert.equal(observed.requests.find((r:any)=>r.method==='command/exec').params.permissionProfile,'kteam-fixture');
  const approval=observed.requests.find((r:any)=>r.id===999&&r.result);assert.deepEqual(approval.result,{permissions:{},scope:'turn'});assert.equal(observed.leaked,false);
 }finally{await probe.close();assert.equal(probe.exited,true);rmSync(root,{recursive:true,force:true});}
});
test('transport keeps the Windows shim refusal and uses the actual Node executable for JS entries',()=>{
 assert.throws(()=>resolveLaunch('agent.cmd',[],'win32'),/real JS\/executable/);
 assert.equal(resolveLaunch('agent.cjs',[],'win32').command,process.execPath);
});
