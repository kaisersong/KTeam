import {calendarWindow} from '../runtime/calendar.js';
import type {DailyItem,DailyMessageAttention} from '../protocol/assistant-daily-types.js';

const dayMs=86400000;
const weekday=(name:string)=>'日一二三四五六'.indexOf(name==='天'?'日':name);

export function messageCalendarDate(text:string,stamp:number,timeZone:string,kind:'schedule'|'invitation'='schedule'):string|undefined {
 const today=calendarWindow(new Date(stamp),timeZone).today;
 const todayAt=Date.parse(today),currentYear=Number(today.slice(0,4));
 const explicit=[...text.matchAll(/(?:(?:(\d{4})\s*年|(去年|今年|明年|后年))\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*(?:日|号)(?:\s*[（(]?\s*(?:周|星期|礼拜)([日天一二三四五六])[）)]?)?/g)];
 if(explicit.length){
  const [, , , month,day]=explicit[0]!;
  if(explicit.some(match=>Number(match[3])!==Number(month)||Number(match[4])!==Number(day)))return;
  const years=new Set(explicit.flatMap(([,year,relative])=>year?[Number(year)]:relative?[currentYear+['去年','今年','明年','后年'].indexOf(relative)-1]:[]));
  if(years.size>1)return;
  const dateIn=(year:number)=>String(year).padStart(4,'0')+'-'+month!.padStart(2,'0')+'-'+day!.padStart(2,'0');
  let date=dateIn(years.values().next().value??currentYear);
  if(!years.size&&kind==='invitation'){
   // If the closest occurrence has already passed, the notice may be old.
   // Do not move it into another year just to obtain a future date.
   const sameYear=Date.parse(date);
   if(!Number.isFinite(sameYear))return;
   const other=dateIn(currentYear+(sameYear<todayAt?1:-1));
   const currentDistance=Math.abs(sameYear-todayAt),otherDistance=Math.abs(Date.parse(other)-todayAt);
   if(currentDistance===otherDistance)return;
   if(otherDistance<currentDistance)date=other;
   if(Date.parse(date)<todayAt)return;
  }
  const parsed=new Date(date);
  if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==date)return;
  if(kind==='invitation'&&explicit.some(match=>match[5]&&weekday(match[5])!==parsed.getUTCDay()))return;
  return date;
 }
 if(kind==='invitation'){
  const offsets=new Set([...text.matchAll(/今天|今早|今晚|明天|明早|明晚|后天/g)].map(([word])=>word==='后天'?2:word.startsWith('明')?1:0));
  if(offsets.size!==1)return;
  const date=new Date(todayAt+offsets.values().next().value!*dayMs);
  const days=[...text.matchAll(/(?:今天|今早|今晚|明天|明早|明晚|后天)\s*[（(]?\s*(?:周|星期|礼拜)([日天一二三四五六])/g)];
  return days.some(match=>weekday(match[1]!)!==date.getUTCDay())?undefined:date.toISOString().slice(0,10);
 }
 if(/(?:本周|下周|周[一二三四五六日天]|星期)/.test(text))return;
 const offset=/后天/.test(text)?2:/明天|明早|明晚/.test(text)?1:0;
 return new Date(todayAt+offset*dayMs).toISOString().slice(0,10);
}

export type CalendarContext={date?:string;observation:string;choices?:string[]};
export const invitationCalendarPending='日历暂未核实，参会待确认。';
export const invitationDateQuestion='请确认会议日期（含年份），再核对日历。';
export function invitationCalendar(attention:DailyMessageAttention,timeZone:string):CalendarContext{
 const date=messageCalendarDate(attention.text,attention.at,timeZone,'invitation');
 return date?{date,observation:invitationCalendarPending}:{observation:invitationDateQuestion};
}

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
 if(!range)return {date,observation:'会议时间范围还需在原消息中确认。',choices:['收到议程','请发会议时间和材料']};
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
  date,
  observation:'已核对 '+date+' 日历，与「'+conflicts.map(entry=>entry.title).slice(0,2).join('、')+'」时间冲突。',
  choices:['收到议程','请先把会议材料发我','时间有冲突，协调后再确认'],
 };
 if(exact.length===1)return {date,observation:'已核对 '+date+' 日历，这场会议已在日程中。',choices:['收到议程','请先把会议材料发我']};
 return {date,observation:partial?'已查看 '+date+' 日历的可见记录，日历覆盖不完整，参会待确认。':'已核对 '+date+' 日历，未找到可确认是同一场的日程，参会待确认。',
  choices:['收到议程','请先把会议材料发我','我核对安排后再确认']};
}
