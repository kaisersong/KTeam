import {fileURLToPath,pathToFileURL} from 'node:url';
import {dirname,join,resolve} from 'node:path';
import {runPack} from './desktop-pack-input.mjs';

const root=dirname(dirname(fileURLToPath(import.meta.url)));

function main(){
  const build=process.env.npm_execpath?[process.execPath,process.env.npm_execpath,'run','build:desktop']:['npm','run','build:desktop'];
  return runPack({
    root,
    build,
    pack:[
      process.execPath,
      join(root,'node_modules/electron-builder/out/cli/cli.js'),
      '--mac','dir','--arm64','--publish','never','-c.mac.identity=-','-c.mac.hardenedRuntime=false',
      '-c.directories.output='+join(root,'release'),
    ],
    verify:[process.execPath,join(root,'scripts/verify-local-signature.mjs')],
    env:{...process.env,CSC_IDENTITY_AUTO_DISCOVERY:'false'},
  });
}

const invoked=process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href;
if(invoked)process.exit(main());
