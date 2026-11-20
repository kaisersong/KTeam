import {readFileSync,realpathSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';
import {execFileSync} from 'node:child_process';
import {extractFile} from '@electron/asar';

const blockedGitEnv=['GIT_DIR','GIT_WORK_TREE','GIT_INDEX_FILE','GIT_OBJECT_DIRECTORY','GIT_ALTERNATE_OBJECT_DIRECTORIES','GIT_COMMON_DIR','GIT_NAMESPACE','GIT_CEILING_DIRECTORIES'];

function gitFailure(code){const error=new Error(code);error.code=code;return error;}
function git(cwd,args){
  const env={...process.env};
  for(const key of blockedGitEnv)delete env[key];
  return execFileSync('git',['-C',cwd,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe'],env});
}
function canonical(path){try{return realpathSync(path);}catch{return resolve(path);}}

/** Identity comes only from a Git worktree whose top-level is this project. A missing .git must not climb into a parent repository, and handwritten Git environment variables are ignored. */
export function sourceGitIdentity(root){
  const project=realpathSync(resolve(root));
  let top;
  try{top=git(project,['rev-parse','--show-toplevel']).trim();}
  catch(error){
    const message=String(error?.stderr??error?.message??'');
    if(error?.status||/not a git repository/i.test(message))throw gitFailure('release_source_git_unscoped');
    throw error;
  }
  if(canonical(top)!==project)throw gitFailure('release_source_git_unscoped');
  const gitDir=canonical(git(project,['rev-parse','--absolute-git-dir']).trim());
  const expected=join(project,'.git');
  if(gitDir!==canonical(expected)&&!gitDir.startsWith(canonical(expected)+sep))throw gitFailure('release_source_git_unscoped');
  const revision=git(project,['rev-parse','HEAD']).trim();
  if(!/^[a-f0-9]{40}$/.test(revision))throw gitFailure('release_source_revision_invalid');
  if(git(project,['status','--porcelain']).trim())throw gitFailure('release_source_dirty');
  return {revision,dirty:false};
}

export function assertBuildIdentity(info,expected){
 if(info?.version!==expected.version||info.revision!==expected.revision||info.dirty!==false||!/^[a-f0-9]{64}$/.test(info.lockfileSha256??'')||info.lockfileSha256!==expected.lockfileSha256||expected.official===true&&info.official!==true)throw gitFailure('release_build_identity_mismatch');
 return info;
}
export function readPackagedIdentity(resources,expected){
 const inside=extractFile(join(resources,'app.asar'),'build/build-info.json'),outside=readFileSync(join(resources,'build-info.json'));
 // Runtime reads the ASAR copy. The external copy is only for installed-package
 // inspection; byte equality prevents two competing build identities.
 if(!inside.equals(outside))throw gitFailure('release_build_copies_mismatch');
 return assertBuildIdentity(JSON.parse(inside.toString('utf8')),expected);
}
export function verifyAncestry(cwd,revision,tag,required){
 const project=realpathSync(resolve(cwd));
 const identity=sourceGitIdentity(project);
 if(!/^[a-f0-9]{40}$/.test(revision)||tag&&!/^v\d+\.\d+\.\d+$/.test(tag))throw gitFailure('release_identity_input_invalid');
 if(identity.revision!==revision)throw gitFailure('release_source_revision_mismatch');
 if(tag&&git(project,['rev-parse',tag+'^{commit}']).trim()!==revision)throw gitFailure('release_tag_commit_mismatch');
 for(const commit of required){
  if(!/^[a-f0-9]{40}$/.test(commit))throw gitFailure('release_required_commit_invalid');
  try{git(project,['merge-base','--is-ancestor',commit,revision]);}
  catch(error){
    const message=String(error?.stderr??error?.message??'');
    if(/not a valid (commit|object)|bad object|needed a single revision/i.test(message))throw gitFailure('release_required_commit_absent');
    throw error.status?gitFailure('release_required_commit_invalid'):error;
  }
 }
}
