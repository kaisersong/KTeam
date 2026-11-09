import {startHost} from '../src/service/server.js';
import {dataRoot,loadConfig,upstreamOptions} from '../src/service/config.js';
import {ensureSharedServices} from '../src/runtime/services.js';
async function main(){
 const root=dataRoot();
 const config=loadConfig(root);
 try{await ensureSharedServices(config);}catch{process.stdout.write(JSON.stringify({event:'shared-service-owner-unavailable'})+'\n');}
 const host=await startHost({root,upstream:upstreamOptions(config)});
 process.stdout.write(JSON.stringify({event:'kteam-host-ready',pid:process.pid,epoch:host.epoch})+'\n');
 let closing=false;
 for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{if(closing)return;closing=true;void host.close().then(()=>{process.exitCode=0;},()=>{process.exitCode=1;});});
}
void main().catch(error=>{process.stderr.write(JSON.stringify({event:'kteam-host-failed',code:error?.code??'host_start_failed'})+'\n');process.exitCode=1;});
