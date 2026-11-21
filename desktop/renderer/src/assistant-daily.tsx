import {useCallback,useEffect,useState} from 'react';
import {api,explain} from './api';
import type {DailyConfiguration,DailyCoverage,DailyItem,DailySource} from '../../../src/protocol/assistant-daily';

const slots=['morning','midday','evening'] as const;
const slotLabel={morning:'早报',midday:'午报',evening:'晚报'};
const kindLabel={mail:'邮件','yzj-message':'云之家消息','yzj-calendar':'云之家日程','yzj-doc':'云之家知识库',news:'公开资讯'};
const key=(source:DailySource)=>JSON.stringify([source.kind,source.account,source.id]);
const format=(at:number,timeZone?:string)=>new Intl.DateTimeFormat('zh-CN',{timeZone,dateStyle:'short',timeStyle:'short'}).format(at);
interface Draft {
 id:string; previousRevision:number; config:DailyConfiguration; skips:string[];
 change:{sourceKinds?:DailySource['kind'][];skipToday?:keyof typeof slotLabel};
}
interface Plan {
 config:DailyConfiguration|null;
 draft?:Draft;
 next?:{slot:keyof typeof slotLabel;next:number}|null;
}
interface Today extends Plan {
 items:DailyItem[];
 coverage:DailyCoverage[];
 briefs:{id:string;slot:keyof typeof slotLabel;day:string;at:number;items:DailyItem[];coverage:DailyCoverage[];missed?:boolean}[];
}
function describePlan(config:DailyConfiguration) {
 if(config.paused)return '每日工作已暂停';
 const schedule=slots.flatMap(slot=>config.schedule[slot]?[slotLabel[slot]+' '+config.schedule[slot]]:[]);
 return schedule.length?schedule.join(' · '):'未设置简报时段';
}

export function AssistantDailyPlan({onPlan}:{onPlan:()=>void}){
 const [data,setData]=useState<Plan>();
 const [error,setError]=useState('');
 const load=useCallback(async()=>{
  try{setData(await api.dailyWorkPlan());setError('');}catch(e){setError(explain(e));}
 },[]);
 useEffect(()=>{void load();const timer=setInterval(()=>void load(),3000);return ()=>clearInterval(timer);},[load]);
 if(!data)return error?<p className="settings-error" role="alert">{error}</p>:null;
 if(data.draft)return <DraftCard key={data.draft.id} draft={data.draft} previous={data.config} onSaved={()=>void load()}/>;
 if(!data.config)return <button className="secondary" onClick={onPlan}>和小 K 设定每日工作</button>;
 return <div className="assistant-daily-plan-receipt"><strong>{describePlan(data.config)}</strong>{data.next&&<span>下次{slotLabel[data.next.slot]} {format(data.next.next,data.config.timeZone)}</span>}<button className="secondary" onClick={onPlan}>在对话中调整</button></div>;
}

