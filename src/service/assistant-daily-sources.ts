import {createHash} from 'node:crypto';
import {KTeamError} from '../errors.js';
import {sharedRuntime} from '../runtime/native.js';
import {calendarWindow} from '../runtime/calendar.js';
import {dailySource, type DailyItem, type DailySource} from '../protocol/assistant-daily.js';
import {readIntegrations, runtimeIntegrationRevision} from './integration-settings.js';
import type {EnterpriseConnectors} from './enterprise-connectors.js';
import type {MailConnectors} from './mail-connectors.js';

const digest = (value:unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function object(value:unknown):Record<string,unknown> {
 return value && typeof value==='object' && !Array.isArray(value) ? value as Record<string,unknown> : {};
}
function field(row:Record<string,unknown>, ...names:string[]) {
 for(const name of names) {
  const value=row[name];
  if(typeof value==='string' && value.trim())return value.trim().slice(0,256);
 }
 return '';
}
function rows(value:unknown,...keys:string[]) {
 if(Array.isArray(value))return value.map(object);
 const record=object(value);
 for(const key of keys) {
  const list=record[key];
  if(Array.isArray(list))return list.map(object);
 }
 throw new KTeamError('daily_source_response_unknown',502);
}
function when(value:unknown) {
 if(typeof value==='number'&&Number.isFinite(value))return value<1e11?value*1000:value;
 if(typeof value==='string'&&/^(?:\d{10}|\d{13})$/.test(value))return when(Number(value));
 if(typeof value==='string'&&/(?:Z|[+-]\d{2}:?\d{2})$/.test(value))return Date.parse(value);
 return NaN;
}
function urlFor(value:string,domains?:string[]) {
 try {
  const u=new URL(value);
  if(u.protocol==='https:'&&!u.username&&!u.password&&(!domains||domains.some(name=>u.hostname===name||u.hostname.endsWith('.'+name))))return u.href;
 }catch{/* No verified source URL. */}
}
const yzjDomains=['yunzhijia.com','yunzhijia.cn','kdweibo.com','kdweibo.cn'];

export class AssistantDailySources {
 constructor(private mail:MailConnectors,private enterprise:EnterpriseConnectors){}
 private async yzjIdentity(signal?:AbortSignal) {
  const account=object(await this.enterprise.dailyYzj(['whoami'],signal));
  const org=field(account,'orgId'),user=field(account,'openId');
  if(!org||!user||account.tokenStatus==='expired')throw new KTeamError('daily_source_unavailable',503);
  const projected=(await this.enterprise.view()).connectors.find(row=>row.provider==='yzj');
  const connection=projected?.connection;
  if(connection?.openId && (connection.openId!==user||connection.orgId!==org))throw new KTeamError('daily_source_changed',409);
  return {account:digest([org,user]),revision:digest([org,user,connection?.connectedAt??null]),user};
 }
 async catalog(includeYzj=false, signal?:AbortSignal):Promise<{sources:DailySource[];yzjAvailable:boolean}> {
  const mail=await this.mail.dailyAccounts();
  const sources=mail.map(account=>dailySource.parse({kind:'mail',id:account.id,label:account.email,account:account.id,revision:String(account.revision)}));
  if(!includeYzj)return {sources,yzjAvailable:false};
  try {
   const {account,revision}=await this.yzjIdentity(signal);
   sources.push({kind:'yzj-calendar',id:'calendar',label:'云之家日程',account,revision});
   const result=await Promise.allSettled([
    this.enterprise.dailyYzj(['im','group','recent','--limit','20','--page','1'],signal),
    this.enterprise.dailyYzj(['doc','workspace','list'],signal),
   ]);
   for (const [index, response] of result.entries()) {
    if(response.status!=='fulfilled')continue;
    try {
     for(const entry of rows(response.value,'list','groups','workspaces','items').slice(0,20)) {
      const id=field(entry,index===0?'groupId':'id','id','workspaceId');
      const label=field(entry,'name','groupName','title');
      if(id&&label){
       const parsed=dailySource.safeParse({kind:index===0?'yzj-message':'yzj-doc',id,label,account,revision});
       if(parsed.success)sources.push(parsed.data);
      }
     }
    }catch{/* Unsupported discovery is never reported as a scanned source. */}
   }
   return {sources,yzjAvailable:true};
  }catch{return {sources,yzjAvailable:false};}
 }
 async current(source:DailySource,signal?:AbortSignal):Promise<boolean> {
  if(source.kind==='mail')return (await this.mail.dailyAccounts()).some(account=>account.id===source.id&&source.revision===String(account.revision));
  if(source.kind==='news')return source.revision===await runtimeIntegrationRevision();
  const identity=await this.yzjIdentity(signal);
  return identity.account===source.account&&identity.revision===source.revision;
 }
 async newsSource(topic:string):Promise<DailySource> {
  return dailySource.parse({kind:'news',id:topic,label:topic,account:'public',revision:await runtimeIntegrationRevision()});
 }
 async scan(source:DailySource,from:number,now:number,timeZone:string,signal:AbortSignal):Promise<{items:DailyItem[];partial:boolean}> {
  const item=(id:string,title:string,detail:string,observedAt:number,more:Partial<DailyItem>={}):DailyItem=>({
   id:digest([source.kind,source.account,source.id,id]),source,title,detail,observedAt,urgent:false,...more,
  });
  if(source.kind==='mail') {
   const first=await this.mail.dailySearch(source.id,new Date(from).toISOString());
   signal.throwIfAborted();
   const second=first.hasMore&&first.cursor?await this.mail.dailySearch(source.id,new Date(from).toISOString(),first.cursor):undefined;
   const messages=[...first.messages,...second?.messages??[]];
   return {items:messages.filter(row=>row.unread).map(row=>item(row.id,row.subject||'无主题',row.from,Date.parse(row.receivedAt)||now,{originalId:row.id})),partial:first.coverage==='partial'||(second?.hasMore??first.hasMore)||second?.coverage==='partial'};
  }
  if(source.kind==='news') {
   const core=await sharedRuntime();
   const integrations=await readIntegrations();
   const result=await new core.ConnectorRegistry(integrations.web).runSearch({query:source.id,count:8,signal});
   return {items:result.hits.flatMap((hit:{title:string;url:string;snippet:string})=>{
    const url=urlFor(hit.url);
    return url?[item(url,hit.title.slice(0,256),hit.snippet.slice(0,500),now,{url})]:[];
   }),partial:true};
  }
  if(source.kind==='yzj-doc') {
   const value=await this.enterprise.dailyYzj(['doc','list','--workspace',source.id],signal);
   return {items:rows(value,'list','items','docs').flatMap(entry=>{
    const id=field(entry,'id','docId'), stamp=when(entry.updateTime??entry.modifiedTime),title=field(entry,'title','fileName','name');
    const url=urlFor(field(entry,'webUrl','url'),yzjDomains);
    return id&&title&&Number.isFinite(stamp)&&stamp>=from?[item(id,title,'知识库文档已更新',stamp,{originalId:id,url})]:[];
   }),partial:true};
  }
  if(source.kind==='yzj-message') {
   const identity=await this.yzjIdentity(signal);
   if(identity.account!==source.account||identity.revision!==source.revision)throw new KTeamError('daily_source_changed',409);
   const value=await this.enterprise.dailyYzj(['im','message','list','--group-id',source.id,'--type','newest','--limit','30'],signal);
   return {items:rows(value,'list','messages','items').flatMap(entry=>{
    const id=field(entry,'msgId','messageId','id'),sender=field(entry,'senderOpenId','fromOpenId','openId');
    const stamp=when(entry.sendTime??entry.createTime??entry.timestamp);
    const mentions=entry.atOpenIds??entry.mentionOpenIds;
    const direct=entry.groupType==='private'||entry.chatType==='private';
    const addressed=Array.isArray(mentions)&&mentions.includes(identity.user);
    if(!id||!sender||sender===identity.user||!Number.isFinite(stamp)||stamp<from||!direct&&!addressed)return [];
    const title=addressed?'有人在云之家 @了你':'收到云之家私聊消息';
    return [item(id,title,field(entry,'content','text')||'请在原会话核对内容',stamp,{originalId:id,url:urlFor(field(entry,'webUrl','url'),yzjDomains)})];
   }),partial:true};
  }
  const today=calendarWindow(new Date(now),timeZone).today;
  const tomorrow=new Date(Date.parse(today+'T00:00:00Z')+86400000).toISOString().slice(0,10);
  const value=await this.enterprise.dailyYzj(['calendar','event','list','--start',today,'--end',tomorrow],signal);
  const entries=rows(value,'list','events','items');
  const meetings=entries.flatMap(entry=>{
   const start=when(entry.startTime??entry.start),end=when(entry.endTime??entry.end);
   const id=field(entry,'id','eventId'),title=field(entry,'title','summary');
   if(!id||!title||!Number.isFinite(start)||!Number.isFinite(end)||end<=start||end<now||entry.cancelled===true||['cancelled','canceled','declined'].includes(field(entry,'status','responseStatus')))return [];
   return [{entry,start,end,id,title}];
  }).sort((a,b)=>a.start-b.start);
  return {items:meetings.map(meeting=>{
   const busy=(e:Record<string,unknown>)=>e.allDay!==true&&e.isAllDay!==true&&e.transparency!=='transparent';
   const conflicts=busy(meeting.entry)?meetings.filter(other=>other.id!==meeting.id&&busy(other.entry)&&other.start<meeting.end&&meeting.start<other.end):[];
   const formatter=new Intl.DateTimeFormat('zh-CN',{timeZone,month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
   const range=formatter.formatRange(meeting.start,meeting.end);
   return item(meeting.id,meeting.title,conflicts.length?range+' · 冲突 '+conflicts.map(other=>other.title).join('、'):range,now,{
    urgent:conflicts.length>0&&meeting.start<=now+2*3600000,
    deadline:meeting.start, originalId:meeting.id, url:urlFor(field(meeting.entry,'webUrl','url'),yzjDomains),
   });
  }),partial:meetings.length!==entries.length};
 }
 async original(item:DailyItem) {
  if(item.source.kind==='mail'&&item.originalId)return {mail:await this.mail.dailyRead(item.source.id,item.originalId)};
  return {url:item.url};
 }
}
