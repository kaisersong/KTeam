import {createHash} from 'node:crypto';
import {handoffChildJob,handoffChildReceipt} from './work-handoffs.js';
import type {GroupConversationPlan} from './group-conversation.js';
import type {TeamStore} from './team-store.js';
import {textPrefix} from '../protocol/text.js';
import {dispatchEvidenceView} from '../protocol/work-dispatch-evidence.js';
import type {DatabaseSync} from 'node:sqlite';
const string=(value:any,max:number)=>typeof value==='string'?textPrefix(value,max):undefined;
/** Lightweight display of original jobs. Detailed previews remain on demand. */
export function projectWork(job:any,revision=0){
 const events:ReturnType<typeof projectWorkEvent>[]=(Array.isArray(job.toolTrace)?job.toolTrace:[]).slice(-20).map(projectWorkEvent);
 const lastProgress=[...events].reverse().find(event=>event.state!=='failed'&&event.type!=='run_aborted');
 return {dispatchEvidence:dispatchEvidenceView(job.dispatchEvidence),groupPlanAvailable:job.groupPlanAvailable===true||job.groupPlanAvailable===1||job.groupPlan?.mode==='work',peerReviewVersion:job.artifactPeerReview?.sha256,
  workEvidenceAvailable:job.workEvidenceAvailable===true||job.workEvidenceAvailable===1||!!job.workEvidence?.length, id:job.id,roomId:job.roomId,originId:job.originId,codexDispatch:job.codexDispatch?{botId:job.codexDispatch.botId,path:job.codexTargetDirectory??job.codexDispatch.path,allowWrite:job.codexDispatch.allowWrite}:undefined,state:job.state,reason:string(job.reason,512),createdAt:job.createdAt,finishedAt:job.finishedAt,stopNotice:job.stopCause&&['stopped','blocked','unknown'].includes(job.state)?{cause:job.stopCause,at:job.finishedAt,lastProgressAt:lastProgress?.finishedAt??lastProgress?.startedAt??job.claimedAt,confirmed:job.state!=='unknown'&&!job.stopResultUnknown&&!['native_stop_unconfirmed','harness_runtime_close_failed'].includes(job.failure?.code)}:undefined,activeBotId:job.activeBotId,members:(job.members??[]).slice(0,10),calls:job.calls,trigger:job.trigger,needsReview:job.needsReview,task:job.task?{taskRef:job.task.taskRef,revision:job.task.revision}:undefined,results:(job.results??[]).slice(-10).map((result:any)=>({botId:result.botId,messageId:result.messageId,taskRef:result.taskRef,model:result.model})),partialText:string(job.partialText,2000),partialTextTruncated:typeof job.partialText==='string'&&job.partialText.length>2000,cardsAvailable:!!job.cardsAvailable||!!job.cards?.length,answerDraftAvailable:!!job.answerDraftAvailable||!!job.answerDraft,routine:job.routine,execution:job.execution,failure:job.failure,handoffPauseEventIds:job.handoffPauseEventIds,handoffWait:job.handoffWait,generatedFiles:job.generatedFiles??[],toolTrace:events,toolTraceTotal:job.toolTraceTotal??job.toolTrace?.length??0,toolTraceLimited:(job.toolTrace?.length??0)>20||job.toolTraceLimited===true,viewRevision:revision,detailsAvailable:true};
}

export function workPage(db:DatabaseSync,roomId:string,before?:number,activeOnly=false){const rows=db.prepare("SELECT j.rowid AS source_row,coalesce(v.revision,0) AS view_revision,json_object('id',j.id,'roomId',j.room_id,'originId',j.origin_id,'dispatchEvidence',json_extract(j.value_json,'$.dispatchEvidence'),'codexTargetDirectory',json_extract(j.value_json,'$.codexTargetDirectory'),'codexDispatch',json_extract(j.value_json,'$.codexDispatch'),'state',j.state,'reason',substr(json_extract(j.value_json,'$.reason'),1,512),'createdAt',json_extract(j.value_json,'$.createdAt'),'finishedAt',json_extract(j.value_json,'$.finishedAt'),'claimedAt',json_extract(j.value_json,'$.claimedAt'),'stopCause',json_extract(j.value_json,'$.stopCause'),'stopResultUnknown',json_extract(j.value_json,'$.stopResultUnknown'),'activeBotId',json_extract(j.value_json,'$.activeBotId'),'members',json_extract(j.value_json,'$.members'),'calls',json_extract(j.value_json,'$.calls'),'trigger',json_extract(j.value_json,'$.trigger'),'needsReview',json_extract(j.value_json,'$.needsReview'),'task',json_extract(j.value_json,'$.task'),'handoffWait',json_extract(j.value_json,'$.handoffWait'),'execution',json_extract(j.value_json,'$.execution'),'failure',json_extract(j.value_json,'$.failure'),'handoffPauseEventIds',json_extract(j.value_json,'$.handoffPauseEventIds'),'routine',json_extract(j.value_json,'$.routine'),'artifactPeerReview',json_extract(j.value_json,'$.artifactPeerReview'),'groupPlanAvailable',json_extract(j.value_json,'$.groupPlan.mode')='work','workEvidenceAvailable',json_type(j.value_json,'$.workEvidence')='array','cardsAvailable',coalesce(json_array_length(j.value_json,'$.cards'),0)>0,'answerDraftAvailable',json_type(j.value_json,'$.answerDraft')='text') AS compact_json,json_array_length(j.value_json,'$.toolTrace') AS trace_count,(SELECT coalesce(json_group_array(json_object('id',json_extract(e.value,'$.id'),'type',json_extract(e.value,'$.type'),'name',json_extract(e.value,'$.name'),'state',json_extract(e.value,'$.state'),'botId',json_extract(e.value,'$.botId'),'startedAt',json_extract(e.value,'$.startedAt'),'finishedAt',json_extract(e.value,'$.finishedAt'),'code',substr(json_extract(e.value,'$.code'),1,256),'file',json_extract(e.value,'$.file'),'outputAvailable',json_type(e.value,'$.output')='object')), '[]') FROM (SELECT value FROM json_each(j.value_json,'$.toolTrace') ORDER BY key DESC LIMIT 20) e) AS trace_json,(SELECT coalesce(json_group_array(json_object('botId',json_extract(r.value,'$.botId'),'messageId',json_extract(r.value,'$.messageId'),'taskRef',json_extract(r.value,'$.taskRef'),'model',json_extract(r.value,'$.model'))),'[]') FROM (SELECT value FROM json_each(j.value_json,'$.results') ORDER BY key DESC LIMIT 10) r) AS results_json,substr(json_extract(j.value_json,'$.partialText'),1,16000) AS partial_text FROM team_jobs j LEFT JOIN job_view_revisions v ON v.job_id=j.id WHERE j.room_id=?"+(activeOnly?" AND j.state IN ('routing','running','stopping','waiting')":'')+(before!==undefined?' AND j.rowid<?':'')+' ORDER BY j.rowid DESC LIMIT 21').all(roomId,...(before!==undefined?[before]:[]));const page=rows.slice(0,20);return {jobs:page.map(row=>projectWork({...JSON.parse(String(row.compact_json)),generatedFiles:projectGeneratedFiles(db,roomId,JSON.parse(String(row.compact_json)).id),toolTrace:JSON.parse(String(row.trace_json)).reverse(),results:JSON.parse(String(row.results_json)).reverse(),toolTraceTotal:Number(row.trace_count),toolTraceLimited:Number(row.trace_count)>20,partialText:row.partial_text},Number(row.view_revision))),nextBefore:rows.length>20?Number(page.at(-1)!.source_row):undefined};}

