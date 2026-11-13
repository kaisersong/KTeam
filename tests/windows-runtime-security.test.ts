import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,copyFileSync,cpSync,readFileSync,writeFileSync,rmSync,realpathSync,openSync,closeSync,linkSync,unlinkSync,symlinkSync} from 'node:fs';
import {execFileSync,spawn} from 'node:child_process';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {privateTempDir,assertPrivateMode} from './helpers/private-temp.js';
import {defaultDeps,processBirth,processGroup} from '../src/runtime/platform-process.js';
import {windowsObservationCommand} from '../src/runtime/windows-process-observer.js';

test('Windows original runtime verifies its bundled diagnostic and writes private credentials without invoking keychain',{skip:process.platform!=='win32'},async()=>{
 const artifacts=resolve('.artifacts');mkdirSync(artifacts,{recursive:true});
 const root=privateTempDir(join(realpathSync(artifacts),'windows-runtime-'));
 const previousEntry=process.env.KTEAM_RUNTIME_ENTRY;
 try{
  const runtime=join(root,'kteam-runtime.mjs'),native=join(root,'native');copyFileSync(resolve('build/shared/kteam-runtime.mjs'),runtime);cpSync(resolve('build/shared/native'),native,{recursive:true});
  process.env.KTEAM_RUNTIME_ENTRY=runtime;
  const legacy=defaultDeps();legacy.nativeObservation=false;assert.equal(processBirth(process.pid),processBirth(process.pid,legacy));assert.ok(processGroup(process.pid).some(member=>member.pid===process.pid));
  const observerManifest=join(native,'win32-'+process.arch,'windows-process-observer.json'),observerOriginal=readFileSync(observerManifest),observerChanged=JSON.parse(observerOriginal.toString());observerChanged.sha256='0'.repeat(64);writeFileSync(observerManifest,JSON.stringify(observerChanged));assert.throws(()=>processBirth(process.pid),/windows_process_observation_unavailable/);assert.throws(()=>processGroup(process.pid),/windows_process_observation_unavailable/);writeFileSync(observerManifest,observerOriginal);
  const usageRoot=join(root,'usage'),outside=join(root,'outside');mkdirSync(usageRoot);mkdirSync(outside);const proof=join(usageRoot,'proof.txt');writeFileSync(proof,'synthetic metadata proof');
  const usage=()=>{const command=windowsObservationCommand(['usage',usageRoot]);assert.ok(command);const value=execFileSync(command.file,[...command.args],{env:{},stdio:['ignore','pipe','pipe'],encoding:'utf8',windowsHide:true,timeout:5000}).trim();command.verify();return value;};
  assert.equal(usage(),'free');const opened=openSync(proof,'r');try{assert.equal(usage(),'used');}finally{closeSync(opened);}assert.equal(usage(),'free');
  linkSync(proof,join(outside,'alias'));try{assert.equal(usage(),'unknown');}finally{unlinkSync(join(outside,'alias'));}
  symlinkSync(outside,join(usageRoot,'junction'),'junction');try{assert.equal(usage(),'unknown');}finally{rmSync(join(usageRoot,'junction'));}
  const cwdOwner=spawn(process.execPath,['-e',"process.stdout.write('ready');setInterval(()=>{},1000)"],{cwd:usageRoot,stdio:['ignore','pipe','ignore'],windowsHide:true});
  try{await new Promise<void>((yes,no)=>{const timer=setTimeout(()=>no(Error('cwd_observer_start_timeout')),5000);cwdOwner.stdout.once('data',()=>{clearTimeout(timer);yes();});cwdOwner.once('error',error=>{clearTimeout(timer);no(error);});});assert.equal(usage(),'used');}finally{const closed=new Promise<void>(yes=>cwdOwner.once('close',()=>yes()));cwdOwner.kill('SIGKILL');await closed;}
  assert.equal(usage(),'free');
  const core=await import(pathToFileURL(runtime).href),credentialRoot=join(root,'credentials-root');mkdirSync(credentialRoot,{mode:0o700});
  let keychainCalls=0;const forbidden={get(){keychainCalls++;throw Error('keychain_must_not_be_used');},put(){keychainCalls++;throw Error('keychain_must_not_be_used');}};
  const id=randomUUID(),vault=new core.CredentialStore(credentialRoot,forbidden);vault.put(id,'synthetic-private-credential');assert.equal(vault.get(id),'synthetic-private-credential');assert.equal(new core.CredentialStore(credentialRoot,forbidden).get(id),'synthetic-private-credential');assert.equal(keychainCalls,0);
  assertPrivateMode(join(credentialRoot,'credentials'),0o700);assertPrivateMode(join(credentialRoot,'credentials/store.json'),0o600);
  const aclManifest=join(native,'win32-'+process.arch,'windows-credential-acl.json'),aclOriginal=readFileSync(aclManifest),aclChanged=JSON.parse(aclOriginal.toString());aclChanged.sha256='0'.repeat(64);writeFileSync(aclManifest,JSON.stringify(aclChanged));const refusedId=randomUUID();assert.throws(()=>vault.put(refusedId,'must-not-be-written'),/credential_path_unsafe/);writeFileSync(aclManifest,aclOriginal);assert.equal(vault.get(refusedId),null);assert.equal(vault.get(id),'synthetic-private-credential');

  const session=new core.AgentSessionState();session.restoreSnapshot({...session.exportSnapshot(),sessionId:'windows-source-proof',cwd:root});session.appendUserText('synthetic source observation');
  const store=new core.FileSessionStore(join(root,'sessions'));await store.save(session.exportSnapshot());assert.equal((await store.load('windows-source-proof')).sessionId,'windows-source-proof');
  const manifest=join(native,'win32-'+process.arch,'windows-installation-absence.json'),original=readFileSync(manifest),value=JSON.parse(original.toString());value.sha256='0'.repeat(64);writeFileSync(manifest,JSON.stringify(value));
  await assert.rejects(async()=>new core.FileSessionStore(join(root,'refused-sessions')).save(session.exportSnapshot()),/ordinary_source_route/);
  writeFileSync(manifest,original);await new core.FileSessionStore(join(root,'restored-sessions')).save(session.exportSnapshot());
 }finally{if(previousEntry===undefined)delete process.env.KTEAM_RUNTIME_ENTRY;else process.env.KTEAM_RUNTIME_ENTRY=previousEntry;rmSync(root,{recursive:true,force:true});}
});
