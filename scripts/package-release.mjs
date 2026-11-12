import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {extractFile} from '@electron/asar';
import {verifiedPlatform} from './release-platform.mjs';

const pkg=JSON.parse(readFileSync('package.json','utf8'));
const tag=process.env.RELEASE_TAG??`v${pkg.version}`;
if(!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag)||tag!==`v${pkg.version}`)throw Error('release_tag_version_mismatch');
const {key}=verifiedPlatform('release_platform_not_verified');
const sha256=name=>createHash('sha256').update(readFileSync(`release/${name}`)).digest('hex');
const identity=asar=>{
 const info=JSON.parse(extractFile(asar,'build/build-info.json').toString());
 const revision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 if(info.dirty||info.version!==pkg.version||info.revision!==revision)throw Error('release_build_identity_mismatch');
 if(execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim())throw Error('release_worktree_dirty');
 return info;
};
let artifacts;
if(key==='darwin-arm64'){
 const app='release/mac-arm64/KTeam.app';
 const info=identity(`${app}/Contents/Resources/app.asar`);
 const bundleVersion=execFileSync('/usr/libexec/PlistBuddy',['-c','Print :CFBundleShortVersionString',`${app}/Contents/Info.plist`],{encoding:'utf8'}).trim();
 if(bundleVersion!==pkg.version)throw Error('release_bundle_version_mismatch');
 execFileSync('/usr/bin/codesign',['--verify','--deep','--strict',app],{stdio:'inherit'});
 const stem=`KTeam-${pkg.version}-mac-arm64`;
 const archive=`${stem}.zip`,metadata=`${stem}-build.json`;
 execFileSync('/usr/bin/ditto',['-c','-k','--sequesterRsrc','--keepParent',app,`release/${archive}`]);
 writeFileSync(`release/${metadata}`,JSON.stringify({...info,tag,platform:'darwin',arch:'arm64',signing:'ad-hoc',notarized:false},null,2)+'\n');
 artifacts=[archive,metadata];
}else{
 // win32-x64: electron-builder `--win nsis portable --x64` output. Unsigned (no Windows code signing yet).
 // latest.yml is the electron-updater feed entry for KTeam's own Releases (owner: kaisersong, repo: KTeam).
 const info=identity('release/win-unpacked/resources/app.asar');
 const setup=`KTeam-setup-${pkg.version}.exe`,portable=`KTeam-portable-${pkg.version}.exe`;
 const required=[setup,`${setup}.blockmap`,portable,'latest.yml'];
 const missing=required.filter(name=>!existsSync(`release/${name}`));
 if(missing.length)throw Error('release_windows_artifacts_missing: '+missing.join(', '));
 const feed=readFileSync('release/latest.yml','utf8');
 if(!new RegExp(`^version: ${pkg.version.replaceAll('.','\\.')}$`,'m').test(feed)||!feed.includes(`path: ${setup}`))throw Error('release_windows_feed_mismatch');
 const sha512=createHash('sha512').update(readFileSync(`release/${setup}`)).digest('base64');
 if(!feed.includes(`sha512: ${sha512}`))throw Error('release_windows_feed_digest_mismatch');
 const metadata=`KTeam-${pkg.version}-win-x64-build.json`;
 writeFileSync(`release/${metadata}`,JSON.stringify({...info,tag,platform:'win32',arch:'x64',signing:'unsigned',notarized:false},null,2)+'\n');
 artifacts=[...required,metadata];
}
const sums=artifacts.map(name=>`${sha256(name)}  ${name}`).join('\n')+'\n';
writeFileSync('release/SHA256SUMS',sums);
console.log(sums);
