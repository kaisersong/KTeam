import {join} from 'node:path';
import {existsSync,lstatSync,readFileSync,writeFileSync,renameSync,chmodSync} from 'node:fs';
/** One-time 0.2 → 0.3 notice: services that 0.2 shared with xiaok are not carried over.
 * State lives in KTeam's own data dir (`notices.json`, 0600) so it survives restarts and config rewrites:
 * `pending` once a dropped legacy shared-service key is detected, `dismissed` forever after. */
export type NoticeState='pending'|'dismissed';
const FILE='notices.json',KEY='legacySharedServices';
const file=(root:string)=>join(root,FILE);
function read(root:string):Record<string,unknown>{
 const path=file(root);if(!existsSync(path))return {};
 const fact=lstatSync(path);if(!fact.isFile()||fact.isSymbolicLink()||fact.size>16*1024)return {};
 try{const value=JSON.parse(readFileSync(path,'utf8'));return value&&typeof value==='object'&&!Array.isArray(value)?value:{};}catch{return {};}
}
function write(root:string,state:NoticeState){
 const next={...read(root),[KEY]:state},temporary=file(root)+'.'+process.pid+'.tmp';
 writeFileSync(temporary,JSON.stringify(next),{mode:0o600});chmodSync(temporary,0o600);renameSync(temporary,file(root));
}
export function legacySharedNoticeState(root:string):NoticeState|undefined{const value=read(root)[KEY];return value==='pending'||value==='dismissed'?value:undefined;}
/** Called by the config loader when it drops the legacy shared-service key. Never throws: a notice must not block startup. */
export function recordLegacySharedServicesDropped(root:string){
 try{if(legacySharedNoticeState(root)===undefined)write(root,'pending');}catch(error){process.emitWarning('KTeam could not record the 0.3 shared-service notice: '+String((error as Error)?.message??error),{code:'KTEAM_NOTICE_WRITE_FAILED'});}
}
export const legacySharedNoticeView=(root:string)=>({ok:true,show:legacySharedNoticeState(root)==='pending'});
export function dismissLegacySharedNotice(root:string){if(legacySharedNoticeState(root)==='pending')write(root,'dismissed');return legacySharedNoticeView(root);}
