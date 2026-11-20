import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {privateTempDir} from './helpers/private-temp.js';

const root=fileURLToPath(new URL('../..',import.meta.url));
const {FIXTURE_TEXT,startApprovalFixture}=await import(new URL('../../scripts/manual-approval-fixture.mjs',import.meta.url).href) as {
  FIXTURE_TEXT:string;
  startApprovalFixture:(directory:string)=>Promise<{file:string;close:()=>Promise<void>}>;
};

test('a fixture directory inside the OS temp directory is accepted, including a private temp leaf',async()=>{
  const inside=privateTempDir(join(tmpdir(),'kteam-fixture-inside-'));
  const workspace=join(inside,'workspace');
  mkdirSync(workspace);
  const fixture=await startApprovalFixture(workspace);
  try{assert.equal(readFileSync(fixture.file,'utf8'),FIXTURE_TEXT);}
  finally{await fixture.close();rmSync(inside,{recursive:true,force:true});}
});

test('a fixture directory outside the OS temp directory is rejected',async()=>{
  const outside=mkdtempSync(join(root,'build','kteam-fixture-outside-'));
  try{await assert.rejects(startApprovalFixture(outside),(error:NodeJS.ErrnoException)=>error.code==='fixture_outside_temp');}
  finally{rmSync(outside,{recursive:true,force:true});}
});
