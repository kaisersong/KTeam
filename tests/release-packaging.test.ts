import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const read=(file:string)=>readFileSync(join(root,file),'utf8');
const platformModule=async()=>await import(pathToFileURL(join(root,'scripts/release-platform.mjs')).href) as {verifiedPlatform:(code:string,platform?:string,arch?:string)=>{key:string,electronBinary:string},VERIFIED_PLATFORMS:Record<string,unknown>};

test('desktop and release gates accept exactly darwin-arm64 and win32-x64',async()=>{
 const {verifiedPlatform,VERIFIED_PLATFORMS}=await platformModule();
 assert.deepEqual(Object.keys(VERIFIED_PLATFORMS).sort(),['darwin-arm64','win32-x64']);
 assert.ok(Object.isFrozen(VERIFIED_PLATFORMS));
 for(const code of ['desktop_platform_not_verified','release_platform_not_verified']){
  assert.deepEqual(verifiedPlatform(code,'darwin','arm64'),{key:'darwin-arm64',platform:'darwin',arch:'arm64',electronBinary:'Electron.app/Contents/MacOS/Electron'});
  assert.deepEqual(verifiedPlatform(code,'win32','x64'),{key:'win32-x64',platform:'win32',arch:'x64',electronBinary:'electron.exe'});
  for(const [platform,arch] of <[string,string][]>[['darwin','x64'],['win32','arm64'],['win32','ia32'],['linux','x64'],['linux','arm64'],['freebsd','x64'],['constructor',''],['__proto__','']])
   assert.throws(()=>verifiedPlatform(code,platform,arch),new Error(code),`${platform}-${arch}`);
 }
});

test('both gate scripts use the shared platform table instead of a darwin-only check',()=>{
 for(const [file,code] of [['scripts/ensure-electron.mjs','desktop_platform_not_verified'],['scripts/package-release.mjs','release_platform_not_verified']] as const){
  const text=read(file);
  assert.match(text,/from '\.\/release-platform\.mjs'/,file);
  assert.ok(text.includes(`verifiedPlatform('${code}')`),file);
  assert.doesNotMatch(text,/process\.platform!==/,file);
 }
});

test('electron-builder packs Windows x64 as unsigned NSIS + portable with distinct names, and leaves mac unchanged',()=>{
 const yaml=createRequire(import.meta.url)('js-yaml') as {load:(text:string)=>any};
 const config=yaml.load(read('electron-builder.yml'));
 assert.deepEqual(config.publish,{provider:'github',owner:'kaisersong',repo:'KTeam',releaseType:'draft'});
 assert.deepEqual(config.win.target,[{target:'nsis',arch:['x64']},{target:'portable',arch:['x64']}]);
 assert.equal(config.win.forceCodeSigning,false);
 for(const key of ['certificateFile','certificateSubjectName','certificateSha1','signtoolOptions','azureSignOptions','publisherName'])assert.equal(config.win[key],undefined,key);
 assert.equal(config.nsis.artifactName,'${productName}-setup-${version}.${ext}');
 assert.equal(config.portable.artifactName,'${productName}-portable-${version}.${ext}');
 assert.notEqual(config.nsis.artifactName,config.portable.artifactName);
 // The NSIS blockmap drives differential updates; latest.yml comes from the publish block above.
 assert.notEqual(config.nsis.differentialPackage,false);
 assert.equal(config.nsis.oneClick,false);assert.equal(config.nsis.perMachine,false);
 assert.deepEqual(config.mac.target,['dir','dmg','zip']);
 assert.equal(config.mac.artifactName,'${productName}-${version}-${arch}-mac.${ext}');
 assert.equal(config.dmg.artifactName,'${productName}-${version}-${arch}-mac.${ext}');
 assert.equal(config.mac.hardenedRuntime,true);assert.equal(config.mac.notarize,false);
 assert.equal(config.mac.entitlements,'desktop/assets/entitlements.mac.plist');
 assert.equal(config.mac.entitlementsInherit,'desktop/assets/entitlements.mac.inherit.plist');
});
