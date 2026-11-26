import {createHash} from 'node:crypto';
import {KTeamError} from '../errors.js';
import {sharedRuntime} from '../runtime/native.js';
import {calendarWindow} from '../runtime/calendar.js';
import {dailySource, type DailyItem, type DailySource} from '../protocol/assistant-daily.js';
import {readIntegrations, runtimeIntegrationRevision} from './integration-settings.js';
import {isYzjRecentGroups,isDailyDirectChats,recentDirectChatsId,yzjRecentGroupsId,recentGroupsLimit} from '../protocol/assistant-daily-types.js';
import type {EnterpriseConnectors} from './enterprise-connectors.js';
import type {MailConnectors} from './mail-connectors.js';
import {messageAttention} from './assistant-message-attention.js';
import {AssistantDailyEnterprise} from './assistant-daily-enterprise.js';

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

type RecentCursor={lastId:string;itemId?:string;triageVersion?:3};
export type RecentGroupCursors=Record<string,RecentCursor>;
type RecentSnapshot={items:DailyItem[];cursors:RecentGroupCursors};
export type DailySourceScan={items:DailyItem[];partial:boolean;recentCursors?:RecentGroupCursors};
const messageRows=(value:unknown)=>rows(value,'list','messages','items').map(row=>row.message&&typeof row.message==='object'?object(row.message):row);
const recentGroupFields='{success:.success,data:{more:.data.more,list:[.data.list[]|{groupId,groupType,groupName,name,lastMsgId,lastMsgSendTime}]}}';
const recentMessageFields='{success:.success,data:{list:[(.data.list//.data.messages//.data.items//.data)[]|(.message//.)|{msgId,messageId,id,replyMsgId,fromOpenId,senderOpenId,openId,sendTime,createTime,timestamp,atOpenIds,mentionOpenIds,notifyToOpenIds,content:((.content//.text) | if type=="string" then .[:300] elif type=="object" then (.content//.text) | if type=="string" then .[:300] else null end else null end)}]}}';

const mentionsUser=(entry:Record<string,unknown>,user:string)=>[entry.atOpenIds,entry.mentionOpenIds,entry.notifyToOpenIds]
 .some(value=>Array.isArray(value)&&value.includes(user));
const mentionsSomeone=(entry:Record<string,unknown>)=>[entry.atOpenIds,entry.mentionOpenIds,entry.notifyToOpenIds]
 .some(value=>Array.isArray(value)&&value.length>0);
const messageAuthor=(entry:Record<string,unknown>)=>field(entry,'senderOpenId','fromOpenId','openId');
function yzjMessageTime(value:unknown){
 // The CLI serializes local IM timestamps without an offset. The same response
 // pairs forwarded local times with epoch timestamps at UTC+08:00.
 if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{3})?$/.test(value))
  return Date.parse(value.replace(' ','T')+'+08:00');
 return when(value);
}
const messageTime=(entry:Record<string,unknown>)=>yzjMessageTime(entry.sendTime??entry.createTime??entry.timestamp);

