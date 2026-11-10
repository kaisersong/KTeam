import React,{useEffect,useRef,useState} from 'react';
import {Clock,ChevronDown} from 'lucide-react';
import {api,explain,type Bot} from './api';
const clean=(name:string)=>name.replace(/ · KTeam .+$/,'');
function dueLabel(item:any){
 if(item.state==='paused')return item.unavailable??'已暂停';
 if(item.state==='queued')return '正在进行';
 if(item.unavailable)return item.unavailable;
 if(item.dueAt<=Date.now())return '等待检查';
 return '一次 · '+new Intl.DateTimeFormat('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(item.dueAt));
}
export function UpcomingWork({roomId,bots,onBot}:{roomId:string;bots:Bot[];onBot:(bot:Bot)=>void}){
 const [items,setItems]=useState<any[]>([]),[loaded,setLoaded]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState<string>(),[expanded,setExpanded]=useState(false);
 const generation=useRef(0),request=useRef(0);
 const load=async()=>{const own=generation.current,sequence=++request.current;try{const value=await api.scheduledWork(roomId);if(own===generation.current&&sequence===request.current){setItems(value.schedules);setLoaded(true);setError('');}}catch(e){if(own===generation.current&&sequence===request.current)setError(explain(e));}};
 useEffect(()=>{generation.current++;void load();const timer=setInterval(()=>{if(document.visibilityState==='visible')void load();},15000);return()=>{generation.current++;clearInterval(timer);};},[roomId]);
 const change=async(item:any,action:'pause'|'resume'|'cancel')=>{const own=generation.current;setBusy(item.id);setError('');try{await api.changeScheduledWork({roomId,id:item.id,expectedRevision:item.revision,action});if(own===generation.current)await load();}catch(e){if(own===generation.current)setError(explain(e));}finally{if(own===generation.current)setBusy(undefined);}};
 const visible=expanded?items:items.slice(0,5);
 return <section className="upcoming-work" aria-label="即将进行"><h3>即将进行</h3>{error&&<p className="flow-error" role="alert">{error}<button className="text-button" onClick={()=>void load()}>重新读取</button></p>}{!loaded&&!error&&<p className="muted">正在读取已安排的工作…</p>}{loaded&&!items.length&&!error&&<><p className="muted">还没有安排工作。</p><p className="muted">开启成员的主动跟进后，可以在聊天里安排一次稍后检查。</p>{bots.length===1&&<button className="text-button" onClick={()=>onBot(bots[0]!)}>设置主动跟进</button>}</>}{items.length>0&&<div className="upcoming-list">{visible.map(item=><div className="upcoming-row" key={item.id}><Clock size={18}/><div className="upcoming-description"><strong>{item.title}</strong><small>{bots.length>1?clean(item.botName)+' · ':''}{dueLabel(item)}</small>{item.sourceRoomId!==roomId&&<small>来自 {item.sourceTitle}</small>}{item.state==='paused'&&item.dueAt<=Date.now()&&!item.unavailable&&<small>恢复后重新核对进展</small>}</div><div className="upcoming-controls"><button type="button" className="schedule-switch" role="switch" aria-label={item.title+'的安排'} aria-checked={item.state==='pending'} disabled={!!busy||item.state==='queued'||item.state==='paused'&&!!item.unavailable} onClick={()=>void change(item,item.state==='paused'?'resume':'pause')}><span/></button>{item.state!=='queued'&&<button className="text-button" disabled={!!busy} onClick={()=>void change(item,'cancel')} aria-label={'取消'+item.title}>取消</button>}</div></div>)}{items.length>5&&<button className="upcoming-expand" onClick={()=>setExpanded(v=>!v)}>{expanded?'收起':'展开 '+items.length+' 项'}<ChevronDown size={14}/></button>}</div>}{items.length>0&&<p className="muted">这些是一次性跟进，完成后不再重复执行。</p>}</section>;
}
