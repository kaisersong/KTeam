import {useEffect,useRef,useState} from 'react';
import type {ArtifactReviewDecision,ArtifactReviewView} from '../../../src/protocol/artifact-review';
import {api,explain} from './api';
import {messageDisplayText} from '../../../src/protocol/message-attachments';
import {readReviewDraft,saveReviewDraft,type ReviewDraft,type Range} from './artifact-review-draft';

type Identity={roomId:string;toolCallId:string};
const labels={
 accepted:'当前版本已验收',preparing:'发送结果待核对',queued:'返工意见已提交',completed:'返工意见已处理',needs_review:'需要核对返工回执',
};
const reasons:Record<string,string>={
 artifact_review_unavailable:'产物提交后可以审阅。',
 artifact_review_text_unavailable:'此产物超出行内审阅的文本范围。',
 artifact_review_changed:'产物或审阅版本已变化，请重新读取。',
 generated_file_changed:'产物已更新，请在原工作打开新版本。',
 work_input_delivery_unknown:'电脑尚未确认返工意见已送达，请刷新回执。',
};
function reviewError(error:unknown){const code=explain(error);return reasons[code]??code;}

export function ArtifactReviewPanel({roomId,toolCallId}:Identity){
 const [view,setView]=useState<ArtifactReviewView>();
 const [error,setError]=useState('');
 const [revision,refresh]=useState(0);
 useEffect(()=>{
  let live=true;setError('');
  void api.artifactReview({roomId,toolCallId}).then(value=>{if(live)setView(value);})
   .catch(error=>{if(live)setError(reviewError(error));});
  return()=>{live=false;};
 },[roomId,toolCallId,revision]);
 return <section className="artifact-review" aria-label="产物审阅">
  {error&&<p className="flow-error" role="alert">{error} <button className="text-button" onClick={()=>refresh(n=>n+1)}>重新读取</button></p>}
  {view ? <ReviewEditor key={view.sha256} identity={{roomId,toolCallId}} view={view} refresh={()=>refresh(n=>n+1)}/> : !error&&<p role="status">正在核对产物版本…</p>}
 </section>;
}

