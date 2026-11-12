import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,copyFileSync,cpSync,readFileSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {privateTempDir,assertPrivateMode} from './helpers/private-temp.js';

test('Windows original runtime verifies its bundled diagnostic and writes private credentials without invoking keychain',{skip:process.platform!=='win32'},async()=>{
 const artifacts=resolve('.artifacts');mkdirSync(artifacts,{recursive:true});
 const root=privateTempDir(join(realpathSync(artifacts),'windows-runtime-'));
 try{
  const runtime=join(root,'kteam-runtime.mjs'),native=join(root,'native');copyFileSync(resolve('build/shared/kteam-runtime.mjs'),runtime);cpSync(resolve('build/shared/native'),native,{recursive:true});
  const core=await import(pathToFileURL(runtime).href),credentialRoot=join(root,'credentials-root');mkdirSync(credentialRoot,{mode:0o700});
  let keychainCalls=0;const forbidden={get(){keychainCalls++;throw Error('keychain_must_not_be_used');},put(){keychainCalls++;throw Error('keychain_must_not_be_used');}};
  const id=randomUUID(),vault=new core.CredentialStore(credentialRoot,forbidden);vault.put(id,'synthetic-private-credential');assert.equal(vault.get(id),'synthetic-private-credential');assert.equal(new core.CredentialStore(credentialRoot,forbidden).get(id),'synthetic-private-credential');assert.equal(keychainCalls,0);
  assertPrivateMode(join(credentialRoot,'credentials'),0o700);assertPrivateMode(join(credentialRoot,'credentials/store.json'),0o600);
  const session=new core.AgentSessionState();session.restoreSnapshot({...session.exportSnapshot(),sessionId:'windows-source-proof',cwd:root});session.appendUserText('synthetic source observation');
  const store=new core.FileSessionStore(join(root,'sessions'));await store.save(session.exportSnapshot());assert.equal((await store.load('windows-source-proof')).sessionId,'windows-source-proof');
  const manifest=join(native,'win32-'+process.arch,'windows-installation-absence.json'),original=readFileSync(manifest),value=JSON.parse(original.toString());value.sha256='0'.repeat(64);writeFileSync(manifest,JSON.stringify(value));
  await assert.rejects(async()=>new core.FileSessionStore(join(root,'refused-sessions')).save(session.exportSnapshot()),/ordinary_source_route/);
  writeFileSync(manifest,original);await new core.FileSessionStore(join(root,'restored-sessions')).save(session.exportSnapshot());
 }finally{rmSync(root,{recursive:true,force:true});}
});
