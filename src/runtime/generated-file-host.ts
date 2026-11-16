import {hostname} from 'node:os';
import {execFileSync} from 'node:child_process';
import {TeamStore} from '../service/team-store.js';
const identities=new Map<string,string>();
export function generatedFileHost(root:string){
 let id=identities.get(root);
 if(!id){const store=new TeamStore(root);try{id='installation:'+store.installationId();}finally{store.close();}identities.set(root,id);}
 return id;
}
/** Old receipts used the mutable Bonjour hostname. Keep only this Mac's configured name as a legacy alias. */
export function matchesGeneratedFileHost(recorded:string,installation:string,current:string,computerName?:string){
 if(recorded===installation || recorded===current)return true;
 if(recorded.startsWith('installation:')||!computerName)return false;
 const configured=computerName.trim().replace(/\s+/g,'-')+'.local';
 return recorded.toLowerCase()===configured.toLowerCase();
}
let computerName:string|undefined;
function configuredName(){
 if(!computerName && process.platform==='darwin')try{computerName=execFileSync('/usr/sbin/scutil',['--get','ComputerName'],{encoding:'utf8',timeout:3000}).trim();}catch(error:any){console.warn(JSON.stringify({event:'artifact_hostname_lookup_failed',code:error?.code??'unknown'}));}
 return computerName;
}
export function localGeneratedFileHost(recorded:string,root:string){
 const current=hostname(),name=configuredName(),match=matchesGeneratedFileHost(recorded,generatedFileHost(root),current,name);
 if(!match)console.warn(JSON.stringify({event:'artifact_host_mismatch',recorded,current,configured:name}));
 return match;
}
