import {spawn} from 'node:child_process';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
const timestampFailure=output=>/A timestamp was expected but was not found|timestamp service is not available/i.test(output);
/** Only signing timestamp failures are retried. Every attempt still must sign successfully. */
export async function withSigningTimestampRetry(run,{wait=delay,report=()=>{}}={}){
 for(let attempt=1;attempt<=3;attempt++){
  const result=await run();
  if(result.status===0)return {...result,attempts:attempt};
  if(result.status===null||result.signal||attempt===3||!timestampFailure(result.output??''))return {...result,status:result.status??1,attempts:attempt};
  const milliseconds=attempt*15000;report(`Apple signing timestamp unavailable; retry ${attempt+1}/3 in ${milliseconds/1000}s. Secure timestamps remain required.`);await wait(milliseconds);
 }
 throw Error('signing_retry_state_invalid');
}
function packageMac(projectRoot){return new Promise((resolveRun,reject)=>{
 const args=[join(projectRoot,'node_modules/electron-builder/out/cli/cli.js'),'--projectDir',projectRoot,'--config','electron-builder.yml','--mac','dir','--arm64','--publish','never','-c.mac.forceCodeSigning=true','-c.mac.notarize=false','-c.mac.entitlements='+join(projectRoot,'desktop/assets/entitlements.mac.plist'),'-c.mac.entitlementsInherit='+join(projectRoot,'desktop/assets/entitlements.mac.inherit.plist')];
 const child=spawn(process.execPath,args,{stdio:['ignore','pipe','pipe']});let output='';
 const append=(target,data)=>{target.write(data);output=(output+data.toString()).slice(-2*1024*1024);};child.stdout.on('data',data=>append(process.stdout,data));child.stderr.on('data',data=>append(process.stderr,data));child.once('error',reject);child.once('close',(status,signal)=>resolveRun({status,signal,output}));
});}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const projectRoot=resolve(process.argv[2]??process.cwd());
 try{const result=await withSigningTimestampRetry(()=>packageMac(projectRoot),{report:message=>console.error(message)});process.exitCode=result.status;}catch(error){console.error(error);process.exitCode=1;}
}
