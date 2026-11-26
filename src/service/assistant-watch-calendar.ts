import {createHash} from 'node:crypto';
import {messageCalendarDate} from './assistant-calendar-context.js';
import type {WatchMeetingReview} from '../protocol/assistant-watch.js';
import type {DailyItem} from '../protocol/assistant-daily-types.js';

const normalized=(text:string)=>text.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu,'').toLowerCase();
export const watchText=(value:string)=>value.replace(/[\r\n\u0000-\u001f]/g,' ').replace(/[\\`*_{}\[\]<>!#]/g,'\\$&');

export function assessWatchCalendar(input:WatchMeetingReview,entries:DailyItem[],messages:DailyItem[],partial:boolean,timeZone:string){
 const time=new Intl.DateTimeFormat('zh-CN',{timeZone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 const date=new Intl.DateTimeFormat('sv-SE',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'});
 const verified:{title:string;id:string;start:number;end:number}[]=[];
 const lines=[input.day+' 日历复核'+(partial?'（覆盖不完整）':'')];
 for(const title of [...new Set(input.titles)]){
  const key=normalized(title);
  const matches=entries.filter(item=>key&&normalized(item.title)===key&&item.deadline!==undefined&&Number.isFinite(item.deadline)&&date.format(item.deadline)===input.day);
  const cancellation=messages.some(item=>{
   const notice=item.messageAttention;
   if(notice?.kind!=='schedule'||!key)return false;
   const original=notice.text.split(/[，,；;。]\s*(?:下周|下次|改为|改到|另行|恢复)/,1)[0]??'';
   return normalized(original).includes(key)&&/(?:取消(?:一期|本次|这次)|(?:已|确定)取消|不再召开|会议取消)/.test(original)&&
    messageCalendarDate(original,notice.at,timeZone)===input.day;
  });
  const label='- '+watchText(title)+' · ';
  if(cancellation){
   lines.push(label+(matches.length?'日历仍列出，已读到的群通知提到取消，请核对。':'已读到的群通知提到取消，请以原通知为准。'));
   continue;
  }
  const match=matches.length===1?matches[0]:undefined;
  if(!match||match.deadline===undefined||match.calendarEnd===undefined){
   lines.push(label+(matches.length>1?'匹配到多个日程，请核对。':'未确认日历安排，请核对。'));
   continue;
  }
  lines.push(label+time.format(match.deadline)+'–'+time.format(match.calendarEnd)+' · 日历仍列出');
  verified.push({title,id:match.id,start:match.deadline,end:match.calendarEnd});
 }
 const verifiedTitles=verified.length?verified.map(item=>item.title):undefined;
 const evidenceDigest=verified.length?createHash('sha256').update(JSON.stringify([input.day,verified])).digest('hex'):undefined;
 return {lines,verifiedTitles,evidenceDigest};
}
