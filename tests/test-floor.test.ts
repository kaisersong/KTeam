import {test} from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {pathToFileURL} from 'node:url';import {resolve} from 'node:path';
const {parseStats,assertFloor,partition,verifyReports}=await import(new URL('../../scripts/test-report.mjs',import.meta.url).href);
test('declared test counts include platform skips and malformed summaries fail closed',()=>{
 const stats=parseStats('# tests 772\n# pass 752\n# fail 0\n# cancelled 0\n# skipped 20\n# todo 0\n');assert.equal(assertFloor(stats,772).tests,772);assert.equal(stats.skipped,20);assert.throws(()=>parseStats('# tests 772'));assert.throws(()=>assertFloor({...stats,fail:1},772));
});
test('the real floor checker exits nonzero for lost tests or an uncalibrated floor without deleting a test or bypassing the runner',()=>{
 const script=pathToFileURL(resolve('scripts/test-report.mjs')).href;
 for(const [tests,minimum,success] of [[771,772,false],[772,772,true],[772,1,false]]){
  const source=`import {assertFloor} from ${JSON.stringify(script)};assertFloor({tests:${tests},pass:750,fail:0,cancelled:0,skipped:22,todo:0},${minimum})`;
  assert.equal(spawnSync(process.execPath,['--input-type=module','-e',source],{encoding:'utf8'}).status===0,success);
 }
});
test('CI aggregation rejects missing, duplicate and changed shard inventories and counts every assigned file exactly once',()=>{
 const inventory=['a','b','c','d'].map(name=>({name,sha256:'a'.repeat(64)})),revision='b'.repeat(40),group={platform:'win32',node:'24.16.0',count:2};
 const reports=[1,2].map(index=>({revision,platform:group.platform,node:group.node,shard:{index,count:2},inventory,files:partition(inventory.map(i=>i.name),{index,count:2}),stats:{tests:400,pass:390,fail:0,cancelled:0,skipped:10,todo:0}}));
 assert.equal(verifyReports(reports,revision,[group])[0].tests,800);assert.throws(()=>verifyReports(reports.slice(0,1),revision,[group]));assert.throws(()=>verifyReports([reports[0],reports[0]],revision,[group]));assert.throws(()=>verifyReports([reports[0],{...reports[1],files:['a','d']}],revision,[group]));assert.throws(()=>verifyReports(reports,'c'.repeat(40),[group]));
});
