import {test} from 'node:test';import assert from 'node:assert/strict';import {mkdirSync,writeFileSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';import {execFileSync} from 'node:child_process';import {createPackage} from '@electron/asar';import {privateTempDir} from './helpers/private-temp.js';
const {assertBuildIdentity,readPackagedIdentity,sourceGitIdentity,verifyAncestry}=await import(new URL('../../scripts/build-identity.mjs',import.meta.url).href);
const info={version:'0.9.1',revision:'a'.repeat(40),lockfileSha256:'b'.repeat(64),dirty:false,official:true};
test('release identity rejects a changed revision, dependency fingerprint, dirty tree and unofficial publication',()=>{assert.equal(assertBuildIdentity(info,info),info);for(const change of [{revision:'c'.repeat(40)},{dirty:true},{lockfileSha256:'c'.repeat(64)},{official:false}])assert.throws(()=>assertBuildIdentity({...info,...change},info));});
test('actual ASAR and external build copies must have identical bytes before either identity is accepted',async()=>{
 const root=privateTempDir(join(tmpdir(),'kteam-build-proof-'));try{mkdirSync(join(root,'source','build'),{recursive:true});mkdirSync(join(root,'resources'));const bytes=JSON.stringify(info);writeFileSync(join(root,'source','build','build-info.json'),bytes);writeFileSync(join(root,'resources','build-info.json'),bytes);await createPackage(join(root,'source'),join(root,'resources','app.asar'));assert.equal(readPackagedIdentity(join(root,'resources'),info).revision,info.revision);writeFileSync(join(root,'resources','build-info.json'),bytes+'\n');assert.throws(()=>readPackagedIdentity(join(root,'resources'),info),/copies_mismatch/);}finally{rmSync(root,{recursive:true,force:true});}
});
test('source identity stays inside a shallow project and rejects a parent repository, a dirty tree, and handwritten Git environment',()=>{
  const root=privateTempDir(join(tmpdir(),'kteam-source-identity-'));
  const git=(cwd:string,args:string[])=>execFileSync('git',['-C',cwd,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid',...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const parent=join(root,'parent'),seed=join(root,'seed'),project=join(parent,'project'),loose=join(parent,'loose');
  try{
    mkdirSync(parent);
    git(parent,['init']);writeFileSync(join(parent,'parent.txt'),'parent\n');git(parent,['add','parent.txt']);git(parent,['commit','-m','parent']);
    const parentRevision=git(parent,['rev-parse','HEAD']);
    mkdirSync(seed);git(seed,['init']);writeFileSync(join(seed,'tracked.txt'),'one\n');git(seed,['add','tracked.txt']);git(seed,['commit','-m','one']);writeFileSync(join(seed,'tracked.txt'),'two\n');git(seed,['commit','-am','two']);
    execFileSync('git',['clone','--depth','1',seed,project],{stdio:['ignore','pipe','pipe']});
    const revision=git(project,['rev-parse','HEAD']);
    assert.notEqual(revision,parentRevision);
    const previousDir=process.env.GIT_DIR,previousSha=process.env.RELEASE_SHA;
    process.env.GIT_DIR=join(parent,'.git');process.env.RELEASE_SHA=parentRevision;
    try{assert.deepEqual(sourceGitIdentity(project),{revision,dirty:false});}
    finally{if(previousDir===undefined)delete process.env.GIT_DIR;else process.env.GIT_DIR=previousDir;if(previousSha===undefined)delete process.env.RELEASE_SHA;else process.env.RELEASE_SHA=previousSha;}
    assert.throws(()=>verifyAncestry(project,revision,undefined,[parentRevision]),(error:NodeJS.ErrnoException)=>error.code==='release_required_commit_absent');
    mkdirSync(loose);writeFileSync(join(loose,'package.json'),'{}\n');
    assert.throws(()=>sourceGitIdentity(loose),(error:NodeJS.ErrnoException)=>error.code==='release_source_git_unscoped');
    writeFileSync(join(project,'tracked.txt'),'changed\n');
    assert.throws(()=>sourceGitIdentity(project),(error:NodeJS.ErrnoException)=>error.code==='release_source_dirty');
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('release tag comparison peels annotated tags to commits and checks required fixes against the actual Git graph',()=>{
 const root=privateTempDir(join(tmpdir(),'kteam-tag-proof-'));const git=(args:string[])=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();try{git(['init']);writeFileSync(join(root,'fixture'),'one');git(['add','fixture']);git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','fixture']);const commit=git(['rev-parse','HEAD']);git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','tag','-a','v0.9.1','-m','fixture']);assert.notEqual(git(['rev-parse','v0.9.1']),commit);verifyAncestry(root,commit,'v0.9.1',[commit]);assert.throws(()=>verifyAncestry(root,'f'.repeat(40),'v0.9.1',[commit]));assert.throws(()=>verifyAncestry(root,commit,'v0.9.1',['f'.repeat(40)]));}finally{rmSync(root,{recursive:true,force:true});}
});

test('prerelease tags are accepted by ancestry checks and invalid tag format is rejected',()=>{
 const root=privateTempDir(join(tmpdir(),'kteam-prerelease-tag-'));const git=(args:string[])=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();try{git(['init']);writeFileSync(join(root,'fixture'),'one');git(['add','fixture']);git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','fixture']);const commit=git(['rev-parse','HEAD']);git(['tag','v0.10.5-rc.1']);verifyAncestry(root,commit,'v0.10.5-rc.1',[commit]);assert.throws(()=>verifyAncestry(root,commit,'not-a-version',[commit]),(error:NodeJS.ErrnoException)=>error.code==='release_identity_input_invalid');}finally{rmSync(root,{recursive:true,force:true});}
});
