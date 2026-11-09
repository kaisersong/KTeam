import React,{memo,useEffect,useRef} from 'react';
import {MessageCircle,Users,CheckSquare,Plus,Settings,Send,Pause,Play,ChevronDown,X,Check,RefreshCw,Search,Inbox,ArrowUp} from 'lucide-react';
import type {Bot,Room,Message} from './api';
import {api,explain} from './api';
import {Markdown} from './Markdown';
const seenPending=new Map<string,Set<number>>();let seenTimer:ReturnType<typeof setTimeout>|undefined;
function seen(roomId:string,sequence:number){
 if(!roomId)return;const pending=seenPending.get(roomId)??new Set<number>();pending.add(sequence);seenPending.set(roomId,pending);
 if(!seenTimer)seenTimer=setTimeout(()=>{seenTimer=undefined;for(const [roomId,sequences] of seenPending){void api.seen({roomId,sequences:[...sequences]}).catch(()=>{});}seenPending.clear();},80);
}

export function Avatar({name,index=0}:{name:string;index?:number}){return <span className={'avatar tone-'+index%4}>{name==='运营'?'运':name==='CTO'?'T':name==='小K'?'K':Array.from(name)[0]}</span>;}
export function Sidebar({rooms,selected,onSelect,onCreate,onSettings,onInbox,query,setQuery,inboxCount}:{rooms:Room[];selected?:string;onSelect:(id:string)=>void;onCreate:()=>void;onSettings:()=>void;onInbox:()=>void;query:string;setQuery:(v:string)=>void;inboxCount:number}){
 return <aside className="sidebar"><div className="sidebar-top drag"><span className="wordmark">KTeam</span><button className="icon-button" aria-label="新建会话" onClick={onCreate}><Plus size={21}/></button></div>
 <label className="conversation-search"><Search size={16}/><input aria-label="搜索会话" placeholder="搜索会话" value={query} onChange={e=>setQuery(e.target.value)}/><kbd>⌘ K</kbd></label>
 <button className="inbox-button" onClick={onInbox}><Inbox size={20}/><span>收件箱</span>{inboxCount>0&&<b>{inboxCount}</b>}</button>
 <div className="conversation-list">{rooms.filter(r=>!query||r.title.toLowerCase().includes(query.toLowerCase())).map(room=><button key={room.roomId} onClick={()=>onSelect(room.roomId)} className={'room-item '+(room.roomId===selected?'active':'')} title={room.title}>{room.kind==='assistant'?<img src="./icon.svg" alt="" className="assistant-avatar"/>:room.kind==='direct'?<Avatar name={room.title}/>:<span className="group-avatar"><Users size={20}/></span>}<span>{room.title}</span>{room.kind==='assistant'&&<small>助理</small>}</button>)}</div>
 <button className="settings-button" onClick={onSettings}><Settings size={18}/><span>设置</span><small>本地工作空间</small></button></aside>;
}
export const MessageRow=memo(function MessageRow({message,bots,onWork}:{message:Message;bots:Bot[];onWork:()=>void}){
 const ref=useRef<HTMLElement>(null);
 const bot=bots.find(bot=>bot.id===message.sender.logicalAgentId),name=message.sender.kind==='user'?'我':bot?.name?.replace(/ · KTeam .+$/,'')??'团队成员';
 useEffect(()=>{
  const target=ref.current;if(!target)return;
  let timer:ReturnType<typeof setTimeout>|undefined;
  let fullyVisible=false;
  const check=()=>{clearTimeout(timer);if(fullyVisible&&document.visibilityState==='visible'&&document.hasFocus())timer=setTimeout(()=>{if(fullyVisible&&document.visibilityState==='visible'&&document.hasFocus())seen((message as any).roomId,message.roomSequence);},1000);};
  const observer=new IntersectionObserver(entries=>{fullyVisible=entries[0]?.intersectionRatio===1;check();},{threshold:1});
  document.addEventListener('visibilitychange',check);window.addEventListener('focus',check);window.addEventListener('blur',check);
  observer.observe(target);return()=>{clearTimeout(timer);observer.disconnect();document.removeEventListener('visibilitychange',check);window.removeEventListener('focus',check);window.removeEventListener('blur',check);};
 },[message.messageId,message.roomSequence]);
 const time=message.createdAt&&Number.isFinite(Date.parse(message.createdAt))?new Intl.DateTimeFormat('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(message.createdAt)):'时间未知';
 return <article ref={ref} className={"message-row "+(message.sender.kind==='user'?'from-user':'from-bot')}><Avatar name={name} index={Math.max(0,bots.findIndex(bot=>bot.name===name))}/><div className="message-content"><div className="message-byline"><strong>{name}</strong><time>{time}</time></div><div className="message-text"><Markdown text={message.text??''}/></div></div></article>;
});
export function Composer({value,setValue,onSend,busy,placeholder='给小K发消息…'}:{value:string;setValue:(v:string)=>void;onSend:()=>void;busy:boolean;placeholder?:string}){
 return <form className="composer" onSubmit={event=>{event.preventDefault();if(value.trim()&&!busy)onSend();}}><textarea aria-label="发送消息" placeholder={placeholder} value={value} rows={1} onChange={event=>setValue(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();if(value.trim()&&!busy)onSend();}}}/><button className="send-button" disabled={!value.trim()||busy} aria-label="发送消息"><ArrowUp size={20}/></button></form>;
}
export function Inspector({room,bots,settings,tasks,jobs,onReview,onPause,onBot}:{room:Room;bots:Bot[];settings:any;tasks:any[];jobs:any[];onReview:(task:any)=>void;onPause:()=>void;onBot:(bot:Bot)=>void}){
 const job=jobs.find(job=>['routing','running','stopping'].includes(job.state));
 const labels:Record<string,string>={proposed:'待认领',committed:'已认领',working:'进行中',delivered:'待你验收',accepted:'已验收',halted:'已停止',blocked:'已阻塞',result_unknown:'结果待核对',cancelled:'已取消'};
 return <aside className="inspector"><section><h3>团队目标</h3><p className="goal-text">{settings?.goal??room.description??'暂未设定目标'}</p></section><section><h3>成员</h3>{bots.map((bot,index)=><button className="member-item member-edit" key={bot.id} onClick={()=>onBot(bot)}><Avatar name={bot.name} index={index}/><div><strong>{bot.name}</strong><small><span className={'presence '+(job?.activeBotId===bot.id?'working':'')}/>{job?.activeBotId===bot.id?'正在处理消息':bot.connection?.status==='connected'?bot.connection.driver+' · 原会话':bot.binding?.model??'尚未绑定'}</small></div><ChevronDown size={14}/></button>)}</section><section><h3>本次工作</h3>{tasks.length?tasks.slice(-8).reverse().map(task=><div className="task-row" key={task.taskRef}><CheckSquare size={16}/><div><p>{String(task.terms?.description??'团队工作').slice(0,60)}</p><span className={'state '+task.state}>{labels[task.state]??task.state}</span></div>{task.state==='delivered'&&<button className="icon-button" aria-label="验收通过" title="验收通过" onClick={()=>onReview(task)}><Check size={17}/></button>}</div>):<p className="muted">新的团队工作会显示在这里。</p>}{jobs[0]?.reason&&<p className="work-note">{explain(jobs[0].reason)}</p>}</section><details><summary>工作范围<ChevronDown size={16}/></summary><p className="muted">系统 Agent 可在你指定的目录读取资料；接入的 Agent 使用原会话工具和批准方式。</p></details><details><summary>预算<ChevronDown size={16}/></summary><p className="muted">每条消息最多 {settings?.maxRuns??6} 次模型调用，含路由；每天最多 {settings?.dailyCalls??20} 次。当前消息已调用 {jobs[0]?.calls??0} 次。</p></details></aside>;
}
export function Modal({title,children,onClose}:{title:string;children:React.ReactNode;onClose:()=>void}){
 const dialog=useRef<HTMLElement>(null),close=useRef(onClose);close.current=onClose;
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null,target=dialog.current;if(!target)return;if(!target.contains(document.activeElement))target.querySelector<HTMLElement>('input,textarea,select,button')?.focus();
 const keyboard=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();close.current();return;}if(event.key!=='Tab')return;const controls=[...target.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary,[tabindex="0"]')].filter(e=>e.getClientRects().length);const first=controls[0],last=controls.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}};
 document.addEventListener('keydown',keyboard);return()=>{document.removeEventListener('keydown',keyboard);if(previous?.isConnected)previous.focus();};},[]);
 return <div className="modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}><section ref={dialog} className="modal" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}><header><h2>{title}</h2><button className="icon-button" aria-label="关闭" onClick={onClose}><X size={20}/></button></header>{children}</section></div>;
}

export {Pause,Play,Plus,Users,RefreshCw};
