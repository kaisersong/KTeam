import {useEffect,useState} from 'react';
import {localWatchTime,parseWatchTime,watchActions,watchDefaults,watchDisplay,watchError,watchStates,watchStatuses,type WatchCommand,type WatchItem} from '../../../src/protocol/assistant-watch';
import {api} from './api';

type Editor={id:string;revision?:number;title:string;condition:string;kind:'waiting'|'commitment';check:string;stop:string;link:string;calendarDay:string;calendarTitles:string;itemId?:string;sourceLinked?:boolean};

export function AssistantWatches({reference,onClearReference}:{reference?:string;onClearReference:()=>void}){
 const [snapshot,setSnapshot]=useState<{items:WatchItem[];at:number}>();
 const [clock,setClock]=useState(Date.now);
 const [editor,setEditor]=useState<Editor>();
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 const publish=(items:WatchItem[])=>{const at=Date.now();setSnapshot({items,at});setClock(at);};
 useEffect(()=>{
  let current=true;
  void api.dailyWatches().then(value=>{if(current)publish(value.items);}).catch(()=>{if(current)setError('暂时无法读取事项。');});
  const timer=window.setInterval(()=>setClock(Date.now()),1000);
  return ()=>{current=false;window.clearInterval(timer);};
 },[]);
 const view=snapshot?.items.map(item=>watchDisplay(item,snapshot.at,clock));
 const change=async(input?:WatchCommand)=>{
  setBusy(true);setError('');
  try{publish((await (input?api.changeDailyWatch(input):api.dailyWatches())).items);return true;}
  catch(cause){setError(watchError(cause));return false;}
  finally{setBusy(false);}
 };
 const openLink=async(item:WatchItem,kind:'link'|'originalLink')=>{
  setBusy(true);setError('');
  try{
   const {items}=await api.dailyWatches();
   publish(items);
   const url=items.find(row=>row.id===item.id&&row.revision===item.revision)?.details?.[kind];
   if(!url)throw Error('daily_source_unavailable');
   await api.openWebLink({url});
  }catch(cause){setError(watchError(cause));}
  finally{setBusy(false);}
 };
 const openEditor=(item?:WatchItem,itemId?:string)=>{
  const defaults=watchDefaults();
  const details=item?.details??defaults;
  setEditor({title:details.title,condition:details.condition,kind:details.kind,link:item?.details?.link??'',
   check:localWatchTime(item?.checkAt??defaults.checkAt),stop:localWatchTime(item?.stopAt??defaults.stopAt),
   id:item?.id??crypto.randomUUID(),revision:item?.revision,itemId,sourceLinked:item?.sourceLinked===true,
   calendarDay:item?.details?.calendar?.day??'',calendarTitles:item?.details?.calendar?.titles.join('\n')??''});
 };
 useEffect(()=>{
  if(!reference)return;
  const defaults=watchDefaults();
  setEditor({title:'',condition:'',kind:'waiting',link:'',calendarDay:'',calendarTitles:'',check:localWatchTime(defaults.checkAt),stop:localWatchTime(defaults.stopAt),id:crypto.randomUUID(),itemId:reference});
  onClearReference();
 },[reference,onClearReference]);
 const submit=async(value:Editor)=>{
  const titles=value.calendarTitles.split('\n').map(title=>title.trim()).filter(Boolean);
  if(Boolean(value.calendarDay)!==Boolean(titles.length)){setError('请同时填写日历日期和要复核的会议名称。');return;}
  const calendar=value.calendarDay?{day:value.calendarDay,titles}:undefined;
  const draft={title:value.title,condition:value.condition,kind:value.kind,checkAt:parseWatchTime(value.check),stopAt:parseWatchTime(value.stop),link:value.link.trim()||undefined,itemId:value.itemId,calendar};
  if(await change(value.revision?{action:'edit',id:value.id,expectedRevision:value.revision,draft,clearCalendar:!calendar}:{action:'create',id:value.id,draft}))setEditor(undefined);
 };
 const renderItem=(item:WatchItem)=><li key={item.id}>
  <div><strong>{item.details?.title??'来源暂不可见的事项'}</strong>
   <small>{item.state==='active'?watchStatuses[item.status]:watchStates[item.state]} · {new Date(item.checkAt).toLocaleString('zh-CN')}</small>
   {item.details&&<p>{item.details.condition}</p>}
   {item.decision&&<p>已记录{item.decision.choice==='online'?'线上参加':'不参加'}：{item.decision.titles.join('、')}</p>}
   <details><summary>检查与停止条件</summary>
    <p>{item.details?.kind==='commitment'?'本人确认的承诺':'手动核对回音'} · 停止时间 {new Date(item.stopAt).toLocaleString('zh-CN')}</p>
    {item.checkedAt&&<p>上次自查 {new Date(item.checkedAt).toLocaleString('zh-CN')}</p>}
    {item.details?.originalLink&&<button className="secondary" disabled={busy} onClick={()=>void openLink(item,'originalLink')}>打开原消息</button>}
    {item.details?.link&&<button className="secondary" disabled={busy} onClick={()=>void openLink(item,'link')}>打开已登记链接</button>}
   </details>
  </div>
  <div className="assistant-daily-actions">
   {item.details&&['active','paused'].includes(item.state)&&<button className="secondary" disabled={busy} onClick={()=>openEditor(item)}>修改</button>}
   {watchActions(item).map(({action,label})=><button key={action} className="secondary" disabled={busy} onClick={()=>void change({action,id:item.id,expectedRevision:item.revision})}>{label}</button>)}
  </div>
 </li>;
 const attention=view?.filter(item=>item.state==='active'&&['due','missed'].includes(item.status))??[];
 return <section aria-label="我让小 K 盯着什么">
  <div className="assistant-daily-actions"><h3>我让小 K 盯着什么</h3><button className="secondary" disabled={busy} onClick={()=>openEditor()}>登记事项</button><button className="secondary" disabled={busy} onClick={()=>void change()}>刷新事项</button></div>
  {error&&<p role="alert">{error}</p>}
  {editor&&(!editor.sourceLinked||view?.some(item=>item.id===editor.id&&item.details))&&<form className="proposal-card assistant-watch-editor" onSubmit={event=>{event.preventDefault();void submit(editor);}}>
   <p>{editor.itemId?'小 K 到点复核原消息的可见性，并在私聊提醒。':'小 K 到点在私聊提醒。填写日历日期和会议名还可复核日程。'}</p>
   <label>事项<input required maxLength={160} value={editor.title} onChange={event=>setEditor({...editor,title:event.target.value})}/></label>
   <label>要核对的结果<textarea required maxLength={500} value={editor.condition} onChange={event=>setEditor({...editor,condition:event.target.value})}/></label>
   <label>类型<select value={editor.kind} onChange={event=>setEditor({...editor,kind:event.target.value==='commitment'?'commitment':'waiting'})}><option value="waiting">等对方回音</option><option value="commitment">本人承诺</option></select></label>
   <label>检查时间<input required type="datetime-local" value={editor.check} onChange={event=>setEditor({...editor,check:event.target.value})}/></label>
   <label>停止时间<input required type="datetime-local" value={editor.stop} onChange={event=>setEditor({...editor,stop:event.target.value})}/></label>
   <label>日历日期（选填）<input type="date" value={editor.calendarDay} onChange={event=>setEditor({...editor,calendarDay:event.target.value})}/></label>
   <label>会议名称（每行一场）<textarea maxLength={600} value={editor.calendarTitles} onChange={event=>setEditor({...editor,calendarTitles:event.target.value})}/></label>
   <label>来源链接（选填）<input type="url" maxLength={1000} value={editor.link} onChange={event=>setEditor({...editor,link:event.target.value})}/></label>
   <div className="assistant-daily-actions"><button type="button" className="secondary" onClick={()=>setEditor(undefined)}>取消</button><button className="primary" disabled={busy}>确认{editor.revision?'修改':'登记'}</button></div>
  </form>}
  {attention.length>0&&<><h4>今天需要我</h4><ul className="assistant-daily-items">{attention.slice(0,3).map(renderItem)}</ul></>}
  {view?.length===0&&<p>登记要等的回音或已确认的个人承诺。</p>}
  {!!view?.length&&<details open={attention.length===0}><summary>全部事项（{view.length}）{attention.length>3?' · 另有 '+(attention.length-3)+' 项待自查':''}</summary><ul className="assistant-daily-items">{view.map(renderItem)}</ul></details>}
 </section>;
}
