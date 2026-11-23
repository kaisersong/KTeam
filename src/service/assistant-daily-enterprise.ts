import {createHash} from 'node:crypto';
import {KTeamError} from '../errors.js';
import {dailySource,type DailyItem,type DailySource} from '../protocol/assistant-daily.js';
import {dailyEnterpriseLabels,dailyEnterpriseProviders,recentGroupsLimit,type DailyEnterpriseProvider} from '../protocol/assistant-daily-types.js';
import {nextRoutineAt} from '../protocol/routine-calendar.js';
import type {EnterpriseConnectors} from './enterprise-connectors.js';
import type {DailySourceScan} from './assistant-daily-sources.js';

type Row=Record<string,unknown>;
type Identity={account:string;revision:string;user:string};
type Event={id:string;title:string;start:number;end:number;busy:boolean};
type Group={id:string;lastAt:number};
const day=86400000;
const messageLimit=20;
const midnights={kind:'daily',time:'00:00',weekdays:[1,2,3,4,5,6,7]} as const;
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const row=(value:unknown):Row=>value&&typeof value==='object'&&!Array.isArray(value)?value as Row:{};
const string=(value:unknown)=>typeof value==='string'?value.trim().slice(0,256):'';
function list(value:unknown,...keys:string[]):Row[]{
 if(Array.isArray(value))return value.map(row);
 for(const key of keys){
  const items=row(value)[key];
  if(Array.isArray(items))return items.map(row);
 }
 throw new KTeamError('daily_source_response_unknown',502);
}
function unwrap(value:unknown,provider:DailyEnterpriseProvider){
 const entry=row(value);
 if(entry.success===false||entry.ok===false||entry.errcode!==undefined&&entry.errcode!==0||
  (provider==='feishu'&&entry.ok!==true))throw new KTeamError('daily_source_unavailable',503);
 return entry.data??entry.result??value;
}
function timestamp(value:unknown,offset=28800){
 if(typeof value==='number'&&Number.isFinite(value))return value<1e11?value*1000:value;
 if(typeof value!=='string')return NaN;
 if(/^\d{10}(?:\d{3})?$/.test(value))return timestamp(Number(value));
 if(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(?:\.\d{1,3})?$/.test(value))
  return Date.parse(value.replace(' ','T')+'Z')-offset*1000;
 return /(?:Z|[+-]\d{2}:?\d{2})$/.test(value)?Date.parse(value):NaN;
}
function wecomTime(at:number){
 return new Date(at+28800000).toISOString().slice(0,19).replace('T',' ');
}
function dateRange(now:number,timeZone:string){
 const everyDay={...midnights,weekdays:[...midnights.weekdays]};
 const startGuess=nextRoutineAt(everyDay,timeZone,now-2*day);
 let start=startGuess??now;
 let end=nextRoutineAt(everyDay,timeZone,start);
 while(end!==null&&end<=now){start=end;end=nextRoutineAt(everyDay,timeZone,start);}
 return {start:Math.min(start,now),end:end??now+day};
}
function event(entry:Row):Event|undefined {
 if(['cancelled','canceled','declined'].includes(string(entry.status).toLowerCase()))return;
 const startField=row(entry.start_time??entry.start);
 const endField=row(entry.end_time??entry.end);
 // All-day entries have no hour to remind the user about.
 if(startField.date&&!startField.datetime&&!startField.timestamp||entry.is_all_day===true||entry.isAllDay===true)return;
 const timezone=row(entry.timezone);
 const offset=typeof timezone.timezone_offset==='number'?timezone.timezone_offset:28800;
 const start=timestamp(entry.begin_time??entry.startDateTime??startField.datetime??startField.dateTime??startField.timestamp??entry.start,offset);
 const end=timestamp(entry.end_time&&typeof entry.end_time==='string'?entry.end_time:entry.endDateTime??endField.datetime??endField.dateTime??endField.timestamp??entry.end,offset);
 const id=string(entry.event_id??entry.eventId??entry.schedule_id??entry.sub_meeting_id??entry.meeting_id??entry.id);
 const title=string(entry.summary??entry.subject??entry.title);
 if(!id||!title||!Number.isFinite(start)||!Number.isFinite(end)||end<=start)
  throw new KTeamError('daily_source_response_unknown',502);
 return {id,title,start,end,busy:entry.transparency!=='transparent'&&entry.free_busy_status!=='free'};
}

