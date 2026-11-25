import {stageStatus} from '../../../src/protocol/conversation-work';
import {FileText} from 'lucide-react';
import {showGeneratedFile} from './artifact-viewer';
import {Markdown,type MessageFile} from './Markdown';
import {useEffect,useState,type ComponentProps} from 'react';
import {activityStateLabels} from '../../../src/protocol/activity-records';
import {api,explain,type Bot} from './api';
import {MessageRow} from './components';
import {RuntimeMessageContent} from './harness-status';

type Identity={roomId:string;jobId?:string;messageId?:string;eventId?:string;part?:'summary'|'draft'|'cards'};
export function useRecord(identity:Identity,enabled:boolean,revision?:number){
 const [data,setData]=useState<{key:string;value:any}>(),[error,setError]=useState(''),[loading,setLoading]=useState(false),[attempt,setAttempt]=useState(0),key=JSON.stringify(identity);
 useEffect(()=>{if(!enabled)return;let live=true;setLoading(true);setError('');void api.workRecord(identity).then(value=>{if(live)setData({key,value});}).catch(error=>{if(live){if(['team_scope_changed','work_record_not_found','work_event_not_recorded','conversation_not_managed'].includes(error instanceof Error?error.message:String(error)))setData(undefined);setError(explain(error));}}).finally(()=>{if(live)setLoading(false);});return()=>{live=false;};},[key,enabled,revision,attempt]);
 return {data:data?.key===key?data.value:undefined,error,loading,retry:()=>setAttempt(value=>value+1)};
}
function ReadState({read}:{read:ReturnType<typeof useRecord>}){return <>{read.loading&&<p className="muted" role="status">正在读取原记录…</p>}{read.error&&<p className="flow-error" role="alert">{read.error}<button type="button" className="text-button" onClick={read.retry}>重新读取</button></p>}</>;}
const preview=(value:any)=>typeof value==='string'?value:JSON.stringify(value,null,2);
export function EventRecord({roomId,jobId,event,revision}:{roomId:string;jobId:string;event:any;revision?:number}){
 const [open,setOpen]=useState(false),read=useRecord({roomId,jobId,eventId:event.id},open,revision),detail=read.data?.event;
 return <details className="activity-event" onToggle={event=>setOpen(event.currentTarget.open)}><summary><strong>{event.name??event.type??'事件'}{event.type==='tool_output_saved'?' · 输出已保存':''}</strong><small>{event.type==='tool_output_saved'?'已保存':event.state==='completed'?'已返回':event.state==='running'?'执行中':event.state==='waiting'?'等待结果':'未完成'}</small></summary><ReadState read={read}/>{detail&&<><dl><dt>开始</dt><dd>{detail.startedAt?new Date(detail.startedAt).toLocaleString():'时间未记录'}</dd><dt>结束</dt><dd>{detail.finishedAt?new Date(detail.finishedAt).toLocaleString():'时间未记录'}</dd></dl>{detail.input!==undefined&&<><h4>参数记录</h4><pre>{preview(detail.input)}</pre></>}{detail.result!==undefined&&<><h4>返回记录</h4><pre>{preview(detail.result)}</pre></>}{detail.outputAvailable&&<FullToolOutput key={event.id} roomId={roomId} jobId={jobId} eventId={event.id}/>} {detail.code&&<p className="flow-error">{explain(detail.code)}</p>}{read.data?.previewTruncated&&<p className="muted">此处为已保存记录的有限预览。</p>}</>}</details>;
}
function FullToolOutput({roomId,jobId,eventId}:{roomId:string;jobId:string;eventId:string}){
 const[open,setOpen]=useState(false);return <section className="full-tool-output"><button type="button" className="text-button" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>{open?'收起完整输出':'读取完整输出'}</button>{open&&<ToolOutputPage roomId={roomId} jobId={jobId} eventId={eventId}/>}</section>;
}
function ToolOutputPage({roomId,jobId,eventId}:{roomId:string;jobId:string;eventId:string}){
 const[offset,setOffset]=useState(0),[trail,setTrail]=useState<number[]>([]),[data,setData]=useState<any>(),[error,setError]=useState(''),[loading,setLoading]=useState(false),[attempt,setAttempt]=useState(0);
 useEffect(()=>{let live=true;setData(undefined);setError('');setLoading(true);void api.toolOutput({roomId,jobId,eventId,offset}).then(value=>{if(live)setData(value);}).catch(error=>{if(live){setData(undefined);setError(explain(error));}}).finally(()=>{if(live)setLoading(false);});return()=>{live=false;};},[roomId,jobId,eventId,offset,attempt]);
 return <>{loading&&<p className="muted" role="status">正在核验完整输出…</p>}{error&&<p className="flow-error" role="alert">{error}<button type="button" className="text-button" onClick={()=>setAttempt(value=>value+1)}>重新读取</button></p>}{data&&<><p className="muted">已保存输出 {data.originalBytes.toLocaleString()} 字节 · 当前第 {(trail.length+1).toLocaleString()} 段{data.redacted?' · 已脱敏':''}</p><pre>{data.text}</pre><p className="muted">此处为原运行器保存的返回正文；工具自身可能限制了输出范围。</p><div className="activity-pager"><button type="button" className="text-button" disabled={!trail.length} onClick={()=>{setOffset(trail.at(-1)!);setTrail(value=>value.slice(0,-1));}}>上一段</button><button type="button" className="text-button" disabled={!data.hasMore} onClick={()=>{setTrail(value=>[...value,offset]);setOffset(data.nextOffset);}}>下一段</button></div></>}</>;
}
function FileEffect({roomId,event}:{roomId:string;event:any}){const[error,setError]=useState('');return <div><button type="button" className="secondary" onClick={()=>{setError('');void showGeneratedFile({roomId,toolCallId:event.id}).catch(error=>setError(explain(error)));}}><FileText size={16} strokeWidth={1.6} aria-hidden="true"/>打开 {event.file.name}</button>{error&&<p className="flow-error" role="alert">{error}</p>}</div>;}
export function GroupPlanRecord({plan,bots,roomId,jobId,onReviewed}:{plan:any;bots:Bot[];roomId:string;jobId:string;onReviewed:()=>void}){
 const [detail,setDetail]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[notes,setNotes]=useState<Record<number,string>>({});
 async function run(action:()=>Promise<void>){setError('');setBusy(true);try{await action();}catch(error){setError(explain(error));}finally{setBusy(false);}}
 function review(stage:any,index:number,decision:'pass'|'rework'){
  return run(async()=>{await api.reviewStage({roomId,jobId,index,decision,witness:stage.witness,expectedRevision:stage.review?.revision??0,...(decision==='rework'?{note:notes[index]?.trim()}: {})});onReviewed();});
 }
 if(!plan)return null;
 const name=(id:string)=>bots.find(bot=>bot.id===id)?.name??'原成员';
 return <section className="workspace-section" aria-label="群计划">
  <p>负责人 · {name(plan.ownerId)}</p>
  {error&&<p className="flow-error" role="alert">{error}</p>}
  {detail&&<div className="workspace-section"><button type="button" onClick={()=>setDetail('')}>关闭证据</button><Markdown text={detail}/></div>}
  <ol>{plan.stages.map((stage:any,index:number)=><li key={index}>
   <strong>阶段 {index+1} · {stageStatus(stage)}</strong>
   <p>{stage.dependsOn?('依赖阶段 '+stage.dependsOn):'可先开始'}{stage.requests.length>1?' · 本阶段可并行':''}</p>
   <ul>{stage.requests.map((request:any)=><li key={request.botId}>
    <strong>{name(request.botId)} · {request.state==='unassigned'?'待派发':activityStateLabels[request.state]??request.state}</strong>
    <p>{request.deliverable}</p>
    {request.evidence&&<button type="button" disabled={busy} onClick={()=>void run(async()=>setDetail((await api.stageEvidence({roomId,jobId,index,botId:request.botId})).text))}>查看交付证据</button>}
   </li>)}</ul>
   <p className="muted">验收条件 · {stage.doneWhen}</p>
   {stage.review?.note&&<p>{stage.review.note}</p>}
   {stage.witness&&<div className="conversation-work-actions">
    <button type="button" disabled={busy||stage.review?.decision==='pass'} onClick={()=>void review(stage,index,'pass')}>验收通过</button>
    <input aria-label="返工原因" placeholder="返工原因" maxLength={1200} value={notes[index]??''} onChange={event=>setNotes(value=>({...value,[index]:event.target.value}))}/>
    <button type="button" disabled={busy||!notes[index]?.trim()} onClick={()=>void review(stage,index,'rework')}>标记返工</button>
   </div>}
  </li>)}</ol>
 </section>;
}
export function WorkEvidence({record,botId}:{record:any;botId?:string}){
 const rows=(record.workEvidence??[]).filter((entry:any)=>!botId||entry.botId===botId);
 if(!rows.length)return null;
 const files=rows.filter((entry:any)=>entry.kind==='file');
 const commands=rows.filter((entry:any)=>entry.kind==='command');
 return <section className="workspace-section" aria-label="本轮变更与检查">
  <h4>本轮变更与检查</h4>
  {files.length>0&&<ul>{files.map((entry:any)=><li key={entry.id}>{entry.operation==='edit'?'编辑':entry.beforeSha256===null?'新增':entry.beforeSha256?'覆盖':'写入'} · <code>{entry.path}</code>{entry.afterSha256&&<> · <code title={entry.afterSha256}>{entry.afterSha256.slice(0,12)}</code></>}</li>)}</ul>}
  {commands.length>0&&<p>终端退出记录 · {commands.map((entry:any)=>entry.exitCode===null?'未确认':('退出码 '+entry.exitCode)).join('、')}</p>}
  <p className="muted">{record.workEvidenceLimited?'只显示最近 40 条宿主回执。':''}仅涵盖内置运行时已观测的写入与命令退出，终端造成的文件改动及外部 Agent 的改动需另行核对。</p>
 </section>;
}
export function ConversationMessage({job,onReading,attachedFiles,...row}:ComponentProps<typeof MessageRow>&{job?:any;attachedFiles?:MessageFile[];onReading?:(id:string,open:boolean)=>void}){
 const roomId=row.message.roomId!,messageId=row.message.messageId;
 const groupPlan=row.message.sender.kind==='user'&&job?.groupPlanAvailable;
 const [open,setOpen]=useState(false);
 const summary=useRecord({roomId,...(groupPlan?{jobId:job.id}:{messageId}),part:'summary'},open,job?.viewRevision);
 const record=summary.data?.job;
 useEffect(()=>()=>onReading?.(messageId,false),[messageId,onReading]);
 const cardRead=useRecord({roomId,messageId,part:'cards'},!!job?.cardsAvailable||open&&record?.cardsAvailable===true,job?.viewRevision),cards=cardRead.data?.previewTruncated?[]:(cardRead.data?.job?.cards??[]).filter((card:any)=>card.botId===row.message.sender.logicalAgentId);
 if(groupPlan)return <><MessageRow {...row}/><details className="tool-trace" onToggle={event=>setOpen(event.currentTarget.open)}>
  <summary>群计划</summary><ReadState read={summary}/><GroupPlanRecord plan={record?.groupPlan} bots={row.bots} roomId={roomId} jobId={job.id} onReviewed={summary.retry}/>
 </details></>;
 const events=record?.toolTrace??job?.toolTrace??[],files=(record?.generatedFiles??job?.generatedFiles??events).filter((event:any)=>event.state==='completed'&&event.file&&event.botId===row.message.sender.logicalAgentId);
 const localFiles=files.filter((event:any)=>!attachedFiles?.some(file=>file.file.name===event.file.name));
 return <><MessageRow {...row} cards={cards} files={attachedFiles?.length?[...attachedFiles,...localFiles]:localFiles}/>{cardRead.data?.previewTruncated&&<p className="muted">交互内容超过预览范围，请查看原交付文件。</p>}{cardRead.error&&<ReadState read={cardRead}/>}{row.message.sender.kind==='agent'&&(job||row.message.workRef)&&<><div className="generated-files">{localFiles.map((event:any)=><FileEffect key={event.id} roomId={roomId} event={event}/>)}</div><details className="tool-trace" onPointerDown={()=>{if(open)onReading?.(messageId,true);}} onFocusCapture={()=>{if(open)onReading?.(messageId,true);}} onToggle={event=>{setOpen(event.currentTarget.open);onReading?.(messageId,event.currentTarget.open);}}><summary>{job?.workEvidenceAvailable?'本轮变更与工具记录':'运行与工具记录'}</summary><ReadState read={summary}/>{job?.peerReviewVersion&&<p className="muted">{record?.peerReviewStale?'产物已更新，复核仅适用于旧版':'版本化只读复核'} · <code title={job.peerReviewVersion}>{job.peerReviewVersion.slice(0,12)}</code></p>}{record&&<><WorkEvidence record={record} botId={row.message.sender.logicalAgentId}/>{record.toolTrace.map((event:any)=><EventRecord key={event.id} roomId={roomId} jobId={record.id} event={event} revision={summary.data.viewRevision}/>)}{record.toolTraceLimited&&<p className="muted">原工作仅保留最近最多 100 条事件，更早步骤可能未保存。</p>}{record.toolTrace.length===0&&<p className="muted">原工作没有已保存的工具事件。</p>}</>}</details></>}</>;
}
export function WorkDraft({roomId,job}:{roomId:string;job:any}){const[open,setOpen]=useState(false),read=useRecord({roomId,jobId:job.id,part:'draft'},open,job.viewRevision);return <details className="draft-result" onToggle={event=>setOpen(event.currentTarget.open)}><summary>未交付草稿</summary><ReadState read={read}/>{read.data&&<><pre>{read.data.job?.answerDraft??'原工作没有已保存的草稿正文。'}</pre>{read.data.previewTruncated&&<small>只显示已保存草稿的有限预览。</small>}</>}</details>;}
export function SharedHistory({roomId,revision}:{roomId:string;revision:number}){const[open,setOpen]=useState(false),[data,setData]=useState<any[]>(),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);useEffect(()=>{if(!open)return;let live=true;setError('');void api.conversationData(roomId).then(value=>{if(live)setData(value.history??[]);}).catch(error=>{if(live)setError(explain(error));});return()=>{live=false;};},[roomId,revision,open,attempt]);return <details className="workspace-section" onToggle={event=>setOpen(event.currentTarget.open)}><summary>历史版本 · 最近 30 次</summary>{error?<p className="flow-error" role="alert">{error}<button className="text-button" onClick={()=>setAttempt(value=>value+1)}>重新读取</button></p>:!data?<p className="muted">正在读取历史版本…</p>:data.length?data.map(entry=><details className="history-version" key={entry.revision}><summary>v{entry.revision} · {new Date(entry.updatedAt).toLocaleString()}</summary><Markdown text={entry.text||'（空）'}/></details>):<p className="muted">尚无已保存的历史版本。</p>}</details>;}
