import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {extractFile} from '@electron/asar';
export function assertBuildIdentity(info,expected){
 if(info?.version!==expected.version||info.revision!==expected.revision||info.dirty!==false||!/^[a-f0-9]{64}$/.test(info.lockfileSha256??'')||info.lockfileSha256!==expected.lockfileSha256||expected.official===true&&info.official!==true)throw Error('release_build_identity_mismatch');
 return info;
}
export function readPackagedIdentity(resources,expected){
 const inside=extractFile(join(resources,'app.asar'),'build/build-info.json'),outside=readFileSync(join(resources,'build-info.json'));
 // Runtime reads the ASAR copy. The external copy is only for installed-package
 // inspection; byte equality prevents two competing build identities.
 if(!inside.equals(outside))throw Error('release_build_copies_mismatch');
 return assertBuildIdentity(JSON.parse(inside.toString('utf8')),expected);
}
export function verifyAncestry(cwd,revision,tag,required){
 const git=args=>execFileSync('git',['-C',cwd,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 if(!/^[a-f0-9]{40}$/.test(revision)||tag&&!/^v\d+\.\d+\.\d+$/.test(tag))throw Error('release_identity_input_invalid');
 if(tag&&git(['rev-parse',tag+'^{commit}'])!==revision)throw Error('release_tag_commit_mismatch');
 for(const commit of required){if(!/^[a-f0-9]{40}$/.test(commit))throw Error('release_required_commit_invalid');git(['merge-base','--is-ancestor',commit,revision]);}
}
