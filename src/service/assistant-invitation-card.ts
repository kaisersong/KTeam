import {normalizeA2uiMessages} from '../../runtime-core/src/a2ui/decoder.js';
import type {RenderUISection} from '../../runtime-core/src/a2ui/protocol.js';
import type {AssistantDailyCard} from '../protocol/assistant-daily-card.js';
import {invitationCalendarPending,invitationDateQuestion,invitationTimeRange,messageCalendarDate,type CalendarContext} from './assistant-calendar-context.js';
import {compileDailyCardSurface} from './assistant-daily-card-layout.js';

const weekdayFormat=new Intl.DateTimeFormat('zh-CN',{timeZone:'UTC',weekday:'long'});
const dateFormat=new Intl.DateTimeFormat('zh-CN',{timeZone:'UTC',month:'long',day:'numeric'});
export function invitationCardContent(input:{group:string;text:string;source?:string;calendar:CalendarContext}){
 const {group,text,source,calendar:{date,observation}}=input;
 const range=invitationTimeRange(text);
 const times=range?range.start+'–'+range.end:undefined;
 const title=text.match(/(?:^|[：:。！\s])([^：:。！？、，,\s]{2,48}会议)\s*(?:计划|拟定|拟于|定于|将于)/)?.[1]??group;
 const location=text.match(/(?:会议地点|开会地点)\s*[:：]?\s*([^。；]{2,100}?)(?=\s*[一二三四五六七八九十]+、|[。；]|$)/)?.[1]?.trim();
 const sections:RenderUISection[]=[
  {kind:'metric',label:'会议日期',value:date?dateFormat.format(new Date(date)):'日期待确认',...(date?{change:date.slice(0,4)+'年 · '+weekdayFormat.format(new Date(date))}:{})},
  {kind:'metric',label:'会议时间',value:times??'时间待确认',...(times?{change:'以邀请为准'}:{})},
  ...(location?[{kind:'text' as const,content:'会议地点 · '+location}]:[]),
  {kind:'text',content:observation===invitationCalendarPending?'日历尚未核对':observation},
  ...(source?[{kind:'text' as const,content:source+(group!==title?' · '+group:'')}]:[]),
 ];
 const draft=date?'请核对 '+[date,times].filter(Boolean).join(' ')+' 「'+title+'」是否与我的日程冲突，并告诉我核对结果。'
  :'请先向我确认「'+title+'」的会议日期（含年份），确认后再核对日历冲突。';
 return {title,sections,draft};
}

/** Upgrade the single-invitation layout using the old receipt's already published fields. */
export function upgradeInvitationCard(card:AssistantDailyCard,publishedAt:number):AssistantDailyCard|undefined{
 const id=card.artifactId.match(/^a2ui-(assistant-daily-message-[a-f0-9]{64})-proactive-brief$/)?.[1];
 if(card.kind||!id||!Number.isFinite(publishedAt))return;
 try{
  const layout=normalizeA2uiMessages(JSON.parse(card.content)).find(message=>'updateComponents' in message);
  if(!layout||!('updateComponents' in layout))return;
  const components=new Map(layout.updateComponents.components.map(component=>[component.id,component]));
  const children=components.get('root')?.children?.map(child=>components.get(child))??[];
  if(children.length!==4&&children.length!==6)return;
  const [header,heading,source,followUp,separator,coverage]=children;
  const group=heading?.variant==='h3'&&heading.text?.match(/^参会待确认 · (.+)$/)?.[1];
  const summary=source?.variant==='body'&&source.text?.match(/^([^·]{1,48} · \d{1,2}\/\d{1,2} \d{2}:\d{2}) · (.{1,180})$/u);
  if(header?.text!=='消息里需要关注的事项'||!group||!summary||followUp?.component!=='List'||
   (children.length===6&&(separator?.component!=='Divider'||coverage?.variant!=='body'||!coverage.text)))return;
  const text=summary[2]!;
  const date=/\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*[日号]/.test(text)?messageCalendarDate(text,publishedAt,'UTC','invitation'):undefined;
  const calendar={date,observation:date?followUp.items?.[0]??invitationCalendarPending:invitationDateQuestion};
  const invitation=invitationCardContent({group,text,source:summary[1]!,calendar});
  const sections:RenderUISection[]=[{kind:'heading',text:invitation.title,level:2},...invitation.sections];
  if(coverage?.text)sections.push({kind:'divider'},{kind:'text',content:coverage.text});
  return {...compileDailyCardSurface(id,invitation.title,sections),kind:'meeting-invitation',calendarCheckDraft:invitation.draft,...(!date?{confirmMeetingDate:true}:{})};
 }catch{
  return;
 }
}
