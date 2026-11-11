import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
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
