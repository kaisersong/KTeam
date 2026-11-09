import {downloadArtifact} from '@electron/get';
import {existsSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
const root=join(process.cwd(),'node_modules','electron');
const {version}=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
const binary='Electron.app/Contents/MacOS/Electron';
if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('desktop_platform_not_verified');
if(!existsSync(join(root,'dist',binary))||!existsSync(join(root,'path.txt'))){
 const zip=await downloadArtifact({version,artifactName:'electron',platform:'darwin',arch:'arm64'});
 const name=`electron-v${version}-darwin-arm64.zip`;
 const expected=JSON.parse(readFileSync(join(root,'checksums.json'),'utf8'))[name];
 if(!expected||createHash('sha256').update(readFileSync(zip)).digest('hex')!==expected)throw Error('electron_binary_checksum_mismatch');
 mkdirSync(join(root,'dist'),{recursive:true});
 execFileSync('/usr/bin/unzip',['-qo',zip,'-d',join(root,'dist')]);
 writeFileSync(join(root,'path.txt'),binary);
}
console.log(JSON.stringify({electronVersion:version,binaryReady:true}));
