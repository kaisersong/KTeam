import React,{useState}from'react';
import{Terminal,Check,ShieldCheck,X}from'lucide-react';
import{explain,type Bot}from'./api';
export function ToolApprovalCard({approval,bot,onDecide}:{approval:any;bot?:Bot;onDecide:(decision:'allow_once'|'deny')=>Promise<void>}){
 const[busy,setBusy]=useState(false),[error,setError]=useState('');const decide=async(decision:'allow_once'|'deny')=>{setBusy(true);setError('');try{await onDecide(decision);}catch(e){setError(explain(e));}finally{setBusy(false);}};
 return <section className="tool-approval" aria-label="工具调用确认"><h3><ShieldCheck size={18}/>{bot?.name.replace(/ · KTeam .+$/,'')??'成员'} 需要你确认</h3><p>调用 {approval.toolName} · 仅允许这一次请求</p><pre>{approval.display}</pre>{error&&<p className="flow-error" role="alert">{error}</p>}<div><button className="secondary" disabled={busy} onClick={()=>void decide('deny')}><X size={14}/>拒绝</button><button className="primary" disabled={busy} onClick={()=>void decide('allow_once')}><Check size={14}/>允许本次</button></div></section>;
}
export function ToolTrace({events}:{events:any[]}){if(!events.length)return null;return <details className="tool-trace"><summary><Terminal size={13}/>工具记录 · {[...new Set(events.map(e=>e.name))].join('、')} · {events.length} 次</summary>{events.map(e=><div key={e.id}><strong>{e.name}<small>{e.state==='completed'?'已返回':e.state==='running'?'执行中':'未完成'}</small></strong>{e.input&&<pre>{e.input}</pre>}{e.result&&<pre>{e.result}</pre>}{e.code&&<p>{explain(e.code)}</p>}</div>)}</details>;}
