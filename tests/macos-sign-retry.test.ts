import {test} from 'node:test';import assert from 'node:assert/strict';
const {withSigningTimestampRetry}=await import(new URL('../../scripts/package-signed-mac.mjs',import.meta.url).href);
test('signing retries a transient Apple timestamp failure but never retries a certificate error',async()=>{
 let calls=0;const waits:number[]=[],result=await withSigningTimestampRetry(async()=>++calls===1?{status:1,output:'A timestamp was expected but was not found.'}:{status:0,output:'signed'},{wait:async(ms:number)=>{waits.push(ms);}});assert.equal(result.status,0);assert.equal(calls,2);assert.deepEqual(waits,[15000]);
 calls=0;const denied=await withSigningTimestampRetry(async()=>{calls++;return {status:1,output:'certificate is not trusted'};},{wait:async()=>{assert.fail('must not retry certificate errors');}});assert.equal(denied.status,1);assert.equal(calls,1);
});
test('persistent timestamp failures remain failed after three attempts and cancellation never starts another signer',async()=>{
 let calls=0;const waits:number[]=[],result=await withSigningTimestampRetry(async()=>{calls++;return {status:1,output:'timestamp service is not available'};},{wait:async(ms:number)=>{waits.push(ms);}});assert.equal(result.status,1);assert.equal(calls,3);assert.deepEqual(waits,[15000,30000]);
 calls=0;const cancelled=await withSigningTimestampRetry(async()=>{calls++;return {status:null,signal:'SIGTERM',output:'A timestamp was expected but was not found'};},{wait:async()=>{assert.fail('cancelled signer must not restart');}});assert.equal(cancelled.status,1);assert.equal(calls,1);
});


test('standalone signer executes through a directory alias while retaining the isolated signing cwd',async()=>{
 const {privateTempDir}=await import('./helpers/private-temp.js'),{tmpdir}=await import('node:os'),{join,resolve}=await import('node:path'),{mkdirSync,copyFileSync,symlinkSync,realpathSync,readFileSync,rmSync,writeFileSync}=await import('node:fs'),{spawnSync}=await import('node:child_process');
 const root=realpathSync(privateTempDir(join(tmpdir(),'kteam-sign-entry-')));try{
  const scripts=join(root,'scripts'),alias=join(root,'linked-scripts'),project=join(root,'project'),cwd=join(root,'signing-cwd'),cli=join(project,'node_modules/electron-builder/out/cli');for(const path of [scripts,cwd,cli])mkdirSync(path,{recursive:true});copyFileSync(resolve('scripts/package-signed-mac.mjs'),join(scripts,'package-signed-mac.mjs'));symlinkSync(scripts,alias,process.platform==='win32'?'junction':'dir');
  writeFileSync(join(cli,'cli.js'),`const fs=require('node:fs'),path=require('node:path'),root=process.argv[process.argv.indexOf('--projectDir')+1];fs.writeFileSync(path.join(root,'probe.json'),JSON.stringify({cwd:process.cwd(),args:process.argv.slice(2)}));`);
  const result=spawnSync(process.execPath,[join(alias,'package-signed-mac.mjs'),project],{cwd,encoding:'utf8'});assert.equal(result.status,0,result.stderr);const proof=JSON.parse(readFileSync(join(project,'probe.json'),'utf8'));assert.equal(realpathSync(proof.cwd),realpathSync(cwd));assert.ok(proof.args.includes('-c.mac.forceCodeSigning=true'));assert.ok(proof.args.includes('-c.mac.entitlements='+join(project,'desktop/assets/entitlements.mac.plist')));
 }finally{rmSync(root,{recursive:true,force:true});}
});
