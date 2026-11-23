import {useEffect,useRef,useState} from 'react';
import {ArrowRight,Clock3} from 'lucide-react';
import {dailySlotLabels,type DailyConfiguration,type DailySlot} from '../../../src/protocol/assistant-daily-types';
import {routineScheduleLabel} from '../../../src/protocol/routine-calendar';
import {api,explain,type Room} from './api';
import {setRoutineEnabled,type RoutineRow} from './room-routines';

type Followup={id:string;roomId:string;reason:string;dueAt:number;originMessageId:string;state:string};
type DailyPlan={effectivePaused?:boolean;config:null|Pick<DailyConfiguration,'paused'|'timeZone'|'weekdays'|'schedule'>;next?:{slot:DailySlot;next:number}|null};
type Row={id:string;title:string;status:string;at?:number;routine?:RoutineRow;open:()=>void};
type Props={room:Room;botIds:string[];roomPaused:boolean;onManage:()=>void;onToday:()=>void;onLocate:(id:string)=>void};

export function UpcomingWork({room,botIds,roomPaused,onManage,onToday,onLocate}:Props){
 const [data,setData]=useState<{rows:RoutineRow[];followups:Followup[];daily?:DailyPlan;partial:boolean}>();
 const [attempt,setAttempt]=useState(0),[error,setError]=useState(''),[pending,setPending]=useState<string>();
 const busy=useRef(false);
 const ids=JSON.stringify(botIds);
 const isAssistant=room.kind==='assistant';
 useEffect(()=>{
  let active=true;
  let timer:ReturnType<typeof setTimeout>;
  const load=async()=>{
   const [routines,daily,...followups]=await Promise.allSettled([
    api.routines(room.roomId),
    isAssistant?api.dailyWorkPlan():Promise.resolve(undefined),
    ...(JSON.parse(ids) as string[]).map(id=>api.botFollowups({botId:id,roomId:room.roomId})),
   ]);
   if(!active)return;
   setData({
    rows:routines.status==='fulfilled'?routines.value.items:[],
    daily:daily.status==='fulfilled'?daily.value:undefined,
    followups:followups.flatMap(result=>result.status==='fulfilled'?result.value.items:[]),
    partial:[routines,daily,...followups].some(result=>result.status==='rejected'),
   });
   timer=setTimeout(()=>void load(),15000);
  };
  void load();
  return ()=>{active=false;clearTimeout(timer);};
 },[room.roomId,isAssistant,ids,attempt]);

 const toggle=async(row:RoutineRow)=>{
  if(busy.current)return;
  busy.current=true;setPending(row.id);setError('');
  try{await setRoutineEnabled(room.roomId,row,!row.enabled,'upcoming:'+row.id+':'+row.revision);}
  catch(cause){setError(explain(cause));}
  finally{busy.current=false;setPending(undefined);setAttempt(value=>value+1);}
 };
 const rows:Row[]=[];
 for(const routine of data?.rows??[]){
  if(routine.enabled&&!routine.nextAt&&!routine.needsReview)continue;
  if(routine.schedule.kind==='once'&&routine.runCount>0&&!routine.needsReview)continue;
  const at=routine.enabled&&!routine.needsReview?routine.nextAt??undefined:undefined;
  rows.push({id:routine.id,title:routine.name,at,routine,open:onManage,
   status:routine.needsReview?'需要核对上次结果':!routine.enabled?'已暂停':roomPaused?'会话已暂停':at!==undefined?routineScheduleLabel(routine.schedule,routine.timeZone):'后续触发已结束'});
 }
 for(const followup of data?.followups??[]){
  if(followup.roomId!==room.roomId||followup.state!=='pending')continue;
  rows.push({id:followup.id,title:followup.reason,at:followup.dueAt,status:routineScheduleLabel({kind:'once',at:followup.dueAt}),open:()=>onLocate(followup.originMessageId)});
 }
 const daily=data?.daily;
 if(daily?.config&&(daily.next||daily.config.paused||daily.effectivePaused)){
  const at=daily.next?.next;
  const time=daily.next?daily.config.schedule[daily.next.slot]:null;
  rows.push({id:'daily-brief',title:daily.next?'小 K '+dailySlotLabels[daily.next.slot]:'小 K 简报',at,open:onToday,
   status:daily.config.paused||daily.effectivePaused||roomPaused?'已暂停':time?routineScheduleLabel({kind:'daily',weekdays:daily.config.weekdays,time}):'尚未安排'});
 }
 rows.sort((left,right)=>(left.at??Infinity)-(right.at??Infinity));
 return <section className="workspace-section upcoming-work" aria-label="即将进行">
  <header><h3>即将进行</h3><button type="button" className="text-button" onClick={onManage}>例行任务<ArrowRight size={13}/></button></header>
  {!data?<p className="muted" role="status">正在读取安排…</p>:null}
  {data?.partial&&<p className="muted" role="status">部分安排暂不可用。<button type="button" className="text-button" onClick={()=>setAttempt(value=>value+1)}>重试</button></p>}
  {error&&<p className="flow-error" role="alert">{error}</p>}
  {data&&!data.partial&&!rows.length&&<p className="muted">当前会话暂无安排。</p>}
  {rows.length>0&&<ul className="upcoming-list">{rows.slice(0,5).map(row=>{
   const routine=row.routine;
   const canToggle=routine&&!routine.needsReview&&routine.runCount<routine.maxRuns;
   return <li key={row.id}>
    <Clock3 size={16} aria-hidden="true"/>
    <button type="button" className="upcoming-row-link" onClick={row.open}>
     <strong>{row.title}</strong><small>{row.status}</small>
    </button>
    {canToggle?<button type="button" className={'settings-switch '+(routine.enabled?'on':'')} role="switch" aria-label={row.title}
     aria-checked={routine.enabled} disabled={Boolean(pending)||(!routine.enabled&&roomPaused)} onClick={()=>void toggle(routine)}><span/></button>
    :<ArrowRight size={14} aria-hidden="true"/>}
   </li>;
  })}</ul>}
 </section>;
}
