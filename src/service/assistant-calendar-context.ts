import {calendarWindow} from '../runtime/calendar.js';
import type {DailyItem,DailyMessageAttention} from '../protocol/assistant-daily-types.js';

export function messageCalendarDate(text:string,stamp:number,timeZone:string):string|undefined {
 const today=calendarWindow(new Date(stamp),timeZone).today;
 const explicit=[...text.matchAll(/(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*(?:日|号)/g)];
 if(explicit.length){
  const dates=new Set<string>();
  for(const [,year,month,day] of explicit){
   const explicitYear=explicit.find(other=>other[1]&&Number(other[2])===Number(month)&&Number(other[3])===Number(day))?.[1];
   const date=(year??explicitYear??today.slice(0,4))+'-'+month!.padStart(2,'0')+'-'+day!.padStart(2,'0');
   const parsed=Date.parse(date);
   if(!Number.isFinite(parsed)||!new Date(parsed).toISOString().startsWith(date))return;
   dates.add(date);
  }
  return dates.size===1?[...dates][0]:undefined;
 }
 if(/(?:本周|下周|周[一二三四五六日天]|星期)/.test(text))return;
 const offset=/后天/.test(text)?2:/明天|明早|明晚/.test(text)?1:0;
 return new Date(Date.parse(today)+offset*86400000).toISOString().slice(0,10);
}

export type CalendarContext={observation:string;choices?:string[]};

export function invitationTimeRange(text:string):{start:string;end:string}|undefined{
 const ranges=new Map<string,{start:string;end:string}>();
 for(const match of text.matchAll(/(?:(上午|下午|中午|晚上|凌晨)\s*)?(?<![\d:：])([01]?\d|2[0-3])[:：]([0-5]\d)\s*(?:[–—~～-]|至|到)\s*([01]?\d|2[0-3])[:：]([0-5]\d)(?!\d)/g)){
  const [,period,h1,m1,h2,m2]=match;
  if(period==='中午'&&(Number(h1)<11||Number(h2)<11))return;
  const hour=(value:string)=>String(Number(value)+((period==='下午'||period==='晚上')&&Number(value)<12?12:0)).padStart(2,'0');
  const start=hour(h1!)+':'+m1,end=hour(h2!)+':'+m2;
  if(end<=start)return;
  ranges.set(start+'-'+end,{start,end});
 }
 return ranges.size===1?ranges.values().next().value:undefined;
}

export function invitationContext(attention:DailyMessageAttention,date:string,entries:DailyItem[],partial:boolean,timeZone:string):CalendarContext {
 const range=invitationTimeRange(attention.text);
 if(!range)return {observation:'会议时间范围还需在原消息中确认。',choices:['收到议程','请发会议时间和材料']};
 const start=date+' '+range.start,end=date+' '+range.end;
 const format=new Intl.DateTimeFormat('sv-SE',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 const normalize=(text:string)=>text.toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
 const context=normalize(attention.text+' '+attention.group);
 const overlap=entries.filter(entry=>entry.calendarBusy===true&&Number.isFinite(entry.deadline)&&Number.isFinite(entry.calendarEnd)&&
  format.format(entry.deadline!)<end&&format.format(entry.calendarEnd!)>start);
 const exact=overlap.filter(entry=>normalize(entry.title).length>=3&&context.includes(normalize(entry.title))&&
  format.format(entry.deadline!)===start&&format.format(entry.calendarEnd!)===end);
 const conflicts=overlap.filter(entry=>!exact.includes(entry));
 if(conflicts.length)return {
  observation:'已核对 '+date+' 日历，与「'+conflicts.map(entry=>entry.title).slice(0,2).join('、')+'」时间冲突。',
  choices:['收到议程','请先把会议材料发我','时间有冲突，协调后再确认'],
 };
 if(exact.length===1)return {observation:'已核对 '+date+' 日历，这场会议已在日程中。',choices:['收到议程','请先把会议材料发我']};
 return {observation:partial?'已查看 '+date+' 日历的可见记录，日历覆盖不完整，参会待确认。':'已核对 '+date+' 日历，未找到可确认是同一场的日程，参会待确认。',
  choices:['收到议程','请先把会议材料发我','我核对安排后再确认']};
}