export const stageReviewId=(jobId:string,index:number)=>'group-stage-review:'+jobId+':'+index;

export function projectGroupPlan(store:TeamStore,job:any){
 const plan=job.groupPlan as GroupConversationPlan|undefined;
 if(plan?.mode!=='work'||!Array.isArray(plan.stages))return;
 return {
  ownerId:plan.ownerId,
  stages:plan.stages.map((stage,index)=>{
   const operation=plan.stageOperations?.[index]?store.operation(plan.stageOperations[index]!):undefined;
   const owned=operation?.roomId===job.roomId&&operation.jobId===job.id&&operation.botId===plan.ownerId?operation:undefined;
   const requests=stage.requests.map(request=>{
    const child=owned?.children?.find((row:any)=>row.botId===request.botId);
    const childJob=child?handoffChildJob(store,job,child):undefined;
    const receipt=handoffChildReceipt(childJob,request.botId);
    const verified=owned?.status==='returned'&&receipt&&owned.results?.find((item:any)=>item.botId===request.botId&&item.state==='delivered'&&item.roomId===child.roomId&&item.messageId===receipt.messageId);
    const state=childJob?.state==='delivered'&&!receipt?'unknown':childJob?.state;
    return {botId:request.botId,deliverable:request.message,state:state??(child?'unknown':owned?.dispatchFailures?.some((row:any)=>row.botId===request.botId)?'blocked':'unassigned'),
     ...(verified?{evidence:{roomId:child.roomId,messageId:receipt.messageId}}:{})};
   });
   const ready=requests.length>0&&requests.every(request=>request.evidence);
   const witness=ready?createHash('sha256').update(JSON.stringify([owned.id,stage.doneWhen,requests])).digest('hex'):undefined;
   const saved=witness?store.operation(stageReviewId(job.id,index)):undefined;
   const review=saved?.witness===witness&&saved?{decision:saved.decision,note:saved.note,revision:saved.revision}:undefined;
   return {dependsOn:index>0?index:undefined,doneWhen:stage.doneWhen,requests,witness,review};
  }),
 };
}

export function projectWorkEvent(event:any){return {id:string(event.id,256),type:string(event.type,128),name:string(event.name,256),state:string(event.state,32),botId:string(event.botId,256),startedAt:string(event.startedAt,64),finishedAt:string(event.finishedAt,64),code:string(event.code,256),file:event.file?{name:string(event.file.name,256),bytes:event.file.bytes,roomId:string(event.file.roomId,256)}:undefined,outputAvailable:event.outputAvailable===true||event.outputAvailable===1||event.type==='tool_output_saved'&&!!event.output,detailsAvailable:true};}

/** Latest saved version per host/path in this work; original receipts remain intact.
 * Metadata survives trace eviction; paths and file bytes stay in main. */
export function projectGeneratedFiles(db:DatabaseSync,roomId:string,jobId:string){
 return db.prepare("SELECT json_extract(value_json,'$.toolCallId') AS id,json_extract(value_json,'$.botId') AS botId,json_extract(value_json,'$.facts.file.name') AS name,json_extract(value_json,'$.facts.file.bytes') AS bytes FROM (SELECT id,value_json,row_number() OVER (PARTITION BY json_extract(value_json,'$.facts.file.hostId'),json_extract(value_json,'$.facts.file.path') ORDER BY json_extract(value_json,'$.createdAt') DESC,revision DESC,id DESC) AS file_rank FROM product_operations WHERE id GLOB 'generated-file:*' AND json_extract(value_json,'$.roomId')=? AND json_extract(value_json,'$.facts.jobId')=?) WHERE file_rank=1 ORDER BY json_extract(value_json,'$.createdAt'),id").all(roomId,jobId).map(row=>({id:row.id,botId:row.botId,state:'completed',file:{name:row.name,bytes:row.bytes,roomId}}));
}
