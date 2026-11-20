// Simulator build for the Expo iOS project.
// Expo CLI 58.0.25 `prebuild --platform ios --no-install` was run on Linux.
// It wrote ios/KTeam.xcodeproj and Podfile, and did not create ios/KTeam.xcworkspace.
// The generated project sets CODE_SIGN_IDENTITY only for sdk=iphoneos*. There is no
// DEVELOPMENT_TEAM. This script turns simulator signing off. It does not read a team id
// and does not use a distribution certificate. Linux cannot run xcodebuild.
const {execFileSync}=require('node:child_process');
const {existsSync}=require('node:fs');
const {resolve,join}=require('node:path');

const root=resolve(__dirname,'..');
const workspace=join(root,'ios/KTeam.xcworkspace');
const project=join(root,'ios/KTeam.xcodeproj');
const MAC_PREBUILD='cd mobile && npm ci && npx expo prebuild --platform ios';

function missingNativeProject(projectExists){
  const found=projectExists
    ? 'ios/KTeam.xcodeproj exists, but CocoaPods has not created ios/KTeam.xcworkspace.'
    : 'mobile/ios is not in the repository.';
  return found+' On macOS, from the repository root: '+MAC_PREBUILD+'\n'
    +'That command installs npm dependencies and CocoaPods, then creates ios/KTeam.xcworkspace. '
    +'Expo CLI 58.0.25 with --no-install was run on Linux: it wrote ios/KTeam.xcodeproj and Podfile, and did not create the workspace. '
    +'Do not set KTEAM_APPLE_TEAM_ID. This simulator build does not use a distribution certificate.';
}

function simulatorBuildPlan(options={}){
  const platform=options.platform??process.platform;
  if(platform!=='darwin'){
    return {error:'iOS simulator builds require macOS with Xcode. This host is '+platform+'. Linux cannot run xcodebuild or produce a .app.'};
  }
  if(!options.derived){
    return {error:'Pass a derived-data path. Example: node scripts/build-ios-simulator.cjs /tmp/kteam-ios-derived'};
  }
  const workspacePath=options.workspace??workspace;
  const projectPath=options.project??project;
  if(!existsSync(workspacePath))return {error:missingNativeProject(existsSync(projectPath))};
  const buildNumber=options.buildNumber??require('../app.json').expo.ios.buildNumber;
  if(!buildNumber)return {error:'app.json expo.ios.buildNumber is missing.'};
  const args=[
    '-workspace',workspacePath,
    '-scheme','KTeam',
    '-configuration','Release',
    '-sdk','iphonesimulator',
    '-destination','generic/platform=iOS Simulator',
    '-derivedDataPath',resolve(options.derived),
    '-jobs','2',
    'ARCHS=arm64',
    'ONLY_ACTIVE_ARCH=YES',
    'CURRENT_PROJECT_VERSION='+buildNumber,
    'CODE_SIGNING_ALLOWED=NO',
    'CODE_SIGNING_REQUIRED=NO',
    'CODE_SIGN_IDENTITY=',
  ];
  return {
    args,
    app:join(resolve(options.derived),'Build/Products/Release-iphonesimulator/KTeam.app'),
  };
}

if(require.main===module){
  const plan=simulatorBuildPlan({derived:process.argv[2]});
  if(plan.error)throw Error(plan.error);
  execFileSync('xcodebuild',plan.args,{cwd:root,stdio:'inherit'});
  if(!existsSync(plan.app))throw Error('simulator_app_missing: '+plan.app);
  console.log(plan.app);
}

module.exports={simulatorBuildPlan,workspace,project,MAC_PREBUILD};
