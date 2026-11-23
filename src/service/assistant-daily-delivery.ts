import {createHash} from 'node:crypto';
import type {Upstreams} from '../adapters/upstream.js';
import {KTeamError} from '../errors.js';
import {dailySlotLabels,type DailyItem,type DailySlot,type DailySourceKind} from '../protocol/assistant-daily-types.js';
import {agentAddress,LOCAL_HUMAN} from './collaboration.js';
import type {TeamCoordinator} from './coordination.js';
import {findOwnerMessage} from './room-reads.js';
import type {TeamStore} from './team-store.js';

const kinds:Record<DailySourceKind,string>={
 mail:'待查看邮件','yzj-message':'待查看云之家消息','yzj-calendar':'日程','yzj-doc':'更新的知识库文档',news:'关注资讯',
};
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');

/** The transcript can be cached on paired devices. Keep source content in the revalidated brief view. */
export function dailyBriefMessage(day:string,slot:DailySlot,items:DailyItem[]){
 if(!items.length)return undefined;
 const counts=new Map<DailySourceKind,number>();
 for(const item of items)counts.set(item.source.kind,(counts.get(item.source.kind)??0)+1);
 const lines=Array.from(counts,([kind,count])=>'- '+kinds[kind]+' '+count+' 项');
 const urgent=items.filter(item=>item.urgent).length;
 return ['**'+day+' '+dailySlotLabels[slot]+'**',...lines,
  ...(urgent?['其中 '+urgent+' 项需要优先核对。']:[]),'打开会话顶部「简报」查看详情。'].join('\n');
}

type BriefDelivery={id:string;roomId:string;body:string;deadline:number;guard:()=>Promise<void>};

/** Publish with the same host-owned admission as other assistant chat replies. */
export function dailyBriefPublisher(upstream:Upstreams,store:TeamStore,coordinator:TeamCoordinator,assistant:()=>{roomId:string;botId:string}|undefined,hostFence:number){
 return async ({id,roomId,body,deadline,guard}:BriefDelivery)=>{
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
  const description='在小 K 私聊中投递本期简报';
  const expires=new Date(Math.min(deadline,Date.now()+300000)).toISOString();
  let task=(await upstream.aimp(roomId,'event',{id:eventId('request'),roomId,threadId,act:'request',body:description,
   payload:{kind:'task.request@1',must_understand:true,description,deadline:new Date(deadline).toISOString(),expires,budget:'none',
    acceptance:{predicates:['artifact_hash'],subjective:'简报来自本期已确认来源的运行结果。',trust_root:LOCAL_HUMAN},assignee:agentAddress(botId),reviewer:LOCAL_HUMAN},
  })).task as any;
  await current();
  task=(await upstream.aimp(roomId,'agent-event',{logicalAgentId:botId,id:eventId('accept'),roomId,threadId,taskRef:task.taskRef,act:'accept',body:'准备投递简报。',
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
  await upstream.aimp(roomId,'agent-event',{...admission,id:eventId('deliver'),threadId,act:'deliver',body:'简报已投递。',
   targetEvent:{id:task.headId,hash:task.headHash},artifacts,payload:{kind:'task.deliver@1',must_understand:true,draft:false,caveats:[]},
  }).then(()=>upstream.aimp(roomId,'verify-delivery',{taskRef:task.taskRef})).catch(()=>{});
  return String(message.messageId);
 };
}
