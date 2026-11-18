// Runs every compiled test file. macOS/Linux default to Node file concurrency;
// KTEAM_TEST_CONCURRENCY may reduce parallelism on a busy developer machine.
// Windows only: bound file concurrency and each complete file (including multi-scenario integration suites).
// The full nine-scenario approval file measured 379 seconds; the whole run also has a watchdog so a
// file that never exits cannot hang CI for hours. No assertion changes.
// --test-force-exit is deliberately NOT used: on Windows + Node 24 a forced process.exit() that lands while undici
// (fetch) handles are still closing aborts the test process inside libuv
// ("Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 94"), seen in adapters.test
// and decision.test, and never before --test-force-exit was added.
//
// Test-count floor (P0-1): guards against test files silently disappearing. The DECLARED
// test count (TAP "# tests", which includes skipped tests) is compared against the floor,
// never the pass count; skipped is reported separately and is not subtracted. The spec
// reporter keeps the live per-test stdout log while a TAP copy lands in
// build/test-report.tap for the floor check.
import {spawnSync} from 'node:child_process';
import {readdirSync,mkdirSync,readFileSync} from 'node:fs';

// darwin and linux share one floor: same file set and same Node versions, so the declared
// count is identical. Do NOT silently take the smaller of per-platform values, otherwise
// one platform losing tests wholesale would still pass.
// Measured: 741 tests declared on darwin (build/test-report.tap, 2026-11-18 02:41:56,
// sha256 9cbc0140…: "# tests 741 / pass 732 / skipped 9 / fail 0", 732+9=741).
// Cross-check: the green v0.9.0 release CI run (actions/runs/44008927827, commit 5f573400)
// declared 738 on all six matrix jobs, plus this PR's 3 floor fixture tests = 741.
// The floor is the DECLARED count itself, not a ratio: a ratio floor (702 = 739*0.95) let a
// silent loss of 38 tests still pass, which defeats the purpose. Per-file declared-count
// snapshots (to explain the 736-vs-738 environment delta) are follow-up work, not this PR.
const POSIX_MIN_TESTS=741;
// Provisional: posix declared count is used until the first Windows CI run reports its own
// "# tests". Recalibrate to the measured Windows declared count then; do NOT fall back to a
// ratio-derived value.
const WIN32_MIN_TESTS=741;

const windows=process.platform==='win32';
const minTests=windows?WIN32_MIN_TESTS:POSIX_MIN_TESTS;
const platformLabel=windows?'win32':'posix (darwin/linux)';

const parseTap=tap=>{
  const field=name=>{const m=tap.match(new RegExp('^# '+name+' (\\d+)$','m'));return m?Number(m[1]):undefined;};
  const stats={tests:field('tests'),pass:field('pass'),fail:field('fail'),cancelled:field('cancelled'),skipped:field('skipped'),todo:field('todo')};
  if(stats.tests===undefined)throw Error('test_report_unparseable: no "# tests" summary in build/test-report.tap');
  return stats;
};

const checkFloor=stats=>{
  for(const field of['tests','pass','fail','skipped']){
    if(!Number.isFinite(stats[field])){
      console.error(`test_stats_invalid: stats.${field} is missing or not a number (got ${JSON.stringify(stats[field])}). Refusing to pass on unverifiable counts.`);
      return false;
    }
  }
  console.log(`test-count floor: declared=${stats.tests} expected>=${minTests} (${platformLabel}) pass=${stats.pass} fail=${stats.fail} skipped=${stats.skipped}`);
  if(stats.tests<minTests){
    console.error(`test count below floor: declared=${stats.tests} < expected=${minTests} (${platformLabel}). A test file was likely dropped or failed to load; refusing to pass.`);
    return false;
  }
  return true;
};

// Test hook: with KTEAM_TEST_STATS_FIXTURE set to a JSON stats object, only the floor
// check runs. Fixtures prove the floor without deleting real test files.
if(process.env.KTEAM_TEST_STATS_FIXTURE!==undefined){
  // cancelled/todo get defaults only; tests/pass/fail/skipped must come from the caller,
  // otherwise a missing field would be silently zeroed and the test_stats_invalid guard
  // would never fire for it.
  const stats={cancelled:0,todo:0,...JSON.parse(process.env.KTEAM_TEST_STATS_FIXTURE)};
  process.exitCode=checkFloor(stats)?0:1;
}else{
  const files=readdirSync('dist/tests').filter(name=>name.endsWith('.test.js')).sort().map(name=>'dist/tests/'+name);
  // A busy developer machine can reduce file parallelism without skipping tests.
  const requested=process.env.KTEAM_TEST_CONCURRENCY;
  if(requested!==undefined&&!/^(?:[1-9]|1[0-6])$/.test(requested))throw Error('invalid_test_concurrency');
  const concurrency=requested?Math.min(windows?2:16,Number(requested)):windows?2:undefined;
  mkdirSync('build',{recursive:true});
  const tapPath='build/test-report.tap';
  const result=spawnSync(process.execPath,['--preserve-symlinks','--test',
    '--test-reporter=spec','--test-reporter-destination=stdout',
    '--test-reporter=tap','--test-reporter-destination='+tapPath,
    ...(concurrency?['--test-concurrency='+concurrency]:[]),
    ...(windows?['--test-timeout=600000']:[]),...files],
    {stdio:'inherit',...(windows?{timeout:40*60000,killSignal:'SIGKILL'}:{})});
  if(result.error&&result.error.code!=='ETIMEDOUT')throw result.error;
  if(result.error)console.error('test run exceeded the 40 minute Windows watchdog');
  const floorOk=checkFloor(parseTap(readFileSync(tapPath,'utf8')));
  process.exitCode=result.status??1;
  if(!floorOk&&process.exitCode===0)process.exitCode=1;
}
