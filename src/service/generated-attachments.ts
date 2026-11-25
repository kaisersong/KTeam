import {createHash} from 'node:crypto';
import {extname} from 'node:path';
import {KTeamError} from '../errors.js';
import {ATTACHMENT_EXTENSIONS,artifactReplyAttachment,type MessageAttachment} from '../protocol/message-attachments.js';
import {generatedFileBytes} from '../runtime/generated-files.js';
import type {Upstreams} from '../adapters/upstream.js';
import type {ConversationService} from './conversation.js';
import {findOwnerMessage} from './room-reads.js';
import type {TeamStore} from './team-store.js';

const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const renderers=new Set(['mcp__report-renderer__render_report','mcp__slide-renderer__render_slide']);
function referencesFile(reply:string,path:string){
 const uri=path.startsWith('/')?'file://'+path:'file:///'+path;
 return [path,uri].some(candidate=>{
  const encoded=encodeURI(candidate);
  return [candidate,encoded,encoded.replace(/%[0-9A-F]{2}/g,part=>part.toLowerCase())].some(value=>{
   const escaped=value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
   return new RegExp('(?:^|[\\s(<`])'+escaped+'(?=$|[\\s>)`])','u').test(reply);
  });
 });
}

/** Only a current, same-run file receipt can publish a copy into the Room. */
export async function publishGeneratedAttachments(input:{
 upstream:Upstreams;store:TeamStore;conversations:ConversationService;jobId:string;roomId:string;botId:string;
 replyMessageId:string;replyText:string;admission:Record<string,unknown>;guard:()=>Promise<number|undefined>;
}){
 const {upstream,store,conversations,jobId,roomId,botId,replyMessageId,replyText,admission,guard}=input;
 const delivered:{ref:string;version:number;sha256:string;media_type:string}[]=[];
 const normalizedReply=replyText.replaceAll('\\','/');
 const candidates=store.generatedFilesForJob(roomId,jobId).filter(record=>record.botId===botId)
  .flatMap(record=>{
   const receipt=store.generatedFilesForTool(roomId,String(record.id))[0];
   const file=receipt?.facts.file;
   if(receipt?.facts.jobId!==jobId||receipt.botId!==botId||typeof file?.path!=='string'
    ||file.bytes>4*1024*1024||!ATTACHMENT_EXTENSIONS.has(extname(file.path).slice(1).toLowerCase()))return [];
   const path=file.path.replaceAll('\\','/');
   return referencesFile(normalizedReply,path)||renderers.has(receipt.facts.toolName)?[String(record.id)]:[];
  });
 if(!candidates.length)return delivered;
 const capabilities=await upstream.aimp(roomId,'status').then(result=>result.capabilities as string[]|undefined).catch(()=>undefined);
 if(!capabilities?.includes('room-artifact-reply-v1'))return delivered;

 const sentFileIds=new Set<string>();
 for(const toolCallId of candidates.slice(0,8)){
  try{
   const importRevision=await guard();
   if(importRevision===undefined)break;
   await upstream.aimp(roomId,'execution-check',admission);
   const {name,data}=generatedFileBytes(store,roomId,toolCallId);
   const imported=await conversations.importFile(roomId,{name,data:data.toString('base64')},importRevision);
   const file=imported.file as MessageAttachment;
   if(file?.name!==name||file?.sha256!==hash(data)||file.bytes!==data.length||sentFileIds.has(file.fileId))continue;
   const expectedRoomRevision=await guard();
   if(expectedRoomRevision===undefined)break;
   const matches=(message:any)=>message?.roomId===roomId&&message.sender?.logicalAgentId===botId
    &&message.sourceRef?.taskRef===admission.taskRef&&message.sourceRef.artifactReplyMessageId===replyMessageId
    &&artifactReplyAttachment(message)?.attachments[0]?.sha256===file.sha256
    &&message.sourceRef.artifactFileId===file.fileId;
   let message;
   try{
    message=(await upstream.aimp(roomId,'chat',{...admission,expectedRoomRevision,artifact:{fileId:file.fileId,replyMessageId}})).message;
   }catch(error){
    if(!(error instanceof KTeamError)||error.code!=='upstream_operation_unknown')throw error;
    message=await findOwnerMessage(upstream,roomId,matches);
   }
   if(matches(message)){
    sentFileIds.add(file.fileId);
    delivered.push({ref:`message://${roomId}/${message.messageId}`,version:1,sha256:hash(message.text),media_type:'text/plain'});
   }
  }catch{/* The original reply and file receipts stay available. Unknown sends are observed only. */}
 }
 return delivered;
}
