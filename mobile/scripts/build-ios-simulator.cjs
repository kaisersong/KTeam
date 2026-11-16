// Xcode embeds simulator entitlements during linking. Do not ship unsigned
// simulator apps or add device-style entitlements with a later codesign pass.
const {execFileSync}=require('node:child_process');
const {resolve,join}=require('node:path');
const derived=process.argv[2],team=process.env.KTEAM_APPLE_TEAM_ID;
if(!derived||!team||!/^\w{10}$/.test(team))throw Error('Set KTEAM_APPLE_TEAM_ID and pass a derived-data path. No private key is needed for simulator ad-hoc signing.');
const root=resolve(__dirname,'..'),config=require('../app.json').expo;
execFileSync('xcodebuild',['-workspace',join(root,'ios/KTeam.xcworkspace'),'-scheme','KTeam','-configuration','Release','-sdk','iphonesimulator','-destination','generic/platform=iOS Simulator','-derivedDataPath',resolve(derived),'-jobs','2','ARCHS=arm64','ONLY_ACTIVE_ARCH=YES','CURRENT_PROJECT_VERSION='+config.ios.buildNumber,'CODE_SIGNING_ALLOWED=YES','CODE_SIGN_IDENTITY=-','DEVELOPMENT_TEAM='+team],{cwd:root,stdio:'inherit'});
execFileSync('codesign',['--verify','--deep','--strict',join(resolve(derived),'Build/Products/Release-iphonesimulator/KTeam.app')],{stdio:'inherit'});
