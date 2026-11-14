import {downloadArtifact} from '@electron/get';
import {existsSync,readFileSync,writeFileSync,mkdirSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {verifiedPlatform} from './release-platform.mjs';
const root=join(process.cwd(),'node_modules','electron');
const {version}=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
const {key,electronBinary:binary}=verifiedPlatform('desktop_platform_not_verified');
const ready=()=>existsSync(join(root,'dist',binary))&&existsSync(join(root,'path.txt'))&&readFileSync(join(root,'path.txt'),'utf8').trim()===binary;
if(key==='win32-x64'){
 // Electron's own installer downloads electron-v<version>-win32-x64.zip and checks it against checksums.json.
 if(!ready())execFileSync(process.execPath,[join(root,'install.js')],{stdio:'inherit',cwd:root});
 if(!ready())throw Error('electron_binary_not_ready');
}else if(!existsSync(join(root,'dist',binary))||!existsSync(join(root,'path.txt'))){
 const name=`electron-v${version}-darwin-arm64.zip`;
 const expected=JSON.parse(readFileSync(join(root,'checksums.json'),'utf8'))[name];
 const cache=join(homedir(),'Library','Caches','electron');
 let zip;
 if(existsSync(cache))for(const dir of readdirSync(cache,{withFileTypes:true}).filter(dir=>dir.isDirectory())){
  const candidate=join(cache,dir.name,name);
  if(existsSync(candidate)&&createHash('sha256').update(readFileSync(candidate)).digest('hex')===expected){zip=candidate;break;}
 }
 zip??=await downloadArtifact({version,artifactName:'electron',platform:'darwin',arch:'arm64'});
 if(!expected||createHash('sha256').update(readFileSync(zip)).digest('hex')!==expected)throw Error('electron_binary_checksum_mismatch');
 mkdirSync(join(root,'dist'),{recursive:true});
 execFileSync('/usr/bin/unzip',['-qo',zip,'-d',join(root,'dist')]);
 writeFileSync(join(root,'path.txt'),binary);
}
console.log(JSON.stringify({electronVersion:version,binaryReady:true}));

execFileSync(process.execPath,['scripts/verify-electron-runtime.mjs'],{stdio:'inherit'});