function ReviewEditor({identity,view,refresh}:{identity:Identity;view:ArtifactReviewView;refresh:()=>void}){
 const draftKey=JSON.stringify([identity.roomId,identity.toolCallId,view.sha256]);
 const maxLine=view.lines.reduce((max,line)=>Math.max(max,line.after??0),0);
 const [saved,setSaved]=useState(()=>readReviewDraft(draftKey,maxLine));
 const savedRef=useRef(saved);
 const {range,draft,notes}={range:saved.range,draft:saved.text,notes:saved.notes};
 const save=(patch:Partial<ReviewDraft>)=>{
  const next={...savedRef.current,...patch};
  savedRef.current=next;
  setSaved(next);
  saveReviewDraft(draftKey,next);
 };
 const [decision,setDecision]=useState<ArtifactReviewDecision>();
 const [busy,setBusy]=useState(false);
 const [reviewer,setReviewer]=useState('');
 const [requested,setRequested]=useState(false);
 const peerRequests=useRef(new Map<string,string>());
 const requestPeer=async()=>{
  setBusy(true);setError('');
  const requestId=peerRequests.current.get(reviewer)??crypto.randomUUID();
  peerRequests.current.set(reviewer,requestId);
  try{await api.requestPeerReview({...identity,expectedSha256:view.sha256,botId:reviewer,requestId});setRequested(true);}
  catch(error){setError(reviewError(error));}
  finally{setBusy(false);}
 };
 const [showDelivery,setShowDelivery]=useState(false);
 const [delivery,setDelivery]=useState<{text?:string;error?:string}>();
 const [error,setError]=useState('');
 const noteInput=useRef<HTMLTextAreaElement>(null);
 const lines=useRef<HTMLDivElement>(null);
 const positionWrite=useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
 const deliveryId=view.source?.messageId;
 useEffect(()=>{
  if(!showDelivery||!deliveryId)return;
  let live=true;
  setDelivery(undefined);
  void api.conversationMessage({roomId:identity.roomId,messageId:deliveryId})
   .then(result=>{if(live)setDelivery({text:messageDisplayText(result.message)});})
   .catch(error=>{if(live)setDelivery({error:explain(error)});});
  return()=>{live=false;};
 },[showDelivery,deliveryId,identity.roomId]);
 const receipt=view.decision?.status==='preparing' ? decision??view.decision : view.decision??decision;
 const pending=receipt?.status==='preparing';
 const currentNotes=pending?receipt.notes:notes;
 const locate=(line:number,focus=false)=>{
  const container=lines.current;
  const target=container?.querySelector<HTMLButtonElement>('[data-review-line="'+line+'"]');
  if(!container||!target)return;
  container.scrollTop+=target.getBoundingClientRect().top-container.getBoundingClientRect().top-(focus?container.clientHeight/3:0);
  if(focus)target.focus({preventScroll:true});
 };
 useEffect(()=>{
  if(savedRef.current.line)locate(savedRef.current.line);
  return ()=>{
   if(!positionWrite.current)return;
   clearTimeout(positionWrite.current);
   saveReviewDraft(draftKey,savedRef.current);
  };
 },[draftKey]);
 const select=(line:number,extend:boolean)=>{
  const next:Range=extend&&range
   ?{start:Math.min(range.start,line),end:Math.max(range.start,line)}
   :{start:line,end:line};
  save({range:next});
 };
 const add=()=>{
  const text=draft.trim();
  if(!range||!text||range.end-range.start>19||notes.length>=8)return;
  save({notes:[...notes,{...range,text}],text:'',range:undefined});
 };
 const submit=async(action:ArtifactReviewDecision['action'])=>{
  if(busy)return;
  const submitted=action==='accept'?[]:currentNotes;
  setBusy(true);setError('');
  try{
   const result=await api.submitArtifactReview({...identity,expectedSha256:view.sha256,action,notes:submitted});
   setDecision(result.decision);
   save({text:'',notes:[],range:undefined});
  }catch(error){setError(reviewError(error));}
  finally{setBusy(false);}
 };
 return <div className="artifact-review-grid">
  <div className="artifact-review-diff" aria-label="只读产物差异">
   <p className="artifact-review-version">
    {view.historical&&'历史版本 · '}{view.baselineSha256?<>基线 <code title={view.baselineSha256}>{view.baselineSha256.slice(0,12)}</code> → </>:<>首次审阅 · </>}
    当前 <code title={view.sha256}>{view.sha256.slice(0,12)}</code>
   </p>
   <div ref={lines} className="artifact-review-lines" onScroll={event=>{
    const container=event.currentTarget;
    const top=container.getBoundingClientRect().top;
    const buttons=container.querySelectorAll<HTMLButtonElement>('[data-review-line]');
    let first=0,last=buttons.length;
    while(first<last){
     const middle=(first+last)>>>1;
     if(buttons[middle].getBoundingClientRect().bottom<=top)first=middle+1;
     else last=middle;
    }
    const line=Number(buttons[first]?.dataset.reviewLine);
    if(line&&line!==savedRef.current.line){
     savedRef.current={...savedRef.current,line};
     clearTimeout(positionWrite.current);
     positionWrite.current=setTimeout(()=>{
      positionWrite.current=undefined;
      saveReviewDraft(draftKey,savedRef.current);
     },180);
    }
   }}>
    {view.lines.map((line,index)=>{
     const selected=!!range&&line.after!==undefined&&line.after>=range.start&&line.after<=range.end;
     return <div className={'artifact-review-line '+line.kind+(selected?' selected':'')} key={index}>
      <span className="artifact-review-number">{line.before??''}</span>
      {line.after===undefined?<span className="artifact-review-number"/>:
       <button type="button" className="artifact-review-number" data-review-line={line.after} aria-disabled={!!receipt} aria-label={(receipt?'第 ':'选择第 ')+line.after+' 行'} aria-pressed={selected}
        onClick={event=>{if(!receipt){select(line.after!,event.shiftKey);if(!event.shiftKey)noteInput.current?.focus();}}}>{line.after}</button>}
      <span aria-hidden="true">{line.kind==='added'?'+':line.kind==='removed'?'−':' '}</span><code>{line.text||' '}</code>
     </div>;
    })}
   </div>
  </div>
  <aside className="artifact-review-notes" aria-label="审阅意见">
   {!!view.peerReviewers?.length&&<details>
    <summary>请另一位成员复核</summary>
    <label>复核成员<select value={reviewer} disabled={busy} onChange={event=>{setReviewer(event.target.value);setRequested(false);}}>
     <option value="">选择成员</option>
     {view.peerReviewers.map(bot=><option key={bot.id} value={bot.id}>{bot.name}</option>)}
    </select></label>
    <button type="button" className="secondary" disabled={!reviewer||busy||requested} onClick={()=>void requestPeer()}>发送复核消息</button>
    {requested&&<p role="status">请求已发送，复核意见将回到原会话。</p>}
   </details>}
   <h3>审阅意见</h3>
   {deliveryId&&<button type="button" className="text-button" aria-expanded={showDelivery}
    onClick={()=>setShowDelivery(value=>!value)}>{showDelivery?'收起原交付':'查看原交付'}</button>}
   {showDelivery&&<div className="artifact-review-delivery" aria-label="原交付">
    {delivery?.error?<p role="alert">原交付暂时无法读取。{delivery.error}</p>:
     delivery?<p>{delivery.text||'原消息没有可展示的文本。'}</p>:<p role="status">正在读取原交付…</p>}
   </div>}
   {receipt&&<div role="status"><strong>{labels[receipt.status]}</strong>
    {receipt.workState==='delivered'&&<p>原负责人已提交返工答复。</p>}
    {receipt.followupJobId&&<p><small>返工工作 <code>{receipt.followupJobId}</code></small></p>}
    <button className="text-button" onClick={refresh}>刷新回执</button>
   </div>}
   {(receipt?.notes??notes).map((note,index)=><article key={index}><button type="button" className="text-button" onClick={()=>locate(note.start,true)}>第 {note.start===note.end?note.start:note.start+'–'+note.end} 行</button><p>{note.text}</p>
    {!receipt&&<button className="text-button" disabled={busy} onClick={()=>save({notes:notes.filter((_,i)=>i!==index)})}>移除</button>}
   </article>)}
   {!receipt&&<>
    <label htmlFor="artifact-review-note">{range?'第 '+(range.start===range.end?range.start:range.start+'–'+range.end)+' 行':'选择行号，Shift 点击可扩展范围'}</label>
    <textarea ref={noteInput} id="artifact-review-note" maxLength={400} value={draft} onChange={event=>save({text:event.target.value})}/>
    <button className="secondary" disabled={busy||!range||!draft.trim()||range.end-range.start>19||notes.length>=8} onClick={add}>加入意见</button>
    <div className="workspace-inline">
     <button className="secondary" disabled={busy||!notes.length||!!draft.trim()} onClick={()=>void submit('request_changes')}>交回原负责人</button>
     <button className="text-button" disabled={busy||!!notes.length||!!draft.trim()} onClick={()=>void submit('accept')}>验收此版本</button>
    </div>
   </>}
   {pending&&!view.historical&&<button className="secondary" disabled={busy} onClick={()=>void submit('request_changes')}>核对发送结果</button>}
   {error&&<p className="flow-error" role="alert">{error} <button className="text-button" onClick={refresh}>刷新回执</button></p>}
  </aside>
 </div>;
}
