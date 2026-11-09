import {A2uiArtifactRenderer} from '../../xiaok/renderer/src/components/a2ui/A2uiArtifactRenderer';
import {Markdown} from './Markdown';
import React,{useState}from'react';
import{Terminal,Check,ShieldCheck,X}from'lucide-react';
import{explain,type Bot}from'./api';
export function ToolApprovalCard({approval,bot,onDecide}:{approval:any;bot?:Bot;onDecide:(decision:'allow_once'|'deny')=>Promise<void>}){
 const[busy,setBusy]=useState(false),[error,setError]=useState('');const decide=async(decision:'allow_once'|'deny')=>{setBusy(true);setError('');try{await onDecide(decision);}catch(e){setError(explain(e));}finally{setBusy(false);}};
 return <section className="tool-approval" aria-label="工具调用确认"><h3><ShieldCheck size={18}/>{bot?.name.replace(/ · KTeam .+$/,'')??'成员'} 需要你确认</h3><p>调用 {approval.toolName} · 仅允许这一次请求</p><pre>{approval.display}</pre>{error&&<p className="flow-error" role="alert">{error}</p>}<div><button className="secondary" disabled={busy} onClick={()=>void decide('deny')}><X size={14}/>拒绝</button><button className="primary" disabled={busy} onClick={()=>void decide('allow_once')}><Check size={14}/>允许本次</button></div></section>;
}
export function ToolTrace({events}:{events:any[]}){if(!events.length)return null;return <details className="tool-trace"><summary><Terminal size={13}/>工具记录 · {[...new Set(events.map(e=>e.name))].join('、')} · {events.length} 次</summary>{events.map(e=><div key={e.id}><strong>{e.name}<small>{e.state==='completed'?'已返回':e.state==='running'?'执行中':'未完成'}</small></strong>{e.input&&<pre>{typeof e.input==='string'?e.input:JSON.stringify(e.input,null,2)}</pre>}{e.result&&<pre>{typeof e.result==='string'?e.result:JSON.stringify(e.result,null,2)}</pre>}{e.code&&<p>{explain(e.code)}</p>}</div>)}</details>;}

export function RuntimeMessageContent({text,cards=[]}:{text:string;cards?:any[]}){
 const parts:React.ReactNode[]=[];let start=0;
 for(const [index,card]of cards.entries()){
  const offset=Math.max(start,Math.min(text.length,Number.isSafeInteger(card.offset)?card.offset:text.length));
  if(offset>start)parts.push(<Markdown key={'text-'+index} text={text.slice(start,offset)}/>);
  parts.push(<div className="runtime-card" key={card.artifactId??index}><A2uiArtifactRenderer artifactContent={card.content} artifactRef={{key:card.artifactId,artifactId:card.artifactId}}/></div>);start=offset;
 }
 if(start<text.length||!parts.length)parts.push(<Markdown key="text-final" text={text.slice(start)}/>);
 return <>{parts}</>;
}

export function BotQuestionCard({question,onAnswer}:{question:any;onAnswer:(text:string)=>Promise<void>}){
 const[value,setValue]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const answer=async(text:string)=>{if(!text.trim())return;setBusy(true);try{await onAnswer(text);}catch(e){setError(explain(e));}finally{setBusy(false);}};
 return <section className="tool-approval" aria-label="私聊确认"><h3>需要你确认一件事</h3><p>{question.question}</p><small>来源群：{question.sourceRoomTitle??'原群'} · 回答后继续原来的工作</small>{(question.options??[]).length>0&&<div>{question.options.map((label:string)=><button className="secondary" disabled={busy} key={label} onClick={()=>void answer(label)}>{label}</button>)}</div>}<form onSubmit={e=>{e.preventDefault();void answer(value);}}><input aria-label="回答问题" value={value} onChange={e=>setValue(e.target.value)} placeholder="你的回答（请勿填写密码或验证码）"/><button className="primary" disabled={busy||!value.trim()}>发送回答</button></form>{error&&<p role="alert">{error}</p>}</section>;
}
