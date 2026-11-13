import {spawn,execFile} from 'node:child_process';
/** Host-private bounded command. Cancellation follows physical close of the owned child. */
export function connectorCommand(command:string,args:string[],signal?:AbortSignal,timeoutMs=20000):Promise<{code:number|null;stdout:string;stderr:string}>{
 signal?.throwIfAborted();return new Promise((resolve,reject)=>{const grouped=process.platform!=='win32',child=spawn(command,args,{shell:false,detached:grouped,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}});let stdout='',stderr='',failure:Error|undefined,force:ReturnType<typeof setTimeout>|undefined;
 const stop=()=>{failure??=Error('connector_command_cancelled');if(grouped&&child.pid){try{process.kill(-child.pid,'SIGTERM');}catch{}}else if(child.pid){execFile('taskkill.exe',['/pid',String(child.pid),'/t','/f'],()=>{});}force??=setTimeout(()=>{if(grouped&&child.pid)try{process.kill(-child.pid,'SIGKILL');}catch{}},1000);};
 const collect=(key:'stdout'|'stderr',chunk:Buffer)=>{if(stdout.length+stderr.length+chunk.length>65536){failure=Error('connector_output_limit');stop();return;}if(key==='stdout')stdout+=chunk.toString();else stderr+=chunk.toString();};child.stdout.on('data',c=>collect('stdout',c));child.stderr.on('data',c=>collect('stderr',c));child.once('error',error=>{failure=error;});
 const timer=setTimeout(()=>{failure=Error('connector_command_timeout');stop();},timeoutMs);signal?.addEventListener('abort',stop,{once:true});if(signal?.aborted)stop();child.once('close',code=>{clearTimeout(timer);clearTimeout(force);signal?.removeEventListener('abort',stop);if(failure)reject(failure);else resolve({code,stdout,stderr});});
 });
}
