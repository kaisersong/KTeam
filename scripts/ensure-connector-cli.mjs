import {createRequire} from 'node:module';
import {existsSync,mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
const root=dirname(createRequire(import.meta.url).resolve('@yunzhijia/cli/package.json'));
const binary=join(root,'bin',process.platform==='win32'?'yzj-cli.exe':'yzj-cli');
if(!existsSync(binary)){
 const isolatedHome=mkdtempSync(join(tmpdir(),'kteam-cli-installer-'));
 try{execFileSync(process.execPath,[join(root,'scripts/install.js')],{stdio:'inherit',env:{...process.env,HOME:isolatedHome,USERPROFILE:isolatedHome,ELECTRON_RUN_AS_NODE:'1'}});}finally{rmSync(isolatedHome,{recursive:true,force:true});}
}
const version=JSON.parse(readFileSync(join(root,'package.json'),'utf8')).version;
const actual=execFileSync(binary,['--version'],{encoding:'utf8',timeout:15000}).trim();
if(actual!==`yzj-cli ${version}`)throw Error(`Bundled CLI version mismatch: ${actual}`);
console.log(`Bundled ${actual} (${process.platform}-${process.arch})`);