function DraftCard({draft,previous,onSaved}:{draft:Draft;previous:DailyConfiguration|null;onSaved:()=>void}){
 const [selected,setSelected]=useState<DailySource[]>(draft.config.sources);
 const [available,setAvailable]=useState<DailySource[]>([]);
 const [topic,setTopic]=useState('');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [yzjLoaded,setYzjLoaded]=useState(false);
 const [yzjAvailable,setYzjAvailable]=useState(false);
 const visible=[...new Map([...selected,...available].map(source=>[key(source),source])).values()];
 const act=async(action:()=>Promise<void>)=>{setError('');setBusy(true);try{await action();}catch(e){setError(explain(e));}finally{setBusy(false);}};
 function toggle(source:DailySource){
  setSelected(items=>items.some(item=>key(item)===key(source))?items.filter(item=>key(item)!==key(source)):[...items,source]);
 }
 return <section className="proposal-card assistant-daily-card" aria-label="每日工作方案">
  <h3>每日工作方案</h3>
  {previous&&<p>当前 · {describePlan(previous)}</p>}
  <p>确认后 · {describePlan(draft.config)}</p>
  <p>{draft.config.timeZone} · 周{draft.config.weekdays.join('、')}</p>
  {draft.config.middayUrgentOnly&&<p>午报只显示紧急事项</p>}
  {draft.change.skipToday&&<p>今日跳过{slotLabel[draft.change.skipToday]}</p>}
  {draft.change.sourceKinds?.length!==undefined&&draft.change.sourceKinds.length>0&&<p>待选择来源 · {draft.change.sourceKinds.map(kind=>kindLabel[kind]).join('、')}</p>}
  <fieldset disabled={busy}>
   <legend>允许后台读取的来源</legend>
   {visible.map(source=><label key={key(source)}><input type="checkbox" checked={selected.some(value=>key(value)===key(source))} onChange={()=>toggle(source)}/>{kindLabel[source.kind]} · {source.label}</label>)}
  </fieldset>
  <div className="assistant-daily-actions">
   <button className="secondary" disabled={busy} onClick={()=>void act(async()=>{const data=await api.dailyWorkSources(false);setAvailable(items=>[...items.filter(source=>source.kind!=='mail'),...data.sources]);if(!data.sources.length)setError('还没有连接邮箱。');})}>选择邮箱</button>
   <button className="secondary" disabled={busy} onClick={()=>void act(async()=>{const data=await api.dailyWorkSources(true);setAvailable(items=>[...items.filter(source=>source.kind==='news'),...data.sources]);setYzjAvailable(data.yzjAvailable);setYzjLoaded(true);})}>选择云之家来源</button>
  </div>
  {yzjLoaded&&!yzjAvailable&&<p role="status">暂时无法读取云之家来源。可先确认其他来源。</p>}
  <form className="assistant-daily-actions" onSubmit={event=>{event.preventDefault();if(topic.trim())void act(async()=>{const result=await api.dailyWorkNews({topic:topic.trim()});setSelected(items=>[...items.filter(item=>key(item)!==key(result.source)),result.source]);setTopic('');});}}>
    <input aria-label="可用于公开搜索的关键词" placeholder="可公开搜索的资讯关键词" maxLength={160} value={topic} onChange={event=>setTopic(event.target.value)}/>
    <button className="secondary" disabled={busy||!topic.trim()} type="submit">添加订阅</button>
  </form>
  {error&&<p className="settings-error" role="alert">{error}</p>}
  <button className="primary" disabled={busy} onClick={()=>void act(async()=>{await api.confirmDailyWork({id:draft.id,expectedRevision:draft.previousRevision,sources:selected});onSaved();})}>确认并应用</button>
 </section>;
}

