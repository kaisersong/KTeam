import {userInfo,hostname} from 'node:os';
import {execFileSync} from 'node:child_process';
const usable=(value:unknown)=>typeof value==='string'?Array.from(value.trim().replace(/[\x00-\x1f\x7f]/g,'')).slice(0,40).join(''):'';
/** OS account name first; ComputerName/hostname is the fallback, never a hardcoded personal name. */
export function systemDisplayName(username:()=>unknown=()=>userInfo().username,computerName:()=>unknown=()=>{if(process.platform==='darwin'){try{return execFileSync('/usr/sbin/scutil',['--get','ComputerName'],{encoding:'utf8',timeout:1000,stdio:['ignore','pipe','ignore']});}catch{}}return hostname();}){try{const name=usable(username());if(name)return name;}catch{}try{const name=usable(computerName());if(name)return name;}catch{}return 'KTeam 用户';}
