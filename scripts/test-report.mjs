import {createHash} from 'node:crypto';
export const POSIX_MIN_TESTS=781;
export const WIN32_MIN_TESTS=781;
// Baseline: 766 declared tests on all platforms at 020efbf; six release regression
// tests, two queue-routing regressions and five group-directory and two GitHub-query regressions are added here. Platform skips are included in the declared count.
export const floorFor=platform=>platform==='win32'?WIN32_MIN_TESTS:POSIX_MIN_TESTS;
export function parseStats(text){
 const read=name=>{const match=text.match(new RegExp('^# '+name+' (\\d+)\\r?$','m'));if(!match)throw Error('test_summary_missing_'+name);return Number(match[1]);};
 return Object.fromEntries(['tests','pass','fail','cancelled','skipped','todo'].map(name=>[name,read(name)]));
}
export function assertStats(stats){for(const name of ['tests','pass','fail','cancelled','skipped','todo'])if(!Number.isSafeInteger(stats?.[name])||stats[name]<0)throw Error('test_summary_invalid_'+name);if(stats.fail||stats.cancelled)throw Error('test_suite_failed');}
export function assertFloor(stats,minimum){assertStats(stats);if(!Number.isSafeInteger(minimum)||minimum<766)throw Error('test_floor_not_calibrated');if(stats.tests<minimum)throw Error('test_count_below_floor');return stats;}
export function shardSpec(value){if(value===undefined)return {index:1,count:1};const match=/^([1-9]\d*)\/([1-9]\d*)$/.exec(value);if(!match||Number(match[1])>Number(match[2])||Number(match[2])>16)throw Error('invalid_test_shard');return {index:Number(match[1]),count:Number(match[2])};}
export const partition=(files,shard)=>files.filter((_,index)=>index%shard.count===shard.index-1);
export const digest=value=>createHash('sha256').update(value).digest('hex');
export const GROUPS=['darwin','linux','win32'].flatMap(platform=>['22.22.0','24.16.0'].map(node=>({platform,node,count:platform==='win32'?2:1})));
export function verifyReports(reports,revision,groups=GROUPS){
 if(reports.length!==groups.reduce((sum,g)=>sum+g.count,0))throw Error('test_report_set_incomplete');
 const summaries=[];
 for(const group of groups){
  const parts=reports.filter(r=>r.platform===group.platform&&r.node===group.node);
  if(parts.length!==group.count||new Set(parts.map(r=>r.shard.index)).size!==group.count)throw Error('test_shards_missing_or_duplicated');
  const inventory=parts[0].inventory;
  if(!Array.isArray(inventory)||!inventory.length||new Set(inventory.map(f=>f.name)).size!==inventory.length)throw Error('test_inventory_invalid');
  const stats={tests:0,pass:0,fail:0,cancelled:0,skipped:0,todo:0};
  for(const part of parts){
   if(part.revision!==revision||part.shard.count!==group.count||part.shard.index<1||part.shard.index>group.count||JSON.stringify(part.inventory)!==JSON.stringify(inventory)||JSON.stringify(part.files)!==JSON.stringify(partition(inventory.map(f=>f.name),part.shard)))throw Error('test_shard_coverage_mismatch');
   assertStats(part.stats);for(const name of Object.keys(stats))stats[name]+=part.stats[name];
  }
  assertFloor(stats,floorFor(group.platform));summaries.push({...group,...stats});
 }
 return summaries;
}
