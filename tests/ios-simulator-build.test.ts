import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../..',import.meta.url));
const script=join(root,'mobile/scripts/build-ios-simulator.cjs');
const {simulatorBuildPlan,MAC_PREBUILD}=createRequire(import.meta.url)(script) as {
  simulatorBuildPlan:(options?:{platform?:string,derived?:string,workspace?:string,project?:string,buildNumber?:string})=>{error?:string,args?:string[],app?:string},
  MAC_PREBUILD:string,
};
const source=readFileSync(script,'utf8');

test('linux refuses before xcodebuild and does not claim an app exists',()=>{
  const plan=simulatorBuildPlan({platform:'linux',derived:'/tmp/kteam-ios-derived'});
  assert.match(plan.error??'',/This host is linux/);
  assert.match(plan.error??'',/Linux cannot run xcodebuild or produce a \.app/);
  assert.equal(plan.args,undefined);
});

test('the script process on this host exits with the linux refusal',()=>{
  let stderr='';
  try{
    execFileSync(process.execPath,[script,'/tmp/kteam-ios-derived'],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
    assert.fail('expected non-zero exit');
  }catch(error){
    const failed=error as {status?:number,stderr?:string};
    stderr=String(failed.stderr??'');
    assert.notEqual(failed.status,0);
  }
  assert.match(stderr,/This host is linux/);
  assert.match(stderr,/Linux cannot run xcodebuild or produce a \.app/);
  assert.doesNotMatch(stderr,/ENOENT/);
  assert.doesNotMatch(stderr,/simulator_app_missing/);
});

test('darwin requires a derived-data path and does not ask for a team id',()=>{
  const plan=simulatorBuildPlan({platform:'darwin'});
  assert.match(plan.error??'',/derived-data path/);
  assert.doesNotMatch(plan.error??'',/KTEAM_APPLE_TEAM_ID/);
  assert.doesNotMatch(plan.error??'',/DEVELOPMENT_TEAM/);
});

test('a missing workspace names the macOS prebuild command and ignores a team id',()=>{
  const absent=simulatorBuildPlan({platform:'darwin',derived:'/tmp/kteam-derived',workspace:join(tmpdir(),'missing.xcworkspace'),project:join(tmpdir(),'missing.xcodeproj')});
  assert.match(absent.error??'',/mobile\/ios is not in the repository/);
  assert.match(absent.error??'',new RegExp(MAC_PREBUILD.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.match(absent.error??'',/did not create the workspace/);
  assert.match(absent.error??'',/Do not set KTEAM_APPLE_TEAM_ID/);
  assert.match(absent.error??'',/does not use a distribution certificate/);
  const project=mkdtempSync(join(tmpdir(),'kteam-xcodeproj-'));
  const onlyProject=simulatorBuildPlan({platform:'darwin',derived:'/tmp/kteam-derived',workspace:join(tmpdir(),'missing.xcworkspace'),project});
  assert.match(onlyProject.error??'',/CocoaPods has not created ios\/KTeam\.xcworkspace/);
  assert.equal(MAC_PREBUILD.includes('--no-install'),false);
  assert.match(onlyProject.error??'',/with --no-install was run on Linux/);
  assert.match(onlyProject.error??'',/did not create the workspace/);
});

test('a present workspace plans an unsigned simulator build and does not read a team id',()=>{
  const previous=process.env.KTEAM_APPLE_TEAM_ID;
  process.env.KTEAM_APPLE_TEAM_ID='ABCDEFGHIJ';
  try{
    const workspace=mkdtempSync(join(tmpdir(),'kteam-workspace-'));
    const plan=simulatorBuildPlan({platform:'darwin',derived:'derived data',workspace});
    assert.equal(plan.error,undefined);
    const args=plan.args??[];
    assert.equal(args[args.indexOf('-workspace')+1],workspace);
    assert.equal(args[args.indexOf('-scheme')+1],'KTeam');
    assert.equal(args[args.indexOf('-sdk')+1],'iphonesimulator');
    assert.equal(args[args.indexOf('-destination')+1],'generic/platform=iOS Simulator');
    assert.ok(args.includes('ARCHS=arm64'));
    assert.ok(args.includes('CODE_SIGNING_ALLOWED=NO'));
    assert.ok(args.includes('CODE_SIGNING_REQUIRED=NO'));
    assert.ok(args.includes('CODE_SIGN_IDENTITY='));
    const buildNumber=JSON.parse(readFileSync(join(root,'mobile/app.json'),'utf8')).expo.ios.buildNumber;
    assert.ok(args.includes('CURRENT_PROJECT_VERSION='+buildNumber));
    assert.equal(args.some(arg=>arg.startsWith('DEVELOPMENT_TEAM=')),false);
    assert.equal(args.some(arg=>arg.includes('ABCDEFGHIJ')),false);
    assert.equal(args.some(arg=>arg.includes('KTEAM_APPLE_TEAM_ID')),false);
    assert.match(plan.app??'',/Release-iphonesimulator\/KTeam\.app$/);
  }finally{
    if(previous===undefined)delete process.env.KTEAM_APPLE_TEAM_ID;
    else process.env.KTEAM_APPLE_TEAM_ID=previous;
  }
  assert.doesNotMatch(source,/process\.env\.KTEAM_APPLE_TEAM_ID/);
  assert.doesNotMatch(source,/DEVELOPMENT_TEAM=/);
  assert.doesNotMatch(source,/codesign/);
});
