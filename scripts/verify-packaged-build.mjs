import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {readPackagedIdentity,sourceGitIdentity,verifyAncestry} from './build-identity.mjs';
const resources=process.argv[2];if(!resources)throw Error('packaged_resources_required');
const source=sourceGitIdentity(process.cwd()),version=JSON.parse(readFileSync('package.json','utf8')).version;
const lockfileSha256=createHash('sha256').update(readFileSync('package-lock.json')).digest('hex');
const info=readPackagedIdentity(resources,{version,revision:source.revision,lockfileSha256,official:!!process.env.RELEASE_TAG});
verifyAncestry(process.cwd(),source.revision,process.env.RELEASE_TAG,JSON.parse(readFileSync('release-required-commits.json','utf8')));
console.log(JSON.stringify({packagedIdentity:'verified',...info}));
