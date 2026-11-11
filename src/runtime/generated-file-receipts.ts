import {createHash} from 'node:crypto';
import {isAbsolute,basename,resolve,sep} from 'node:path';
import {generatedFileExtension} from './generated-file-policy.js';
import {KTeamError} from '../errors.js';
import type {TeamStore} from '../service/team-store.js';
const names=new Set(['mcp__report-renderer__render_report','mcp__slide-renderer__render_slide','write','edit']);
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Persist original successful tool effects before the bounded readable trace can evict them. */
export function recordGeneratedFile(store:TeamStore,job:any,event:any){
 if(!['completed','committed'].includes(event.state)||!event.file||!names.has(event.name))return;
 const file=event.file;if(typeof event.id!=='string'||!/^[A-Za-z0-9_.:-]{1,256}$/.test(event.id)||file.roomId!==job.roomId||typeof file.path!=='string'||!isAbsolute(file.path)||!generatedFileExtension(file.path)||file.path===resolve(store.root)||file.path.startsWith(resolve(store.root)+sep)||file.name!==basename(file.path)||typeof file.hostId!=='string'||!Number.isSafeInteger(file.bytes)||file.bytes<0||file.bytes>20*1024*1024||!/^[a-f0-9]{64}$/.test(file.sha256))throw new KTeamError('generated_file_receipt_invalid',409);
 const id='generated-file:'+digest([job.roomId,job.id,event.id]),facts={roomId:job.roomId,jobId:job.id,toolCallId:event.id,toolName:event.name,file},prior=store.operation(id);
 if(prior){if(digest(prior.facts)!==digest(facts))throw new KTeamError('generated_file_receipt_changed',409);return;}
 const parsed=Date.parse(event.finishedAt??event.completedAt??job.createdAt),createdAt=Number.isSafeInteger(parsed)&&parsed>0?parsed:Date.now();
 store.saveOperation({id,status:'recorded',roomId:job.roomId,toolCallId:event.id,botId:event.botId??job.activeBotId,taskRef:job.task?.taskRef,createdAt,facts},0);
}
export function backfillGeneratedFiles(store:TeamStore){
 let cursor=store.state<any>('generated-file-backfill:v1')??{row:0,index:-1};if(cursor.done)return;
 for(;;){const page=store.generatedFileSources(cursor.row,cursor.index);if(!page.length){store.setState('generated-file-backfill:v1',{...cursor,done:true});return;}
  store.transaction(()=>{for(const source of page){try{recordGeneratedFile(store,{id:source.id,roomId:source.room_id,createdAt:source.created_at,activeBotId:source.bot_id,task:{taskRef:source.task_ref}},source.event);}catch(error){if(!(error instanceof KTeamError)||!['generated_file_receipt_invalid','generated_file_receipt_changed'].includes(error.code))throw error;store.setState('generated-file-history-warning:'+source.room_id,true);}cursor={row:Number(source.source_row),index:Number(source.source_index)};}store.setState('generated-file-backfill:v1',cursor);});
 }
}
export function generatedFileRecords(store:TeamStore,roomId:string,cursor?:string){
 let before:{at:number;id:string}|undefined;if(cursor!==undefined){try{if(cursor.length>256)throw Error();const value=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'));if(!Number.isSafeInteger(value.at)||value.at<1||typeof value.id!=='string'||!/^generated-file:[a-f0-9]{64}$/.test(value.id))throw Error();before=value;}catch{throw new KTeamError('generated_file_cursor_invalid');}}
 backfillGeneratedFiles(store);const records=store.generatedFileRecords(roomId,before),page=records.slice(0,20),last=page.at(-1);
 return {ok:true,historyIncomplete:!!store.state('generated-file-history-warning:'+roomId),items:page.map(record=>{const job=store.job(record.facts.jobId),result=job?.results?.find((item:any)=>item.botId===record.botId);return {id:record.id,toolCallId:record.toolCallId,jobId:record.facts.jobId,botId:record.botId,taskRef:record.taskRef,name:record.facts.file.name,bytes:record.facts.file.bytes,sha256:record.facts.file.sha256,hostId:record.facts.file.hostId,createdAt:record.createdAt,workState:job?.state??'unknown',resultMessageId:result?.messageId};}),nextCursor:records.length>20&&last?Buffer.from(JSON.stringify({at:last.createdAt,id:last.id})).toString('base64url'):undefined};
}