export class AssistantDailyEnterprise {
 constructor(private readonly connector:Pick<EnterpriseConnectors,'dailyEnterpriseIdentity'|'dailyEnterpriseRead'>){}
 private async identity(provider:DailyEnterpriseProvider,signal?:AbortSignal):Promise<Identity|undefined>{
  const status=await this.connector.dailyEnterpriseIdentity(provider,signal);
  if(!status?.openId||!status.connectedAt)return;
  const account=hash([provider,status.orgId??null,status.identityType,status.openId]);
  return {account,revision:hash([account,status.connectedAt]),user:status.openId};
 }
 async catalog(signal?:AbortSignal){
  const accounts=await Promise.allSettled(dailyEnterpriseProviders.map(provider=>this.identity(provider,signal)));
  return accounts.flatMap((result,index)=>{
   if(result.status!=='fulfilled'||!result.value)return [];
   const provider=dailyEnterpriseProviders[index]!;
   const {account,revision}=result.value;
   return [
    dailySource.parse({kind:'enterprise-message',id:'recent-groups-30',label:dailyEnterpriseLabels[provider]+' · 最近 30 个群 · 每 15 分钟',account,revision,provider}),
    dailySource.parse({kind:'enterprise-calendar',id:'calendar',label:dailyEnterpriseLabels[provider]+' · 日程和会议',account,revision,provider}),
   ];
  });
 }
 async current(source:DailySource,signal?:AbortSignal){
  const identity=source.provider&&await this.identity(source.provider,signal);
  return !!identity&&identity.account===source.account&&identity.revision===source.revision;
 }
 private async read(provider:DailyEnterpriseProvider,args:readonly string[],signal:AbortSignal){
  return unwrap(await this.connector.dailyEnterpriseRead(provider,args,signal),provider);
 }
 private async groups(provider:DailyEnterpriseProvider,now:number,signal:AbortSignal):Promise<Group[]>{
  let response:unknown,entries:Row[];
  if(provider==='feishu'){
   response=await this.read(provider,['im','+chat-list','--as','user','--sort','active_time','--page-size',String(recentGroupsLimit),'--format','json'],signal);
   entries=list(response,'chats');
  }else if(provider==='dingtalk'){
   response=await this.read(provider,['chat','+chat-list','--types','group','--limit','100','--format','json'],signal);
   entries=list(response,'chats','conversations');
  }else{
   response=await this.read(provider,['chat','groups','list','--json',JSON.stringify({
    begin_time:wecomTime(now-day),end_time:wecomTime(now),
   })],signal);
   entries=list(response,'groups','group_list','chat_list');
  }
  const groups=new Map<string,Group>();
  for(const entry of entries){
   const id=string(entry.chat_id??entry.openConversationId??entry.group_id);
   if(!/^[A-Za-z0-9_+/=:@.-]{1,256}$/.test(id)||id.startsWith('-')||entry.chat_mode==='p2p'||entry.conversationType==='direct'||entry.chat_status==='dissolved'||entry.chat_status==='dissolved_save')continue;
   groups.set(id,{id,lastAt:timestamp(entry.lastMsgCreateAt??entry.last_msg_time)});
  }
  const lastActivity=(group:Group)=>Number.isFinite(group.lastAt)?group.lastAt:0;
  return [...groups.values()].sort((a,b)=>lastActivity(b)-lastActivity(a)).slice(0,recentGroupsLimit);
 }
 private async messages(provider:DailyEnterpriseProvider,groupId:string,from:number,now:number,signal:AbortSignal){
  const start=new Date(from).toISOString(),end=new Date(now).toISOString();
  if(provider==='feishu')return list(await this.read(provider,['im','+chat-messages-list','--as','user','--chat-id',groupId,
   '--start',start,'--end',end,'--order','desc','--page-size',String(messageLimit),'--no-reactions','--format','json'],signal),'messages');
  if(provider==='dingtalk')return list(await this.read(provider,['chat','+chat-messages','--group',groupId,
   '--start',start,'--end',end,'--order','desc','--limit',String(messageLimit),'--no-reactions','--format','json'],signal),'messages');
  return list(await this.read(provider,['chat','messages','list','--json',JSON.stringify({
   chat_id:groupId,begin_time:wecomTime(from),end_time:wecomTime(now),limit:messageLimit,
  })],signal),'messages','message_list');
 }
 private async recentGroups(source:DailySource,provider:DailyEnterpriseProvider,user:string,from:number,now:number,signal:AbortSignal):Promise<DailySourceScan>{
  const targets=await this.groups(provider,now,signal);
  const cut=Math.max(from,now-day);
  const items:DailyItem[]=[];
  let checked=0;
  const due=targets.filter(group=>!Number.isFinite(group.lastAt)||group.lastAt>=cut);
  for(let index=0;index<due.length;index+=4){
   signal.throwIfAborted();
   const results=await Promise.allSettled(due.slice(index,index+4).map(async group=>{
    const entries=await this.messages(provider,group.id,cut,now,signal);
    const messages=entries.slice(0,messageLimit).flatMap(entry=>{
     const id=string(entry.message_id??entry.messageId??entry.msg_id);
     const stamp=timestamp(entry.create_time??entry.createTime??entry.send_time??entry.msg_time);
     const sender=string(row(entry.sender).id??entry.senderId??entry.sender_id??entry.from_userid);
     if(!id||!Number.isFinite(stamp)||stamp<cut||stamp>now||!sender||sender===user||entry.is_self===true)return [];
     const mentions=Array.isArray(entry.mentions)?entry.mentions:[];
     const urgent=mentions.some(mention=>string(row(row(mention).id).open_id??row(mention).id)===user);
     return [{id,stamp,urgent}];
    }).sort((a,b)=>b.stamp-a.stamp);
    const latest=messages[0];
    if(!latest)return;
    return {
     id:hash([source.account,group.id,latest.id]),source,title:'一个近期群有消息待查看',
     detail:'本次可见 '+messages.length+' 条群消息。',observedAt:latest.stamp,urgent:messages.some(message=>message.urgent),
    };
   }));
   signal.throwIfAborted();
   for(const result of results)if(result.status==='fulfilled'){
    checked++;
    if(result.value)items.push(result.value);
   }
   if(!checked)break;
  }
  if(due.length&&!checked)throw new KTeamError('daily_source_unavailable',503);
  // Bounded history always represents a subset of the provider's available data.
  return {items,partial:true};
 }
 private async calendar(source:DailySource,provider:DailyEnterpriseProvider,now:number,timeZone:string,signal:AbortSignal):Promise<DailySourceScan>{
  const {start,end}=dateRange(now,timeZone);
  const args=['--start',new Date(start).toISOString(),'--end',new Date(end-1).toISOString(),'--format','json'];
  let entries:Row[],partial=false;
  if(provider==='feishu'){
   entries=list(await this.read(provider,['calendar','+agenda','--as','user',...args],signal),'items');
  }else if(provider==='dingtalk'){
   const data=await this.read(provider,['calendar','event','list',...args],signal);
   entries=list(data,'events','items','eventList');
   partial=!!(row(data).hasMore||row(data).nextCursor);
  }else{
   const range={begin_time:wecomTime(start),end_time:wecomTime(end-1000)};
   const [schedule,meeting]=await Promise.allSettled([
    this.read(provider,['calendar','schedules','list','--json',JSON.stringify(range)],signal).then(data=>list(data,'schedule_list')),
    this.read(provider,['meeting','list','--json',JSON.stringify({...range,limit:30})],signal).then(data=>({rows:[...list(data,'created_meetings'),...list(data,'attended_meetings')],partial:row(data).has_more===true})),
   ]);
   signal.throwIfAborted();
   if(schedule.status==='rejected'&&meeting.status==='rejected')throw new KTeamError('daily_source_unavailable',503);
   entries=[...(schedule.status==='fulfilled'?schedule.value:[]),...(meeting.status==='fulfilled'?meeting.value.rows:[])];
   partial=schedule.status==='rejected'||meeting.status==='rejected'||meeting.value.partial;
  }
  const appointments=new Map<string,Event>();
  for(const entry of entries)try{
   const appointment=event(entry);
   if(appointment&&appointment.end>=now&&appointment.start<end)
    appointments.set(JSON.stringify([appointment.title,appointment.start,appointment.end]),appointment);
  }catch{partial=true;}
  const events=[...appointments.values()].sort((a,b)=>a.start-b.start);
  const formatter=new Intl.DateTimeFormat('zh-CN',{timeZone,month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
  return {partial,items:events.map(appointment=>{
   const conflicts=appointment.busy?events.filter(other=>other!==appointment&&other.busy&&other.start<appointment.end&&appointment.start<other.end):[];
   return {
    id:hash([source.account,appointment.id,appointment.start]),source,title:appointment.title,observedAt:now,deadline:appointment.start,
    detail:formatter.formatRange(appointment.start,appointment.end)+(conflicts.length?' · 冲突 '+conflicts.map(other=>other.title).join('、'):''),
    urgent:conflicts.length>0&&appointment.start<=now+2*3600000,
   };
  })};
 }
 async scan(source:DailySource,from:number,now:number,timeZone:string,signal:AbortSignal){
  const provider=source.provider;
  const identity=provider&&await this.identity(provider,signal);
  if(!provider||!identity||identity.account!==source.account||identity.revision!==source.revision)
   throw new KTeamError('daily_source_changed',409);
  return source.kind==='enterprise-message'?this.recentGroups(source,provider,identity.user,from,now,signal):this.calendar(source,provider,now,timeZone,signal);
 }
}
