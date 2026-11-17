import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';

// P0-1 fixtures: the test-count floor in scripts/run-tests.mjs is exercised through
// KTEAM_TEST_STATS_FIXTURE so no real test file is ever deleted to prove it.
const root=join(import.meta.dirname,'..','..');
const source=readFileSync(join(root,'scripts','run-tests.mjs'),'utf8');
const constant=process.platform==='win32'?'WIN32_MIN_TESTS':'POSIX_MIN_TESTS';
const floor=Number(source.match(new RegExp(constant+'\\s*=\\s*(\\d+)'))![1]);
assert.ok(Number.isInteger(floor)&&floor>1,constant+' must be a measured value, not a placeholder');

const runFloor=(stats:object)=>spawnSync(process.execPath,['scripts/run-tests.mjs'],{cwd:root,encoding:'utf8',env:{...process.env,KTEAM_TEST_STATS_FIXTURE:JSON.stringify(stats)}});

test('declared count below the floor exits non-zero even when no test fails',()=>{
  const r=runFloor({tests:floor-1,pass:floor-1,fail:0,skipped:0});
  assert.notEqual(r.status,0,r.stdout+r.stderr);
  assert.match(r.stdout+r.stderr,new RegExp('declared='+(floor-1)));
  assert.match(r.stdout+r.stderr,new RegExp('expected='+floor));
});

test('missing or non-numeric stats fields exit non-zero as test_stats_invalid',()=>{
  for(const stats of[{},{tests:floor},{tests:'680',pass:680,fail:0,skipped:0},{tests:floor,pass:floor,fail:0}]){
    const r=runFloor(stats);
    assert.notEqual(r.status,0,JSON.stringify(stats)+' must not pass; got exit 0');
    assert.match(r.stdout+r.stderr,/test_stats_invalid/);
  }
});

test('declared count at or above the floor passes; skipped is reported, not subtracted',()=>{
  const r=runFloor({tests:floor+3,pass:floor,fail:0,skipped:3});
  assert.equal(r.status,0,r.stdout+r.stderr);
  assert.match(r.stdout,new RegExp('declared='+(floor+3)+' expected>='+floor));
  assert.match(r.stdout,/skipped=3/);
});
