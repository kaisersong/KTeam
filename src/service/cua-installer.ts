import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {sharedRuntime} from '../runtime/native.js';
import {KTeamError} from '../errors.js';
// Same official macOS installer used by xiaok's CUA_DRIVER_DEPENDENCY.
const INSTALLER='https://raw.githubusercontent.com/trycua/cua/main/libs/cua-driver/scripts/install.sh';
export async function installCuaDriver(signal:AbortSignal){
 if(process.platform!=='darwin')throw new KTeamError('cua_macos_required');
 const response=await fetch(INSTALLER,{signal:AbortSignal.any([signal,AbortSignal.timeout(30000)])});
 if(!response.ok||!response.body)throw new KTeamError('cua_install_failed',502);
 const chunks:Uint8Array[]=[];let bytes=0;
 for await(const chunk of response.body){bytes+=chunk.length;if(bytes>2*1024*1024){await response.body.cancel().catch(()=>{});throw new KTeamError('cua_install_failed',502);}chunks.push(chunk);}
 const root=await mkdtemp(join(tmpdir(),'kteam-cua-'));
 try{const file=join(root,'install.sh');await writeFile(file,Buffer.concat(chunks),{mode:0o600,flag:'wx'});signal.throwIfAborted();
 const core=await sharedRuntime(),result=await core.runDependencyProcess('/bin/bash',[file],{signal,timeoutMs:120000,maxOutputBytes:1024*1024});if(!result.success)throw new KTeamError('cua_install_failed',502);
 }finally{await rm(root,{recursive:true,force:true});}
}
