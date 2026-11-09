import React,{memo,useEffect,useRef} from 'react';
import {MessageCircle,Users,CheckSquare,Plus,Settings,Send,Pause,Play,ChevronDown,X,Check,RefreshCw} from 'lucide-react';
import type {Bot,Room,Message} from './api';
import {api,explain} from './api';
import {Markdown} from './Markdown';
const seenPending=new Map<string,Set<number>>();let seenTimer:ReturnType<typeof setTimeout>|undefined;
function seen(roomId:string,sequence:number){
 if(!roomId)return;const pending=seenPending.get(roomId)??new Set<number>();pending.add(sequence);seenPending.set(roomId,pending);
 if(!seenTimer)seenTimer=setTimeout(()=>{seenTimer=undefined;for(const [roomId,sequences] of seenPending){void api.seen({roomId,sequences:[...sequences]}).catch(()=>{});}seenPending.clear();},80);
}

export function Avatar({name,index=0}:{name:string;index?:number}){return <span className={'avatar tone-'+index%4}>{name==='运营'?'运':name==='CTO'?'T':name==='小K'?'K':Array.from(name)[0]}</span>;}
export function Sidebar({rooms,bots,selected,onSelect,onCreateTeam,onCreateBot,onSettings,view,setView}:{rooms:Room[];bots:Bot[];selected?:string;onSelect:(id:string)=>void;onCreateTeam:()=>void;onCreateBot:()=>void;onSettings:()=>void;view:string;setView:(view:string)=>void}){
 return <aside className="sidebar"><div className="brand drag"><span className="brand-mark">K</span><strong>KTeam</strong></div>
 <nav>{[['messages','消息',MessageCircle],['teams','团队',Users],['work','工作',CheckSquare]].map(([key,label,Icon]:any)=><button className={'nav-item '+(view===key?'active':'')} key={key} onClick={()=>setView(key)}><Icon size={21}/>{label}</button>)}</nav>
 <div className="rail-label">群组<button className="icon-button" aria-label="创建团队" onClick={onCreateTeam}><Plus size={19}/></button></div>
 <div className="room-list">{rooms.map(room=><button key={room.roomId} onClick={()=>onSelect(room.roomId)} className={'room-item '+(room.roomId===selected?'active':'')}><Users size={20}/><span>{room.title}</span></button>)}{!rooms.length&&<p className="rail-empty">创建一个团队，交代共同目标。</p>}</div>
 <div className="rail-label">成员<button className="icon-button" aria-label="创建成员" onClick={onCreateBot}><Plus size={19}/></button></div>
 <div className="bot-list">{bots.filter(bot=>bot.binding).map((bot,index)=><div className="bot-row" key={bot.id}><Avatar name={bot.name} index={index}/><span>{bot.name}</span><small title={bot.binding?.model}>已绑定</small></div>)}</div>
 <button className="settings-button" onClick={onSettings}><Settings size={18}/>模型与服务</button></aside>;
}
export const MessageRow=memo(function MessageRow({message,bots,onWork}:{message:Message;bots:Bot[];onWork:()=>void}){
 const ref=useRef<HTMLElement>(null);
 const bot=bots.find(bot=>bot.id===message.sender.logicalAgentId),name=message.sender.kind==='user'?'我':bot?.name??'团队成员';
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
 return <article ref={ref} className="message-row"><Avatar name={name} index={Math.max(0,bots.findIndex(bot=>bot.name===name))}/><div className="message-content"><div className="message-byline"><strong>{name}</strong><time>{time}</time></div><div className="message-text"><Markdown text={message.text??''}/></div>{message.workRef&&<button className="inline-work" onClick={onWork}><CheckSquare size={18}/><span><strong>团队工作答复</strong><small>查看交付记录与验收状态</small></span><span>查看</span></button>}</div></article>;
});
export function Composer({value,setValue,onSend,busy,mode}:{value:string;setValue:(v:string)=>void;onSend:()=>void;busy:boolean;mode:string}){
 return <form className="composer" onSubmit={event=>{event.preventDefault();if(value.trim()&&!busy)onSend();}}><textarea aria-label="给团队发消息" placeholder="给团队发消息…" value={value} rows={2} onChange={event=>setValue(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();if(value.trim()&&!busy)onSend();}}}/><div className="compose-tools"><span title="系统按目标与职责选择相关成员，必要时保持安静">{mode==='mentions'?'仅回应 @':'自动协作'}<ChevronDown size={13}/></span><button className="send-button" disabled={!value.trim()||busy} aria-label="发送消息"><Send size={19}/></button></div></form>;
}
export function Inspector({room,bots,settings,tasks,jobs,onReview,onPause}:{room:Room;bots:Bot[];settings:any;tasks:any[];jobs:any[];onReview:(task:any)=>void;onPause:()=>void}){
 const job=jobs.find(job=>['routing','running','stopping'].includes(job.state));
 const labels:Record<string,string>={proposed:'待认领',committed:'已认领',working:'进行中',delivered:'待你验收',accepted:'已验收',halted:'已停止',blocked:'已阻塞',result_unknown:'结果待核对',cancelled:'已取消'};
 return <aside className="inspector"><section><h3>团队目标</h3><p className="goal-text">{settings?.goal??room.description??'暂未设定目标'}</p></section><section><h3>成员</h3>{bots.filter(bot=>bot.binding).map((bot,index)=><div className="member-item" key={bot.id}><Avatar name={bot.name} index={index}/><div><strong>{bot.name}</strong><small><span className={'presence '+(job?.activeBotId===bot.id?'working':'')}/>{job?.activeBotId===bot.id?'正在处理消息':bot.binding?.model??'尚未绑定'}</small></div></div>)}</section><section><h3>本次工作</h3>{tasks.length?tasks.slice(-8).reverse().map(task=><div className="task-row" key={task.taskRef}><CheckSquare size={16}/><div><p>{String(task.terms?.description??'团队工作').slice(0,60)}</p><span className={'state '+task.state}>{labels[task.state]??task.state}</span></div>{task.state==='delivered'&&<button className="icon-button" aria-label="验收通过" title="验收通过" onClick={()=>onReview(task)}><Check size={17}/></button>}</div>):<p className="muted">新的团队工作会显示在这里。</p>}{jobs[0]?.reason&&<p className="work-note">{explain(jobs[0].reason)}</p>}</section><details><summary>工作范围<ChevronDown size={16}/></summary><p className="muted">当前成员仅参与讨论与草案整理。文件、命令和本地 Agent 执行资格须通过能力验证后开放。</p></details><details><summary>预算<ChevronDown size={16}/></summary><p className="muted">每条消息最多 {settings?.maxRuns??6} 次模型调用，含路由；每天最多 {settings?.dailyCalls??20} 次。当前消息已调用 {jobs[0]?.calls??0} 次。</p></details></aside>;
}
export function Modal({title,children,onClose}:{title:string;children:React.ReactNode;onClose:()=>void}){return <div className="modal-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}><section className="modal" role="dialog" aria-modal="true" aria-label={title}><header><h2>{title}</h2><button className="icon-button" aria-label="关闭" onClick={onClose}><X size={20}/></button></header>{children}</section></div>;}
export {Pause,Play,Plus,Users,RefreshCw};
