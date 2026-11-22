import {messageDisplayText} from '../../../src/protocol/message-attachments';
import {useEffect,useState} from 'react';
import {api,explain,type Bot,type Message,type Room} from './api';
import {activeWorkLabels,conversationWork} from '../../../src/protocol/conversation-work';
import type {MessageReference} from '../../../src/protocol/message-reference';

export function ConversationWorkControls({roomId,jobs,attention,bots,disabled,onOpen,onAttention,onAppend,onStop}:{
 roomId:string;jobs:any[];attention:any[];bots:Bot[];disabled:boolean;
 onOpen:(id:string)=>void;onAttention:(roomId:string,id:string)=>void;onAppend:(id:string,independent?:boolean)=>void;onStop:(id:string)=>void;
}){
 const rows=conversationWork(roomId,jobs,attention);
 if(!rows.length)return null;
 const count=rows.filter(row=>row.attention).length;
 return <details className="conversation-work-controls">
  <summary>{count?count+' 项等待你处理':rows.length+' 项工作进行中'}{rows[0]?.progress?' · '+rows[0].progress:''}</summary>
  <ul>{rows.map(({job,attention,progress})=><li key={job.id}>
   <span>{bots.find(bot=>bot.id===job.activeBotId)?.name??'会话工作'} · {attention?'等待你处理':activeWorkLabels[job.state]}{progress?' · '+progress:''}</span>
   <div className="conversation-work-actions">
    {attention&&<button type="button" onClick={()=>onAttention(attention.roomId,attention.id)}>去处理</button>}
    <button type="button" onClick={()=>onOpen(job.id)}>查看记录</button>
    {job.state!=='stopping'&&<><button type="button" disabled={disabled} onClick={()=>onAppend(job.id)}>补充要求</button>
    <button type="button" disabled={disabled} onClick={()=>onAppend(job.id,true)}>另提问题</button>
    <button type="button" disabled={disabled} onClick={()=>onStop(job.id)}>停止</button></>}
   </div>
  </li>)}</ul>
 </details>;
}

export function ReferencePicker({room,rooms,onInsert}:{room:Room;rooms:Room[];onInsert:(reference:MessageReference)=>void}){
 const [source,setSource]=useState(''),[messages,setMessages]=useState<Message[]>([]);
 const [preview,setPreview]=useState<MessageReference>(),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{
  if(!source)return;let current=true;
  void api.conversationHistory({roomId:source,tail:true}).then(value=>{
   if(current)setMessages(value.messages.filter((message:Message)=>messageDisplayText(message).trim()).reverse());
  }).catch(error=>{if(current)setError(explain(error));});
  return()=>{current=false;};
 },[source]);
 async function choose(message:Message){
  setError('');setBusy(true);
  try{setPreview((await api.messageReference({roomId:room.roomId,sourceRoomId:source,messageId:message.messageId})).reference);}
  catch(error){setError(explain(error));}finally{setBusy(false);}
 }
 return <div className="reference-picker">
  <label>来源会话 <select value={source} disabled={busy} onChange={event=>{setSource(event.target.value);setMessages([]);setPreview(undefined);setError('');}}>
   <option value="">选择会话</option>{rooms.filter(row=>row.roomId!==room.roomId).map(row=><option value={row.roomId} key={row.roomId}>{row.title}</option>)}
  </select></label>
  {error&&<p className="flow-error" role="alert">{error}</p>}
  {preview?<><p>将随消息发到「{room.title}」</p><blockquote>{preview.text}</blockquote>
   <button type="button" className="primary" onClick={()=>onInsert(preview)}>插入引用</button>
   <button type="button" onClick={()=>setPreview(undefined)}>重选消息</button></>:source&&<ul>{messages.map(message=><li key={message.messageId}>
    <button disabled={busy} type="button" onClick={()=>void choose(message)}>{messageDisplayText(message).slice(0,140)}</button>
   </li>)}</ul>}
 </div>;
}
