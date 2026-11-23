import {createHash} from 'node:crypto';
import type {Upstreams} from '../adapters/upstream.js';
import {KTeamError} from '../errors.js';
import {dailySlotLabels,dailyEnterpriseLabels,isDailyCalendar,type DailyMessageAttention,type DailyItem,type DailySlot,type DailySourceKind} from '../protocol/assistant-daily-types.js';
import {agentAddress,LOCAL_HUMAN} from './collaboration.js';
import type {TeamCoordinator} from './coordination.js';
import {findOwnerMessage} from './room-reads.js';
import type {TeamStore} from './team-store.js';

const kinds:Record<DailySourceKind,string>={
 mail:'待查看邮件','yzj-message':'待查看云之家消息','yzj-calendar':'日程和会议','yzj-doc':'更新的知识库文档',news:'关注资讯','enterprise-message':'待查看企业消息','enterprise-calendar':'日程和会议',
};
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');

/** The transcript can be cached on paired devices. Keep source content in the revalidated brief view. */
export function dailyBriefMessage(day:string,slot:DailySlot,items:DailyItem[],at:number,timeZone:string){
 if(!items.length)return undefined;
 const counts=new Map<string,number>();
 for(const item of items){const label=kinds[item.source.kind];counts.set(label,(counts.get(label)??0)+1);}
 const lines=Array.from(counts,([label,count])=>'- '+label+' '+count+' 项');
 const next=items.filter(item=>isDailyCalendar(item.source)&&(item.deadline??0)>at)
  .map(item=>item.deadline!).sort((a,b)=>a-b)[0];
 if(next!==undefined)lines.push('下一项日程 '+new Intl.DateTimeFormat('zh-CN',{timeZone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(next)+'。');
 const urgent=items.filter(item=>item.urgent).length;
 return ['**'+day+' '+dailySlotLabels[slot]+'**',...lines,
  ...(urgent?['其中 '+urgent+' 项需要优先核对。']:[]),'打开会话顶部「简报」查看详情。'].join('\n');
}

const attentionLabels:Record<DailyMessageAttention['kind'],{label:string;priority:number}>={
 schedule:{label:'日程变更',priority:0},
 deadline:{label:'截止或到期',priority:1},
 decision:{label:'需要确认',priority:2},
 reply:{label:'待回复',priority:3},
};
const plain=(text:string)=>text.replace(/[<&>]/g,value=>({'<':'＜','>':'＞','&':'＆'})[value]!).replace(/[\x5c`*_{}\[\]()#!|~]/g,value=>'\\'+value);
export function dailyMessageNotice(items:DailyItem[],timeZone:string,calendarEvidence=new Map<string,string>()){
 const actionable=items.flatMap(item=>item.messageAttention?[{id:item.id,source:item.source,...item.messageAttention}]:[])
  .sort((a,b)=>attentionLabels[a.kind].priority-attentionLabels[b.kind].priority||b.at-a.at);
 if(!actionable.length)return undefined;
 const time=new Intl.DateTimeFormat('zh-CN',{timeZone,month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 const entries=actionable.slice(0,3).map(item=>{
  const provider=item.source.provider?dailyEnterpriseLabels[item.source.provider]:'云之家';
  const action=attentionLabels[item.kind];
  const proof=calendarEvidence.get(item.id);
  const ask=item.text.match(/(?:请(?:你|您)?|麻烦(?:你|您)?|等你)([^。！？\n]{2,100})/)?.[1]?.trim();
  const ack=/请(?:你|您|大家)?(?:在群里)?回复[「“”'"]?收到|请确认收到/.test(item.text);
  const followUp=item.kind==='schedule'
   ? [proof??'请核对原群通知中的新安排。']
   : item.kind==='decision'||item.kind==='reply'
    ? [...(ask?['对方请你'+ask.replace(/[，、；：;]+$/,'')+'。']:[]),
      ack?'回复草稿「收到，谢谢通知。」': '可引用这条提醒，补上你的决定或回复口径。']
    : [];
  return ['**'+action.label+' · '+plain(item.group)+'**',provider+' · '+time.format(item.at),
   '消息要点「'+plain(item.text)+'」',...followUp.map(plain)].join('\n\n');
 });
 return ['**消息里需要关注的事项**',...entries,
  ...(actionable.length>entries.length?['更多事项可从顶部「简报」查看。']:[])].join('\n\n');
}

export type BriefDelivery={kind?:'message-notice';id:string;roomId:string;body:string;deadline:number;guard:()=>Promise<void>};

/** Publish with the same host-owned admission as other assistant chat replies. */
export function dailyBriefPublisher(upstream:Upstreams,store:TeamStore,coordinator:TeamCoordinator,assistant:()=>{roomId:string;botId:string}|undefined,hostFence:number){
 return async ({kind,id,roomId,body,deadline,guard}:BriefDelivery)=>{
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
  const artifacts=[{ref:'message://'+roomId+'/'+message.messageId,version:1,sha256:hash(body),media_type:'text/markdown'}];
  // The chat receipt is definitive even if closing the protocol record fails.
  await upstream.aimp(roomId,'agent-event',{...admission,id:eventId('deliver'),threadId,act:'deliver',body:topic+'已投递。',
   targetEvent:{id:task.headId,hash:task.headHash},artifacts,payload:{kind:'task.deliver@1',must_understand:true,draft:false,caveats:[]},
  }).then(()=>upstream.aimp(roomId,'verify-delivery',{taskRef:task.taskRef})).catch(()=>{});
  return String(message.messageId);
 };
}