export class AssistantDailySources {
 private readonly otherEnterprise:AssistantDailyEnterprise;
 constructor(private mail:MailConnectors,private enterprise:EnterpriseConnectors){this.otherEnterprise=new AssistantDailyEnterprise(enterprise);}
 private async yzjIdentity(signal?:AbortSignal) {
  const account=object(await this.enterprise.dailyYzj(['whoami'],signal));
  const org=field(account,'orgId'),user=field(account,'openId');
  if(account.tokenStatus==='expired')throw new KTeamError('yzj_login_required',403);
  if(!org||!user)throw new KTeamError('daily_source_unavailable',503);
  const connectedAt=this.enterprise.dailyYzjConnectedAt(org,user);
  return {account:digest([org,user]),revision:digest([org,user,connectedAt??null]),legacyRevision:digest([org,user,null]),connectedAt,user};
 }
 async checkYzjSources(sources:DailySource[],authorizedAt:number,signal:AbortSignal) {
  let identity:Awaited<ReturnType<AssistantDailySources['yzjIdentity']>>;
  try{identity=await this.yzjIdentity(signal);}
  catch(error){return {sources,login:error instanceof KTeamError&&error.code==='yzj_login_required'?'required' as const:'unknown' as const};}
  // Older plans could record the null timestamp before the UI checked the CLI.
  // Repair only an exact legacy fingerprint for an account connected before consent.
  const canRestore=identity.connectedAt&&Date.parse(identity.connectedAt)<=authorizedAt;
  const restored=sources.map(source=>canRestore&&source.kind.startsWith('yzj-')&&source.account===identity.account&&source.revision===identity.legacyRevision
   ? {...source,revision:identity.revision}:source);
  const authorized=restored.filter(source=>source.kind.startsWith('yzj-')).every(source=>
   source.account===identity.account&&source.revision===identity.revision);
  return {sources:restored,login:authorized?'valid' as const:'unknown' as const};
 }
 async connectorSetup(){
  const [enterprise,mail]=await Promise.allSettled([this.enterprise.hasSavedConnection(),this.mail.dailyAccounts()]);
  return {enterprise:enterprise.status==='fulfilled'&&enterprise.value!==undefined?!enterprise.value:undefined,
   mail:mail.status==='fulfilled'?mail.value.length===0:undefined};
 }
 async catalog(includeEnterprise=false, signal?:AbortSignal):Promise<{sources:DailySource[];yzjAvailable:boolean}> {
  const mail=await this.mail.dailyAccounts();
  const sources=mail.map(account=>dailySource.parse({kind:'mail',id:account.id,label:account.email,account:account.id,revision:String(account.revision)}));
  if(!includeEnterprise)return {sources,yzjAvailable:false};
  const additional=this.otherEnterprise.catalog(signal);
  const yzjAvailable=await this.addYzjSources(sources,signal);
  return {sources:[...sources,...await additional],yzjAvailable};
 }
 private async addYzjSources(sources:DailySource[],signal?:AbortSignal){
  try {
   const {account,revision}=await this.yzjIdentity(signal);
   sources.push({kind:'yzj-message',id:yzjRecentGroupsId,label:'最近 30 个群 · 每 15 分钟',account,revision});
   sources.push({kind:'yzj-message',id:recentDirectChatsId,label:'最近 30 个单聊 · 每 15 分钟',account,revision});
   sources.push({kind:'yzj-calendar',id:'calendar',label:'云之家日程和会议',account,revision});
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
   return true;
  }catch{return false;}
 }
 async current(source:DailySource,signal?:AbortSignal):Promise<boolean> {
  if(source.kind==='mail')return (await this.mail.dailyAccounts()).some(account=>account.id===source.id&&source.revision===String(account.revision));
  if(source.kind==='news')return source.revision===await runtimeIntegrationRevision();
  if(source.provider)return this.otherEnterprise.current(source,signal);
  const identity=await this.yzjIdentity(signal);
  return identity.account===source.account&&identity.revision===source.revision;
 }
 async newsSource(topic:string):Promise<DailySource> {
  return dailySource.parse({kind:'news',id:topic,label:topic,account:'public',revision:await runtimeIntegrationRevision()});
 }
 async scan(source:DailySource,from:number,now:number,timeZone:string,signal:AbortSignal,recent?:RecentSnapshot,calendarDate?:string):Promise<DailySourceScan> {
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
  if(source.provider)return this.otherEnterprise.scan(source,from,now,timeZone,signal,calendarDate);
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
   if(isYzjRecentGroups(source)||isDailyDirectChats(source))return this.recentChats(source,identity.user,from,now,signal,recent);
   const value=await this.messagePage(source.id,signal);
   const core=await sharedRuntime();
   const conversation=object(object(value).group);
   const directConversation=conversation.groupType===1||source.id.startsWith(identity.user+'-')||source.id.endsWith('-'+identity.user);
   return {items:messageRows(value).flatMap(entry=>{
    const id=field(entry,'msgId','messageId','id'),sender=messageAuthor(entry);
    const stamp=messageTime(entry);
    const direct=directConversation||entry.groupType===1||entry.groupType==='private'||entry.chatType==='private';
    const addressed=mentionsUser(entry,identity.user);
    if(!id||!sender||sender===identity.user||!Number.isFinite(stamp)||stamp<from||!direct&&!addressed)return [];
    const title=addressed?'有人在云之家 @了你':'收到云之家私聊消息';
    return [item(id,title,field(entry,'content','text')||'请在原会话核对内容',stamp,{originalId:id,url:urlFor(field(entry,'webUrl','url'),yzjDomains),
     messageAttention:messageAttention({content:entry.content??entry.text,group:source.label,stamp,addressed,direct},text=>core.redactSecrets(text).text)})];
   }),partial:true};
  }
  const today=calendarDate??calendarWindow(new Date(now),timeZone).today;
  const value=await this.enterprise.dailyYzj(['calendar','event','list','--start',today,'--end',today],signal);
  const entries=rows(value,'list','events','items');
  const meetings=entries.flatMap(entry=>{
   const start=when(entry.startTime??entry.startDate??entry.start),end=when(entry.endTime??entry.endDate??entry.end);
   const id=field(entry,'id','eventId'),title=field(entry,'title','summary');
   if(entry.cancelled===true||when(entry.cancelDate)>0||
    ['cancelled','canceled','declined'].some(status=>status===field(entry,'status')||status===field(entry,'responseStatus')))return [];
   if(!id||!title||!Number.isFinite(start)||!Number.isFinite(end)||end<=start)return [];
   if(end<now)return [];
   return [{entry,start,end,id,title}];
  }).sort((a,b)=>a.start-b.start);
  // A complete response from this CLI command only covers its visible event feed.
  return {items:meetings.map(meeting=>{
   const busy=(e:Record<string,unknown>)=>e.allDay!==true&&e.isAllDay!==true&&e.transparency!=='transparent';
   const conflicts=busy(meeting.entry)?meetings.filter(other=>other.id!==meeting.id&&busy(other.entry)&&other.start<meeting.end&&meeting.start<other.end):[];
   const formatter=new Intl.DateTimeFormat('zh-CN',{timeZone,month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
   const range=formatter.formatRange(meeting.start,meeting.end);
   return item(meeting.id,meeting.title,conflicts.length?range+' · 冲突 '+conflicts.map(other=>other.title).join('、'):range,now,{
    urgent:conflicts.length>0&&meeting.start<=now+2*3600000,
    deadline:meeting.start,calendarEnd:meeting.end,calendarBusy:busy(meeting.entry), originalId:meeting.id, url:urlFor(field(meeting.entry,'webUrl','url'),yzjDomains),
   });
  }),partial:true};
 }
 private messagePage(groupId:string,signal:AbortSignal,bounded=false){
  return this.enterprise.dailyYzj(['im','message','list','--group-id',groupId,'--type','newest','--limit','20',...(bounded?['--jq',recentMessageFields]:[])],signal);
 }
 private async recentChats(source:DailySource,user:string,from:number,now:number,signal:AbortSignal,previous?:RecentSnapshot):Promise<DailySourceScan>{
  const core=await sharedRuntime();
  const direct=isDailyDirectChats(source);
  const groups=new Map<string,{lastId:string;lastAt:number;name:string}>();
  for(let page=1;page<=5&&groups.size<recentGroupsLimit;page++){
   signal.throwIfAborted();
   const response=object(await this.enterprise.dailyYzj(['im','group','recent','--limit','20','--page',String(page),'--jq',recentGroupFields],signal));
   for(const group of rows(response,'list')){
    const id=field(group,'groupId');
    if(group.groupType!==(direct?1:2)||!id||id===user+'-'+user||groups.has(id))continue;
    const last=object(group.lastMsg);
    groups.set(id,{name:field(group,'groupName','name'),lastId:field(group,'lastMsgId')||field(last,'msgId'),lastAt:yzjMessageTime(group.lastMsgSendTime??last.sendTime)});
    if(groups.size===recentGroupsLimit)break;
   }
   if(response.more!==true)break;
  }
  const cut=Math.max(from,now-86400000);
  const cursors:RecentGroupCursors={};
  const items:DailyItem[]=[];
  const known=new Map(previous?.items.map(item=>[item.id,item]));
  const targets=[...groups];
  let checkedCount=0;
  for(let index=0;index<targets.length;index+=4){
   signal.throwIfAborted();
   const checked=await Promise.allSettled(targets.slice(index,index+4).map(async([groupId,{lastId,lastAt,name}])=>{
    const key=digest([source.account,groupId]);
    const cursor=previous?.cursors[key];
    const prior=cursor?.itemId?known.get(cursor.itemId):undefined;
    if(Number.isFinite(lastAt)&&lastAt<cut)return {key,lastId};
    if(lastId&&cursor?.lastId===lastId&&cursor.triageVersion===3)return {key,lastId,item:prior&&prior.observedAt>=cut?prior:undefined};
    const page=messageRows(await this.messagePage(groupId,signal,true));
    const replied=new Set(page.filter(message=>messageAuthor(message)===user&&messageTime(message)<=now)
     .map(message=>field(message,'replyMsgId')).filter(Boolean));
    const messages=page.filter(message=>{
     const author=messageAuthor(message),stamp=messageTime(message);
     return Boolean(author&&author!==user&&stamp>=cut&&stamp<=now);
    });
    const latest=messages.sort((a,b)=>messageTime(b)-messageTime(a))[0];
    const latestId=latest&&field(latest,'msgId','messageId','id');
    const actionable=messages.flatMap(message=>{
     const attention=messageAttention({
      content:message.content??message.text,group:name||(direct?'云之家单聊':'云之家群聊'),
      stamp:messageTime(message),addressed:mentionsUser(message,user),mentionPresent:mentionsSomeone(message),direct,
     },text=>core.redactSecrets(text).text);
     const id=field(message,'msgId','messageId','id');
     return attention&&id&&!replied.has(id)?[{attention,id}]:[];
    })[0];
    const item:DailyItem|undefined=latestId&&(!direct||actionable)?{
     id:digest([key,direct?actionable!.id:latestId]),source,title:actionable?.attention.group??'一个近期群有消息待查看',
     detail:actionable?.attention.text??'本次可见 '+messages.length+' 条其他成员的消息。',
     observedAt:direct?actionable!.attention.at:messageTime(latest),messageAttention:actionable?.attention,
     urgent:direct||messages.some(message=>mentionsUser(message,user)),
     ...(direct?{originalId:actionable!.id}:{}),
    }:undefined;
    return {key,lastId,item};
   }));
   signal.throwIfAborted();
   for(const result of checked)if(result.status==='fulfilled'){
    checkedCount++;
    const {key,lastId,item}=result.value;
    if(lastId)cursors[key]={lastId,itemId:item?.id,triageVersion:3};
    if(item)items.push(item);
   }
  }
  if(targets.length&&!checkedCount)throw new KTeamError('daily_source_unavailable',503);
  return {items,partial:true,recentCursors:cursors};
 }
 async original(item:DailyItem) {
  if(item.source.kind==='mail'&&item.originalId)return {mail:await this.mail.dailyRead(item.source.id,item.originalId)};
  return {url:item.url};
 }
}
