import {privateTempDir as mkdtempSync} from './helpers/private-temp.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,rmSync,writeFileSync,lstatSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

test('pinned archive extraction keeps exact bytes in spaced Unicode paths on the current platform',async()=>{
 const root=mkdtempSync(join(tmpdir(),'kteam archive 中文 '));
 try{
  const source=join(root,'source'),target=join(root,'target with spaces');mkdirSync(source);mkdirSync(target);
  const bytes=Buffer.from('verified archive\r\n中文\n\u0000tail');writeFileSync(join(source,'proof.bin'),bytes);
  execFileSync('git',['init','--quiet',source]);execFileSync('git',['-C',source,'add','--','proof.bin']);
  execFileSync('git',['-C',source,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','--quiet','-m','fixture']);
  const archive=execFileSync('git',['-C',source,'archive','HEAD']);
  const {extractPinnedArchive}=await import(new URL('../../scripts/pinned-archive.mjs',import.meta.url).href);
  extractPinnedArchive(archive,target);
  assert.deepEqual(readFileSync(join(target,'proof.bin')),bytes);
  assert.equal(createHash('sha256').update(readFileSync(join(target,'proof.bin'))).digest('hex'),createHash('sha256').update(bytes).digest('hex'));
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('Windows archive materialization preserves pinned file aliases without symlink privileges and rejects escapes',async()=>{
 const root=mkdtempSync(join(tmpdir(),'kteam archive aliases 中文 '));
 try{
  const source=join(root,'source'),target=join(root,'target');mkdirSync(source);mkdirSync(target);mkdirSync(join(source,'skills'));
  const bytes=Buffer.from('# 原始技能\r\n\u0000exact bytes');writeFileSync(join(source,'skills','SKILL.md'),bytes);
  const git=(args:string[],input?:string)=>execFileSync('git',['-C',source,...args],{encoding:'utf8',...(input!==undefined?{input}:{} )});
  git(['init','--quiet']);git(['add','.']);
  const link=(name:string,to:string)=>{const blob=git(['hash-object','-w','--stdin'],to).trim();git(['update-index','--add','--cacheinfo','120000,'+blob+','+name]);};
  link('SKILL.md','skills/SKILL.md');
  const archive=()=>execFileSync('git',['-C',source,'archive',git(['write-tree']).trim()]);
  const {extractPinnedArchiveWithoutLinks}=await import(new URL('../../scripts/pinned-archive.mjs',import.meta.url).href);
  extractPinnedArchiveWithoutLinks(archive(),target);
  assert.deepEqual(readFileSync(join(target,'SKILL.md')),bytes);assert.equal(lstatSync(join(target,'SKILL.md')).isSymbolicLink(),false);
  const outside=join(root,'outside');writeFileSync(outside,'sentinel');link('escape','../outside');
  assert.throws(()=>extractPinnedArchiveWithoutLinks(archive(),join(root,'rejected')),/pinned_archive_unsafe/);
  assert.equal(readFileSync(outside,'utf8'),'sentinel');assert.equal(existsSync(join(root,'rejected')),false);
 }finally{rmSync(root,{recursive:true,force:true});}
});
