import {spawnSync,execFileSync} from 'node:child_process';
import {readdirSync,mkdirSync,readFileSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {withMobileInstall} from './mobile-install.mjs';
import {parseStats,assertStats,assertFloor,floorFor,shardSpec,partition,digest} from './test-report.mjs';

export function runTests(){
 const files=readdirSync('dist/tests').filter(name=>name.endsWith('.test.js')).sort().map(name=>'dist/tests/'+name);
 const windows=process.platform==='win32',shard=shardSpec(process.env.KTEAM_TEST_SHARD),selected=partition(files,shard);
 if(!selected.length)throw Error('test_shard_empty');
 if(shard.count>1&&process.env.GITHUB_ACTIONS!=='true')throw Error('sharded_checks_require_ci_aggregation');
 const requested=process.env.KTEAM_TEST_CONCURRENCY;
 if(requested!==undefined&&!/^(?:[1-9]|1[0-6])$/.test(requested))throw Error('invalid_test_concurrency');
 const concurrency=requested?Math.min(windows?2:16,Number(requested)):windows?2:undefined;
 const directory='build/test-reports',stem=process.platform+'-'+process.versions.node+'-'+shard.index;
 mkdirSync(directory,{recursive:true});const tap=directory+'/'+stem+'.tap',report=directory+'/'+stem+'.json';rmSync(tap,{force:true});rmSync(report,{force:true});
 // The lock stays open until the test process exits. Releasing it after npm ci would let
 // another run delete node_modules while these workers are still reading it.
 withMobileInstall({mobile:'mobile',lockDirectory:'build/mobile-install-lock'},()=>{
  const result=spawnSync(process.execPath,['--preserve-symlinks','--test','--test-reporter=spec','--test-reporter-destination=stdout','--test-reporter=tap','--test-reporter-destination='+tap,...(concurrency?['--test-concurrency='+concurrency]:[]),...(windows?['--test-timeout=600000']:[]),...selected],{stdio:'inherit',...(windows?{timeout:45*60000,killSignal:'SIGKILL'}:{})});
  if(result.error)throw result.error;
  if(result.status!==0){process.exitCode=result.status??1;return;}
  const stats=parseStats(readFileSync(tap,'utf8'));assertStats(stats);if(shard.count===1)assertFloor(stats,floorFor(process.platform));
  const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  writeFileSync(report,JSON.stringify({revision,platform:process.platform,node:process.versions.node,shard,inventory:files.map(name=>({name,sha256:digest(readFileSync(name))})),files:selected,stats},null,2));
  console.log(JSON.stringify({testReport:report,declared:stats.tests,skipped:stats.skipped,shard,fullFloor:floorFor(process.platform)}));
 });
}

const invoked=process.argv[1]&&realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url));
if(invoked)runTests();
