import {A2uiArtifactRenderer} from '../../core-ui/renderer/src/components/a2ui/A2uiArtifactRenderer';
import {Markdown} from './Markdown';
import React,{useState}from'react';
import{Terminal,Check,ShieldCheck,X}from'lucide-react';
import{explain,type Bot}from'./api';
export function ToolApprovalCard({approval,bot,onDecide}:{approval:any;bot?:Bot;onDecide:(decision:'allow_once'|'allow_always'|'deny')=>Promise<void>}){
 const[busy,setBusy]=useState(false),[error,setError]=useState('');const decide=async(decision:'allow_once'|'allow_always'|'deny')=>{setBusy(true);setError('');try{await onDecide(decision);}catch(e){setError(explain(e));}finally{setBusy(false);}};
 return <section className="tool-approval" data-notification-target={approval.id} tabIndex={-1} aria-label="工具调用确认"><h3><ShieldCheck size={18}/>{bot?.name.replace(/ · KTeam .+$/,'')??'成员'} 需要你确认</h3><p>调用 {approval.toolName}</p><pre>{approval.display}</pre>{approval.canAlways&&<small>授权范围：此成员 · {approval.cwd} · {approval.toolName}</small>}{error&&<p className="flow-error" role="alert">{error}</p>}<div><button className="secondary" disabled={busy} onClick={()=>void decide('deny')}><X size={14}/>拒绝</button><button className="secondary" disabled={busy} onClick={()=>void decide('allow_once')}><Check size={14}/>允许本次</button>{approval.canAlways&&<button className="primary" disabled={busy} onClick={()=>void decide('allow_always')}>始终允许</button>}</div></section>;
}
export function toolActivity(events:any[],bots:Bot[]){
 const descriptions:Record<string,string>={read:'正在查阅本机资料',glob:'正在定位资料',grep:'正在检索资料',bash:'正在检查本机资料',web_fetch:'正在核对网络资料',web_search:'正在查找公开来源',update_shared_context:'正在整理共享纪要',ask_user:'等待你在私聊中确认'};
 const event=[...events].reverse().find(e=>e.input&&(e.name==='contact_bot'||descriptions[e.name]));
 if(!event||event.state!=='running')return undefined;
 if(event.name==='contact_bot'){try{const input=typeof event.input==='string'?JSON.parse(event.input):event.input;const name=bots.find(b=>b.id===input.botId)?.name;return name?'正在与'+name+'核对，等待对方答复':'正在与另一位成员核对';}catch{return '正在与另一位成员核对';}}
 return descriptions[event.name];
}
export function ToolTrace({events}:{events:any[]}){if(!events.length)return null;return <details className="tool-trace"><summary><Terminal size={13}/>工具记录 · {[...new Set(events.map(e=>e.name))].join('、')} · {events.length} 条记录</summary>{events.map(e=><div key={e.id}><strong>{e.name}<small>{e.state==='completed'?'已返回':e.state==='running'?'执行中':'未完成'}</small></strong>{e.input&&<pre>{typeof e.input==='string'?e.input:JSON.stringify(e.input,null,2)}</pre>}{e.result&&<pre>{typeof e.result==='string'?e.result:JSON.stringify(e.result,null,2)}</pre>}{e.code&&<p>{explain(e.code)}</p>}</div>)}</details>;}

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
 return <section className="tool-approval" data-notification-target={question.id} tabIndex={-1} aria-label="私聊确认"><h3>需要你确认一件事</h3><p>{question.question}</p><small>来源群：{question.sourceRoomTitle??'原群'} · 回答后继续原来的工作</small>{(question.options??[]).length>0&&<div>{question.options.map((label:string)=><button className="secondary" disabled={busy} key={label} onClick={()=>void answer(label)}>{label}</button>)}</div>}<form onSubmit={e=>{e.preventDefault();void answer(value);}}><input aria-label="回答问题" value={value} onChange={e=>setValue(e.target.value)} placeholder="你的回答（请勿填写密码或验证码）"/><button className="primary" disabled={busy||!value.trim()}>发送回答</button></form>{error&&<p role="alert">{error}</p>}</section>;
}
