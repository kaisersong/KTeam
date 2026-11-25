import {createHash} from 'node:crypto';
import type {Upstreams} from '../adapters/upstream.js';
import {KTeamError} from '../errors.js';
import {dailySlotLabels,dailyEnterpriseLabels,isDailyCalendar,isDailyDirectChats,isDailyMessage,type DailyMessageAttention,type DailyItem,type DailyCoverage,type DailySlot} from '../protocol/assistant-daily-types.js';
import type {AssistantDailyCard} from '../protocol/assistant-daily-card.js';
import {compileRenderUiToA2ui} from '../../runtime-core/src/a2ui/compiler.js';
import type {RenderUISection} from '../../runtime-core/src/a2ui/protocol.js';
import {agentAddress,LOCAL_HUMAN} from './collaboration.js';
import type {TeamCoordinator} from './coordination.js';
import type {CalendarContext} from './assistant-calendar-context.js';
import {transcriptExcerpt} from './assistant-message-attention.js';
import {findOwnerMessage} from './room-reads.js';
import type {TeamStore} from './team-store.js';
import {rememberAssistantDailyCard} from './assistant-daily-card-receipts.js';

const hash=(text:string)=>createHash('sha256').update(text).digest('hex');

const attentionLabels:Record<DailyMessageAttention['kind'],{label:string;priority:number}>={
 schedule:{label:'日程变更',priority:0},
 invitation:{label:'参会待确认',priority:1},
 deadline:{label:'截止或到期',priority:1},
 decision:{label:'需要确认',priority:2},
 reply:{label:'待回复',priority:3},
};
const plain=(text:string)=>text.replace(/[<&>]/g,value=>({'<':'＜','>':'＞','&':'＆'})[value]!).replace(/[\x5c`*_{}\[\]()#!|~]/g,value=>'\\'+value);
function sortMessageAttention(a:DailyItem,b:DailyItem){
 return Number(isDailyDirectChats(b.source))-Number(isDailyDirectChats(a.source))||
  attentionLabels[a.messageAttention!.kind].priority-attentionLabels[b.messageAttention!.kind].priority||
  b.messageAttention!.at-a.messageAttention!.at;
}
function describeAttention(item:DailyItem,time:Intl.DateTimeFormat,evidence?:string|CalendarContext,escape=plain){
 const attention=item.messageAttention!;
 const provider=item.source.provider?dailyEnterpriseLabels[item.source.provider]:'云之家';
 const source=provider+(isDailyDirectChats(item.source)?'单聊':'')+' · '+time.format(attention.at);
 const context=attentionLabels[attention.kind].label+' · '+escape(attention.group);
 const ask=attention.text.match(/(?:请(?:你|您)?|麻烦(?:你|您)?|等你)([^。！？\n]{2,100})/)?.[1]?.trim();
 const ack=/请(?:你|您|大家)?(?:在群里)?回复[「“”'"]?收到|请确认收到/.test(attention.text);
 const meeting=typeof evidence==='object'?evidence:undefined;
 const followUp=attention.kind==='schedule'
  ? [typeof evidence==='string'?evidence:'请核对原会话通知中的新安排。']
  : attention.kind==='invitation'
   ? [meeting?.observation??'日历暂未核实，参会待确认。', '可选回复  '+(meeting?.choices??['收到议程','我核对安排后再确认']).join(' / ')]
  : attention.kind==='decision'||attention.kind==='reply'
   ? [...(ask?['对方请你'+ask.replace(/[，、；：;]+$/,'')+'。']:[]),
     ack?'回复草稿「收到，谢谢通知。」':attention.kind==='decision'
      ?'可选回复  我核对后再确认 / 请先把相关材料发我'
      :'可引用这条提醒，补上你的回复口径。']
   : [];
 return {context,source,text:escape(attention.text),followUp:followUp.map(escape)};
}
const dateAndTime=(timeZone:string)=>new Intl.DateTimeFormat('zh-CN',{timeZone,month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const itemLabels={mail:'待阅邮件','yzj-doc':'知识库更新',news:'公开资讯'};
function coverageLabel(source:DailyCoverage['source']){
 const provider=source.provider?dailyEnterpriseLabels[source.provider]:'云之家';
 if(isDailyCalendar(source))return provider+'日历';
 if(isDailyMessage(source))return provider+(isDailyDirectChats(source)?'单聊':'群消息');
 return itemLabels[source.kind as keyof typeof itemLabels];
}

export function dailyMessageNoticeItems(items:DailyItem[]){
 return items.filter(item=>item.messageAttention).sort(sortMessageAttention);
}

export function dailyMessageNotice(items:DailyItem[],timeZone:string,calendarEvidence:ReadonlyMap<string,string|CalendarContext>=new Map()){
 const actionable=dailyMessageNoticeItems(items);
 if(!actionable.length)return undefined;
 const time=dateAndTime(timeZone);
 const entries=actionable.slice(0,3).map(item=>{
  const {context,source,text,followUp}=describeAttention(item,time,calendarEvidence.get(item.id));
  return ['**'+context+'**',source,'消息要点「'+text+'」',...followUp].join('\n\n');
 });
 return ['**消息里需要关注的事项**',...entries,
  ...(actionable.length>entries.length?['更多事项可从顶部「简报」查看。']:[])].join('\n\n');
}

export function dailyBriefItems(items:DailyItem[],at:number,redact:(text:string)=>string){
 const actionable=items.filter(item=>isDailyMessage(item.source)&&item.messageAttention&&
  transcriptExcerpt(item.messageAttention.text,redact,180)).sort(sortMessageAttention);
 const others=items.filter(item=>!isDailyMessage(item.source)&&(!isDailyCalendar(item.source)||(item.deadline??0)>=at)&&
  item.title!=='无主题'&&transcriptExcerpt(item.title,redact,90));
 return [...actionable,...others];
}

/** Only include bounded excerpts from sources confirmed for the assistant's private chat. */
export function dailyBriefMessage(day:string,slot:DailySlot,items:DailyItem[],timeZone:string,redact:(text:string)=>string,calendarEvidence:ReadonlyMap<string,string|CalendarContext>=new Map()){
 if(!items.length)return undefined;
 const times=dateAndTime(timeZone);
 const entries=items.map(item=>{
  if(item.messageAttention){
   const preview=transcriptExcerpt(item.messageAttention.text,redact,180);
   if(!preview)return;
   const group=transcriptExcerpt(item.messageAttention.group,redact,70)??'原会话';
   const safe={...item,messageAttention:{...item.messageAttention,text:preview,group}};
   const {context,source,text,followUp}=describeAttention(safe,times,calendarEvidence.get(item.id));
   const next=followUp.filter(value=>/^(?:回复草稿|已核对|已查看|日历暂未|会议时间|会议的|可选回复)/.test(value));
   return '- **'+context+'**（'+source+'）'+text+(next.length?' '+next.join(' '):'');
  }
  const title=transcriptExcerpt(item.title,redact,90);
  if(!title)return;
  if(isDailyCalendar(item.source)){
   const detail=transcriptExcerpt(item.detail,redact,120);
   return '- **'+(item.urgent?'日程冲突':'日程')+'** '+times.format(item.deadline!)+' · '+plain(title)+(detail?.includes('冲突')?' · '+plain(detail.slice(detail.indexOf('冲突'))):'');
  }
  const label=item.source.kind in itemLabels?itemLabels[item.source.kind as keyof typeof itemLabels]:undefined;
  return label?'- **'+label+'** '+plain(title):undefined;
 }).filter(Boolean);
 return entries.length?['**'+day+' '+dailySlotLabels[slot]+'**','',...entries].join('\n'):undefined;
}

export function dailyBriefCard(input:{
 id:string;title:string;items:DailyItem[];timeZone:string;redact:(text:string)=>string;
 evidence:ReadonlyMap<string,string|CalendarContext>;coverage:DailyCoverage[];
}):AssistantDailyCard|undefined{
 const {id,title,items,timeZone,redact,evidence,coverage}=input;
 const times=dateAndTime(timeZone),sections:RenderUISection[]=[{kind:'heading',text:title,level:2}];
 const calendarRows=items.filter(item=>isDailyCalendar(item.source)&&Number.isFinite(item.deadline))
  .sort((a,b)=>a.deadline!-b.deadline!).flatMap(item=>{
   const title=transcriptExcerpt(item.title,redact,90);
   if(!title)return [];
   const detail=transcriptExcerpt(item.detail,redact,120);
   return [[times.format(item.deadline!),title+(detail?.includes('冲突')?' · '+detail.slice(detail.indexOf('冲突')):'')]];
  });
 if(calendarRows.length)sections.push({kind:'heading',text:'日程安排',level:3},{kind:'table',columns:['时间','事项'],rows:calendarRows});
 for(const item of items.filter(item=>!isDailyCalendar(item.source))){
  if(item.messageAttention){
   const snippet=transcriptExcerpt(item.messageAttention.text,redact,180);
   if(!snippet)continue;
   const group=transcriptExcerpt(item.messageAttention.group,redact,70)??'原会话';
   const row=describeAttention({...item,messageAttention:{...item.messageAttention,text:snippet,group}},times,evidence.get(item.id),text=>text);
   sections.push({kind:'heading',text:row.context,level:3},{kind:'text',content:row.source+' · '+row.text});
   if(row.followUp.length)sections.push({kind:'list',items:row.followUp.map(text=>redact(text).slice(0,240))});
  }else{
   const title=transcriptExcerpt(item.title,redact,90);
   const label=item.source.kind in itemLabels?itemLabels[item.source.kind as keyof typeof itemLabels]:undefined;
   if(title&&label)sections.push({kind:'text',content:label+' · '+title});
  }
 }
 if(sections.length===1)return;
 const gaps=coverage.flatMap(row=>{
  const label=coverageLabel(row.source);
  return row.state==='ok'||!label?[]:[label+(row.state==='partial'?'未查全':'暂不可用')];
 });
 if(gaps.length)sections.push({kind:'divider'},{kind:'text',content:[...new Set(gaps)].slice(0,4).join(' · ')});
 try {
  const card=compileRenderUiToA2ui({title,sections},{taskId:id,toolUseId:'proactive-brief'});
  return {artifactId:card.surfaceId,content:JSON.stringify(card.messages)};
 }catch{
  // The original Markdown remains available even if the card fails validation.
  return undefined;
 }
}

export type BriefDelivery={kind?:'message-notice';id:string;roomId:string;body:string;card?:AssistantDailyCard;deadline:number;guard:()=>Promise<void>};

/** Publish with the same host-owned admission as other assistant chat replies. */
export function dailyBriefPublisher(upstream:Upstreams,store:TeamStore,coordinator:TeamCoordinator,assistant:()=>{roomId:string;botId:string}|undefined,hostFence:number){
 return async ({kind,id,roomId,body,card,deadline,guard}:BriefDelivery)=>{
  const identity=assistant(),binding=identity&&store.binding(identity.botId);
  if(!identity||identity.roomId!==roomId||!binding)throw new KTeamError('assistant_scope_required',403);
  const botId=identity.botId;
  const current=async()=>{
   const expectedRoomRevision=await coordinator.guardConversation(roomId);
   await guard();
   const target=assistant();
   if(target?.roomId!==roomId||target.botId!==botId||store.binding(botId)?.revision!==binding.revision||expectedRoomRevision===undefined||Date.now()>=deadline)
    throw new KTeamError('daily_brief_scope_changed',409);
   return expectedRoomRevision;
  };
  await coordinator.ensureConversationContract(roomId);
  await current();
  const eventId=(kind:string)=>'msg_'+hash(id+':'+kind).slice(0,32);
  const threadId='assistant-daily-'+hash(id).slice(0,24);
  const topic=kind==='message-notice'?'新消息提醒':'简报';
  const description='在小 K 私聊中投递'+topic;
  const expires=new Date(Math.min(deadline,Date.now()+300000)).toISOString();
  let task=(await upstream.aimp(roomId,'event',{id:eventId('request'),roomId,threadId,act:'request',body:description,
   payload:{kind:'task.request@1',must_understand:true,description,deadline:new Date(deadline).toISOString(),expires,budget:'none',
    acceptance:{predicates:['artifact_hash'],subjective:topic+'来自已确认来源的运行结果。',trust_root:LOCAL_HUMAN},assignee:agentAddress(botId),reviewer:LOCAL_HUMAN},
  })).task as any;
  await current();
  task=(await upstream.aimp(roomId,'agent-event',{logicalAgentId:botId,id:eventId('accept'),roomId,threadId,taskRef:task.taskRef,act:'accept',body:'准备投递'+topic+'。',
   targetEvent:{id:task.headId,hash:task.headHash},payload:{kind:'task.accept@1',must_understand:true,terms_hash:task.termsHash,caveats:[]},
  })).task as any;
  await current();
  task=(await upstream.aimp(roomId,'begin-execution',{logicalAgentId:botId,taskRef:task.taskRef,requestId:id,expectedRevision:task.revision,bindingRevision:binding.revision,hostFence})).task as any;
  const admission={logicalAgentId:botId,roomId,taskRef:task.taskRef,epoch:task.epoch,bindingRevision:binding.revision,hostFence};
  const expectedRoomRevision=await current();
  const matches=(message:any)=>message?.roomId===roomId&&message.sender?.logicalAgentId===botId&&message.sourceRef?.kind==='aimp_reply'&&message.sourceRef.taskRef===task.taskRef&&message.text===body;
  let message:any;
  try{message=(await upstream.aimp(roomId,'chat',{...admission,expectedRoomRevision,text:body})).message;}
  catch(error){
   if(!(error instanceof KTeamError)||error.code!=='upstream_operation_unknown')throw error;
   message=await findOwnerMessage(upstream,roomId,matches);
   if(!message)throw error;
  }
  if(!matches(message)||!message.messageId)throw new KTeamError('daily_brief_receipt_invalid',502);
  // Rendering metadata is optional once the original message has been accepted.
  if(card)try{rememberAssistantDailyCard(store,String(message.messageId),roomId,botId,task.taskRef,body,card);}catch{/* The confirmed message can still be read as Markdown. */}
  const artifacts=[{ref:'message://'+roomId+'/'+message.messageId,version:1,sha256:hash(body),media_type:'text/markdown'}];
  // The chat receipt is definitive even if closing the protocol record fails.
  await upstream.aimp(roomId,'agent-event',{...admission,id:eventId('deliver'),threadId,act:'deliver',body:topic+'已投递。',
   targetEvent:{id:task.headId,hash:task.headHash},artifacts,payload:{kind:'task.deliver@1',must_understand:true,draft:false,caveats:[]},
  }).then(()=>upstream.aimp(roomId,'verify-delivery',{taskRef:task.taskRef})).catch(()=>{});
  return String(message.messageId);
 };
}
