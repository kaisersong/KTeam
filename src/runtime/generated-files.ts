import {createHash} from 'node:crypto';
import {hostname} from 'node:os';
import {extname,basename,sep,resolve} from 'node:path';
import {openSync,closeSync,readFileSync,fstatSync,realpathSync,constants} from 'node:fs';
import {KTeamError} from '../errors.js';
import type {TeamStore} from '../service/team-store.js';

function inspect(path:string,privateRoot:string){
 if(extname(path).toLowerCase()!=='.html'||realpathSync(path)!==path||path===resolve(privateRoot)||path.startsWith(resolve(privateRoot)+sep))throw new KTeamError('generated_file_forbidden',403);
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const stat=fstatSync(fd);if(!stat.isFile()||stat.size>20*1024*1024)throw new KTeamError('generated_file_invalid');return {bytes:stat.size,sha256:createHash('sha256').update(readFileSync(fd)).digest('hex')};}finally{closeSync(fd);}
}
export function captureGeneratedFile(path:string,privateRoot:string,roomId:string){return {path,name:basename(path),roomId,hostId:hostname(),...inspect(path,privateRoot)};}
// Only persisted successful tool receipts authorize opening; model-authored
// Markdown and renderer-supplied paths never grant native file access.
export function generatedFilePath(store:TeamStore,roomId:string,toolCallId:string){
 const event=store.jobs(roomId).flatMap(job=>job.toolTrace??[]).find((e:any)=>e.id===toolCallId&&e.state==='completed'&&['mcp__report-renderer__render_report','mcp__slide-renderer__render_slide'].includes(e.name));
 const file=event?.file;if(!file||file.roomId!==roomId||file.hostId!==hostname())throw new KTeamError('generated_file_not_found',404);
 try{const actual=inspect(file.path,store.root);if(actual.sha256!==file.sha256||actual.bytes!==file.bytes)throw Error();}catch{throw new KTeamError('generated_file_changed',409);}
 return file.path as string;
}