export function AssistantDailyToday({destinations,onTask}:{destinations:{roomId:string;title:string}[];onTask:(roomId:string,text:string)=>void}){
 const [task,setTask]=useState<DailyItem>();
 const [reply,setReply]=useState<{item:DailyItem;text:string|null}>();
 const [destination,setDestination]=useState('');
 const [view,setView]=useState<Today>();
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [original,setOriginal]=useState<{subject:string;body:string}>();
 const act=useCallback(async(action:()=>Promise<void>)=>{setBusy(true);setError('');try{await action();}catch(e){setError(explain(e));}finally{setBusy(false);}},[]);
 useEffect(()=>{void act(async()=>setView(await api.dailyWorkToday()));},[act]);
 const prepareTask=(item:DailyItem)=>{
  setTask(item);
  setDestination('');
 };
 const loadOriginal=(id:string)=>void act(async()=>{const result=await api.dailyWorkOriginal({id});if(result.mail)setOriginal(result.mail);else if(result.url)await api.openWebLink({url:result.url});else setError('这个来源没有提供可打开的原文链接。');});
 const timeZone=view?.config?.timeZone;
 const unseen=view?.coverage.filter(row=>row.state!=='ok')??[];
 function list(items:DailyItem[]){
  return <ul className="assistant-daily-items">{items.map(item=><li key={item.id}>
   <div><strong>{item.title}</strong><small>{item.source.label}{item.deadline?' · '+format(item.deadline,timeZone):''}</small><p>{item.detail}</p></div>
   <div className="assistant-daily-actions">
    {(item.url||item.source.kind==='mail')&&<button className="secondary" disabled={busy} onClick={()=>loadOriginal(item.id)}>看原文</button>}
    {(item.source.kind==='mail'||item.source.kind==='yzj-message')&&<button className="secondary" disabled={busy} onClick={()=>setReply({item,text:null})}>准备回复</button>}
    {destinations.length>0&&<button className="secondary" disabled={busy} onClick={()=>prepareTask(item)}>转任务</button>}
    {view?.items.some(row=>row.id===item.id)&&<button className="secondary" disabled={busy} onClick={()=>void act(async()=>setView(await api.snoozeDailyWork({id:item.id})))}>一小时后再看</button>}
   </div>
  </li>)}</ul>;
 }
 return <div className="assistant-daily-today">
  <div className="assistant-daily-actions">
   <span>{view?.config?describePlan(view.config):'在小 K 私聊里确定每日工作。'}</span>
   {view?.config&&<button className="secondary" disabled={busy||view.config.paused} onClick={()=>void act(async()=>{setOriginal(undefined);setView(await api.refreshDailyWork());})}>运行一次</button>}
  </div>
  {error&&<p className="settings-error" role="alert">{error}</p>}
  {unseen.length>0&&<details><summary>有 {unseen.length} 个来源未查完</summary><ul>{unseen.map(row=><li key={key(row.source)}>{row.source.label} · {row.state==='partial'?'覆盖不完整':'暂不可用'}{row.checkedAt?' · '+format(row.checkedAt,timeZone):''}</li>)}</ul></details>}
  {reply&&<section className="proposal-card">
   <h3>回复草稿</h3><p>{reply.item.title} · {reply.item.source.label}</p>
   {reply.text===null?<p>生成草稿时，会将裁剪后的当前消息交给小 K 绑定的模型处理。</p>:<textarea aria-label="编辑回复草稿" value={reply.text} onChange={event=>setReply({...reply,text:event.target.value})}/>}
   <div className="assistant-daily-actions">
    <button className="secondary" disabled={busy} onClick={()=>setReply(undefined)}>关闭</button>
    {reply.text===null?<button className="primary" disabled={busy} onClick={()=>void act(async()=>setReply({...reply,text:(await api.dailyWorkReplyDraft({id:reply.item.id,allowModel:true})).text}))}>允许并生成草稿</button>:<button className="primary" disabled={!reply.text.trim()||busy} onClick={()=>void act(async()=>{await navigator.clipboard.writeText(reply.text!);})}>复制草稿</button>}
   </div>
  </section>}
  {task&&<section className="proposal-card">
   <h3>转任务</h3><p>{task.title}</p>
   <label>选择接手会话 <select value={destination} onChange={event=>setDestination(event.target.value)}>
    <option value="">请选择</option>{destinations.map(room=><option key={room.roomId} value={room.roomId}>{room.title}</option>)}
   </select></label>
   <div className="assistant-daily-actions">
    <button className="secondary" onClick={()=>setTask(undefined)}>取消</button>
    <button className="primary" disabled={!destination} onClick={()=>onTask(destination,[
     '请跟进事项「'+task.title+'」。',
     '来源：'+kindLabel[task.source.kind]+' · '+task.source.label,
     ...(task.url?[task.url]:[]),
     '完成时请回报已核实的结果及仍待确认的事项。',
    ].join('\n'))}>在会话中编辑</button>
   </div>
  </section>}
  {original&&<section className="proposal-card"><h3>{original.subject}</h3><pre>{original.body}</pre><button className="secondary" onClick={()=>setOriginal(undefined)}>关闭原文</button></section>}
  {view?.items.some(item=>item.urgent)&&<section><h3>需要你处理</h3>{list(view.items.filter(item=>item.urgent).slice(0,3))}{view.items.filter(item=>item.urgent).length>3&&<details><summary>还有 {view.items.filter(item=>item.urgent).length-3} 项需要处理</summary>{list(view.items.filter(item=>item.urgent).slice(3))}</details>}</section>}
  {!!view?.items.some(item=>!item.urgent)&&<section><h3>接下来的安排和关注事项</h3>{list(view.items.filter(item=>!item.urgent))}</section>}
  {!!view?.briefs.length&&<section><h3>简报</h3>{view.briefs.map(brief=><details key={brief.id}><summary>{brief.day} {slotLabel[brief.slot]}{brief.missed?' · 已错过':''}</summary>{brief.items.length?list(brief.items):<p>{brief.missed?'本期没有补投。':brief.coverage.some(row=>row.state==='ok')?'已核对的范围内没有新增事项。':'本期没有可确认的来源结果。'}</p>}{brief.coverage.length>0&&<ul>{brief.coverage.map(row=><li key={key(row.source)}>{row.source.label} · {row.state==='ok'?'已核对':row.state==='partial'?'覆盖不完整':'暂不可用'} · 起点 {format(row.from,timeZone)}</li>)}</ul>}</details>)}</section>}
 </div>;
}
