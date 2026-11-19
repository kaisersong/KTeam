import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {hideDanglingPackLinks} from './desktop-pack-input.mjs';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const build=spawnSync(process.env.npm_execpath?process.execPath:'npm',process.env.npm_execpath?[process.env.npm_execpath,'run','build:desktop']:['run','build:desktop'],{cwd:root,stdio:'inherit'});
if(build.status)process.exit(build.status??1);
const held=hideDanglingPackLinks(root);
let status=1;
try{
  const pack=spawnSync(process.execPath,[
    join(root,'node_modules/electron-builder/out/cli/cli.js'),
    '--mac','dir','--arm64','--publish','never','-c.mac.identity=-','-c.mac.hardenedRuntime=false',
  ],{cwd:root,stdio:'inherit',env:{...process.env,CSC_IDENTITY_AUTO_DISCOVERY:'false'}});
  status=pack.status??1;
  if(!status){
    const verify=spawnSync(process.execPath,[join(root,'scripts/verify-local-signature.mjs')],{cwd:root,stdio:'inherit'});
    status=verify.status??1;
  }
}finally{
  held.restore();
}
process.exit(status);
