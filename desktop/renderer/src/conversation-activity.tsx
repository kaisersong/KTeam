import {useId,useState} from 'react';
import {ArrowLeft,ArrowRight,Activity,Bug,CheckCircle2,Clock3,AlertCircle} from 'lucide-react';
import {activityRecords,activityStateLabels,activityEventLabel,eventStateLabels,type ActivityRecord} from '../../../src/protocol/activity-records';
import {explain,type Bot} from './api';

const time=(value?:string)=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString(): '时间未记录';
type Props={roomId:string;jobs:any[];bots:Bot[];mode:'activity'|'inspector';onBack:()=>void;onInspect:()=>void;onLocate:(id:string)=>void};
export function ConversationActivity({roomId,jobs,bots,mode,onBack,onInspect,onLocate}:Props){
 const [tab,setTab]=useState<'runs'|'events'|'raw'>('runs'),[selected,setSelected]=useState('');
 const uid=useId(),records=activityRecords(jobs,roomId),record=records.find(item=>item.id===selected)??records[0];
 const names=(item:ActivityRecord)=>item.botIds.map(id=>bots.find(bot=>bot.id===id)?.name.replace(/ · KTeam .+$/,'')??'原成员').join('、');
 const tabs=[['runs','运行记录'],['events','Events'],['raw','Raw']] as const;
 return <section className="conversation-activity" aria-label={mode==='activity'?'会话活动':'会话检查器'}>
  <button className="activity-back" onClick={onBack}><ArrowLeft size={15}/>返回详情</button>
  <header className="activity-heading">{mode==='activity'?<Activity size={20}/>:<Bug size={20}/>}<h3>{mode==='activity'?'活动':'检查器'}</h3></header>
  {mode==='inspector'?<div className="activity-tabs" role="tablist" aria-label="检查器记录类型">{tabs.map(([key,label],index)=><button key={key} id={uid+'-'+key} role="tab" aria-controls={uid+'-content'} aria-selected={tab===key} tabIndex={tab===key?0:-1} onClick={()=>setTab(key)} onKeyDown={event=>{const next=event.key==='ArrowRight'?(index+1)%3:event.key==='ArrowLeft'?(index+2)%3:event.key==='Home'?0:event.key==='End'?2:undefined;if(next!==undefined){event.preventDefault();setTab(tabs[next]![0]);document.getElementById(uid+'-'+tabs[next]![0])?.focus();}}}>{label}</button>)}</div>:<p className="muted">这段对话最近的工作、状态与结果。交付后的验收状态仍以原工作为准。</p>}
  <div id={uid+'-content'} role={mode==='inspector'?'tabpanel':undefined} aria-labelledby={mode==='inspector'?uid+'-'+tab:undefined} tabIndex={mode==='inspector'?0:undefined}>
   {!records.length?<div className="activity-empty"><Clock3 size={24}/><p>这段对话尚无已记录的活动。</p><small>成员开始处理消息后，运行记录会显示在这里。</small></div>:<>
    {mode==='inspector'&&<label className="activity-select">查看哪次工作<select aria-label="检查器工作" value={record?.id} onChange={event=>setSelected(event.target.value)}>{records.map(item=><option key={item.id} value={item.id}>{time(item.createdAt)} · {activityStateLabels[item.state]??item.state}</option>)}</select></label>}
    {mode==='activity'?<ol className="activity-runs">{records.map(item=><li key={item.id}><RunSummary record={item} names={names(item)} onLocate={onLocate}/><button className="text-button" onClick={()=>{setSelected(item.id);setTab('runs');onInspect();}}>查看运行记录<ArrowRight size={14}/></button></li>)}</ol>:record&&<>
     {tab==='runs'&&<><RunSummary record={record} names={names(record)} onLocate={onLocate}/><h4 className="activity-subheading">已记录的步骤 · {record.events.length}</h4><ol className="activity-steps">{record.events.map((event,index)=><li key={index}><span>{activityEventLabel(event)}</span><small>{eventStateLabels[event.state]??event.state}</small>{event.code&&<p className="flow-error">{explain(event.code)}</p>}</li>)}</ol>{!record.events.length&&<p className="muted">这次工作没有可显示的工具步骤。原 Agent 的内部过程可能未上报。</p>}<button className="text-button" onClick={()=>setTab('events')}>查看事件详情<ArrowRight size={14}/></button></>}
     {tab==='events'&&<><p className="muted">已记录的工具事件。参数与返回值可能经过脱敏或缩短，不能作为完整执行审计。</p>{!record.events.length&&<p className="activity-empty">这次工作没有已记录的事件。</p>}{record.events.map((event,index)=><details className="activity-event" key={index}><summary><strong>{event.name}</strong><small>{eventStateLabels[event.state]??event.state}</small></summary><dl><dt>开始</dt><dd>{time(event.startedAt)}</dd><dt>结束</dt><dd>{time(event.finishedAt)}</dd>{event.botId&&<><dt>成员</dt><dd>{bots.find(bot=>bot.id===event.botId)?.name??'原成员'}</dd></>}</dl>{event.input!==undefined&&<><h4>参数记录</h4><pre>{event.input}</pre></>}{event.result!==undefined&&<><h4>返回记录</h4><pre>{event.result}</pre></>}{event.code&&<p className="flow-error">{explain(event.code)}</p>}{event.previewTruncated&&<small>此处只显示记录预览。</small>}</details>)}</>}
     {tab==='raw'&&<><p className="muted">当前工作已保存的记录投影。Raw 只包含运行与工具事件字段，不展开整份工作内部状态或宿主配置。内容可能经过脱敏或截断。</p><pre className="activity-raw" aria-label="Raw 运行记录">{JSON.stringify(record,null,2)}</pre></>}
     {record.eventsLimited&&<p className="muted">这里只保留最近最多 100 条事件；更早步骤可能不在记录中。</p>}
    </>}
    <p className="activity-limit muted">显示本会话最近最多 100 次工作；历史消息仍可在对话中查找。</p>
   </>}
  </div>
 </section>;
}
function RunSummary({record,names,onLocate}:{record:ActivityRecord;names:string;onLocate:(id:string)=>void}){
 const Icon=['blocked','unknown','stopped'].includes(record.state)?AlertCircle:record.state==='delivered'?CheckCircle2:Clock3;
 return <div className="activity-run"><header><Icon size={17}/><strong>{activityStateLabels[record.state]??record.state}</strong></header><time>{time(record.createdAt)}</time>{names&&<p>{names}</p>}{record.reason&&<p className="muted">{explain(record.reason)}</p>}<small>模型调用 {record.calls} 次 · 工具记录 {record.events.length} 条</small><div className="workspace-inline">{record.originId&&<button className="secondary" onClick={()=>onLocate(record.originId!)}>查看原消息</button>}{record.resultMessageIds.map((id,index)=><button className="secondary" key={id} onClick={()=>onLocate(id)}>查看答复{record.resultMessageIds.length>1?' '+(index+1):''}</button>)}</div></div>;
}
