import {EventRecord,useRecord} from './work-record-preview';
import {useEffect,useId,useState,useRef} from 'react';
import {ArrowLeft,ArrowRight,Activity,Bug,CheckCircle2,Clock3,AlertCircle} from 'lucide-react';
import {activityRecords,readableActivityEvents,activityStateLabels,activityEventLabel,eventStateLabels,type ActivityRecord} from '../../../src/protocol/activity-records';
import {api,explain,type Bot} from './api';

const time=(value?:string)=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString(): '时间未记录';
type Props={focusJobId?:string;roomId:string;jobs:any[];bots:Bot[];mode:'activity'|'inspector';onBack:()=>void;onInspect:()=>void;onLocate:(id:string)=>void};
export function ConversationActivity({focusJobId,roomId,jobs,bots,mode,onBack,onInspect,onLocate}:Props){
 const [tab,setTab]=useState<'runs'|'events'|'raw'>('runs'),[selected,setSelected]=useState(focusJobId??''),[page,setPage]=useState<any>(),[before,setBefore]=useState<number>(),[trail,setTrail]=useState<(number|undefined)[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(false),[attempt,setAttempt]=useState(0);
 const sequence=useRef(0);
 useEffect(()=>{if(focusJobId)setSelected(focusJobId);},[focusJobId]);
 useEffect(()=>{const id=++sequence.current;setLoading(true);setError('');void api.workRecords({roomId,before}).then(value=>{if(sequence.current===id)setPage(value);}).catch(error=>{if(sequence.current===id)setError(explain(error));}).finally(()=>{if(sequence.current===id)setLoading(false);});return()=>{sequence.current++;};},[roomId,before,attempt,before===undefined?jobs[0]?.id:undefined]);
 const items=new Map<string,any>((page?.jobs??jobs).map((job:any)=>[job.id,job]));
 for(const job of jobs){const prior=items.get(job.id);if(prior&&Number(job.viewRevision)>=Number(prior.viewRevision))items.set(job.id,job);}
 const selectedId=selected||focusJobId||[...items.keys()][0],base=items.get(selectedId),read=useRecord({roomId,jobId:selectedId,part:'summary'},mode==='inspector'&&!!selectedId,base?.viewRevision);
 if(read.data?.job&&(!base||read.data.viewRevision>=Number(base.viewRevision??0)))items.set(read.data.job.id,read.data.job);
 const uid=useId(),records=activityRecords([...items.values()],roomId),record=records.find(item=>item.id===selectedId)??(!selectedId?records[0]:undefined),steps=record?readableActivityEvents(record):[];
 const names=(item:ActivityRecord)=>item.botIds.map(id=>bots.find(bot=>bot.id===id)?.name.replace(/ · KTeam .+$/,'')??'原成员').join('、');
 const tabs=[['runs','运行记录'],['events','Events'],['raw','Raw']] as const;
 return <section className="conversation-activity" aria-label={mode==='activity'?'会话活动':'会话检查器'}>
  <button className="activity-back" onClick={onBack}><ArrowLeft size={15}/>返回详情</button>
  <header className="activity-heading">{mode==='activity'?<Activity size={20}/>:<Bug size={20}/>}<h3>{mode==='activity'?'活动':'检查器'}</h3></header>
  {mode==='inspector'?<div className="activity-tabs" role="tablist" aria-label="检查器记录类型">{tabs.map(([key,label],index)=><button key={key} id={uid+'-'+key} role="tab" aria-controls={uid+'-content'} aria-selected={tab===key} tabIndex={tab===key?0:-1} onClick={()=>setTab(key)} onKeyDown={event=>{const next=event.key==='ArrowRight'?(index+1)%3:event.key==='ArrowLeft'?(index+2)%3:event.key==='Home'?0:event.key==='End'?2:undefined;if(next!==undefined){event.preventDefault();setTab(tabs[next]![0]);document.getElementById(uid+'-'+tabs[next]![0])?.focus();}}}>{label}</button>)}</div>:<p className="muted">这段对话最近的工作、状态与结果。交付后的验收状态仍以原工作为准。</p>}
  {error&&<p className="flow-error" role="alert">{error}<button className="text-button" onClick={()=>setAttempt(value=>value+1)}>重新读取</button></p>}{read.error&&<p className="flow-error" role="alert">{read.error}<button className="text-button" onClick={read.retry}>重新读取原工作</button></p>}{(loading||read.loading)&&<p className="muted" role="status">正在核对原记录…</p>}
  <div id={uid+'-content'} role={mode==='inspector'?'tabpanel':undefined} aria-labelledby={mode==='inspector'?uid+'-'+tab:undefined} tabIndex={mode==='inspector'?0:undefined}>
   {!records.length?(loading||error?<p className="muted">原活动记录尚未核实。</p>:<div className="activity-empty"><Clock3 size={24}/><p>这段对话尚无已记录的活动。</p><small>成员开始处理消息后，运行记录会显示在这里。</small></div>):<>
    {mode==='inspector'&&<label className="activity-select">查看哪次工作<select aria-label="检查器工作" value={record?.id} onChange={event=>setSelected(event.target.value)}>{records.map(item=><option key={item.id} value={item.id}>{time(item.createdAt)} · {activityStateLabels[item.state]??item.state}</option>)}</select></label>}
    {mode==='activity'?<ol className="activity-runs">{records.map(item=><li key={item.id}><RunSummary record={item} names={names(item)} onLocate={onLocate}/><button className="text-button" onClick={()=>{setSelected(item.id);setTab('runs');onInspect();}}>查看运行记录<ArrowRight size={14}/></button></li>)}</ol>:record&&<>
     {tab==='runs'&&<><RunSummary record={record} names={names(record)} onLocate={onLocate}/><h4 className="activity-subheading">工具与交接步骤 · {steps.length}</h4><ol className="activity-steps">{steps.map((event,index)=><li key={index}><span>{activityEventLabel(event)}</span><small>{event.state==='running'&&!['routing','running'].includes(record.state)?'未报告终态':event.type==='tool_started'?'已开始':eventStateLabels[event.state]??event.state}</small>{event.code&&<p className="flow-error">{explain(event.code)}</p>}</li>)}</ol>{!steps.length&&<p className="muted">这次工作没有可显示的工具步骤。原 Agent 的内部过程可能未上报。</p>}<button className="text-button" onClick={()=>setTab('events')}>查看事件详情<ArrowRight size={14}/></button></>}
     {tab==='events'&&<><p className="muted">已记录的运行与工具事件。参数与返回值可能经过脱敏或缩短，不能作为完整执行审计。</p>{!record.events.length&&<p className="activity-empty">这次工作没有已记录的事件。</p>}{record.events.map(event=><EventRecord key={event.id} roomId={roomId} jobId={record.id} event={event} revision={items.get(record.id)?.viewRevision}/>)}</>}
     {tab==='raw'&&<><p className="muted">当前工作已保存的记录投影。Raw 只包含运行与工具事件字段，不展开整份工作内部状态或宿主配置。内容可能经过脱敏或截断。</p><pre className="activity-raw" aria-label="Raw 运行记录">{JSON.stringify(record,null,2)}</pre></>}
     {record.eventsLimited&&<p className="muted">当前为有界记录投影，更早步骤以原工作实际保留范围为准。</p>}
    </>}
    <p className="activity-limit muted">每页 20 次原工作；展开事件后读取已保存的参数和返回预览。</p>
   </>}
  </div>
  <div className="workspace-inline">{trail.length>0&&<button className="secondary" disabled={loading} onClick={()=>{setBefore(trail.at(-1));setTrail(value=>value.slice(0,-1));setSelected('');}}>上一页</button>}{page?.nextBefore!==undefined&&<button className="secondary" disabled={loading} onClick={()=>{setTrail(value=>[...value,before].slice(-1000));setBefore(page.nextBefore);setSelected('');}}>查看更早工作</button>}{before!==undefined&&<button className="text-button" onClick={()=>{setBefore(undefined);setTrail([]);setSelected('');}}>最近工作</button>}</div>
 </section>;
}
function RunSummary({record,names,onLocate}:{record:ActivityRecord;names:string;onLocate:(id:string)=>void}){
 const Icon=['blocked','unknown','stopped'].includes(record.state)?AlertCircle:record.state==='delivered'?CheckCircle2:Clock3;
 return <div className="activity-run"><header><Icon size={17}/><strong>{activityStateLabels[record.state]??record.state}</strong></header><time>{time(record.createdAt)}</time>{record.sourceLabel&&<p>{record.sourceLabel}</p>}{names&&<p>{names}</p>}{record.reason&&<p className="muted">{explain(record.reason)}</p>}<small>模型调用 {record.calls} 次 · 事件记录 {record.events.length} 条</small><div className="workspace-inline">{record.originId&&<button className="secondary" onClick={()=>onLocate(record.originId!)}>查看原消息</button>}{record.resultMessageIds.map((id,index)=><button className="secondary" key={id} onClick={()=>onLocate(id)}>查看答复{record.resultMessageIds.length>1?' '+(index+1):''}</button>)}</div></div>;
}
