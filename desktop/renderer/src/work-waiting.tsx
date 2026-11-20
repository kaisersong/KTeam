import {Clock3,UsersRound,AlertCircle,ArrowRight,ChevronDown} from 'lucide-react';
import {explain,type Bot} from './api';
const labels:Record<string,string>={queued:'排队中',held:'已暂停',routing:'准备中',running:'进行中',stopping:'正在停止',waiting:'等待下一步',waiting_user:'等待本人确认',delivered:'已完成',blocked:'执行受阻',unknown:'结果待核对',stopped:'已停止',noop:'未执行',cancelled:'已取消'};
export function WorkWaitingNotice({job,bots,busy,onDetails,onPause,onOpenConfirmation,onSource,onMember,onResult,resultIds}:{job:any;bots:Bot[];busy:boolean;onDetails:()=>void;onPause:()=>void;onOpenConfirmation:(roomId:string,id:string)=>void;onSource:()=>void;onMember?:(id:string)=>void;onResult?:(id:string,botId:string,messageId:string)=>void;resultIds?:ReadonlySet<string>}){
 const waiting=job.handoffWait;if(job.state!=='waiting'||!waiting||waiting.operationId!==job.currentHandoffId)return null;
 const name=(id:string)=>bots.find(bot=>bot.id===id)?.name.replace(/ · KTeam .+$/,'')??'原成员';
 const children:any[]=Array.isArray(waiting.children)?waiting.children:[];
 const blocked=children.some(child=>['blocked','unknown','stopped','cancelled'].includes(child.state));
 const needsAnswer=!!waiting.questionId,needsApproval=!!waiting.approvalId,needsInput=children.some(child=>child.state==='waiting_user');
 const allReturned=children.length>0&&children.every(child=>child.state==='delivered');
 const title=needsApproval?'需要你确认操作':needsAnswer?'需要你补充信息':waiting.condition?'正在等待'+waiting.condition.label:needsInput?name(children.find(child=>child.state==='waiting_user').botId)+'等待你确认':blocked?'部分成员受阻':waiting.lastError||allReturned?'正在核对协作结果':'团队正在协作';
 const description=needsApproval?'请核对操作内容，确认或拒绝后继续。':needsAnswer?'请到私聊补充信息，成员收到后继续处理。':waiting.condition?waiting.doneWhen:needsInput?(children.some(child=>child.approvalRoomId===job.roomId)?'请在群里的授权卡处理确认事项。':'请到对应成员的私聊处理确认事项。'):blocked?'有成员暂时无法继续，请查看下面的原因。':waiting.lastError?'暂时无法读取最新进度，正在重新连接。':allReturned?'成员结果已返回，接下来由'+name(job.activeBotId)+'核对。':'成员完成后，'+name(job.activeBotId)+'会检查结果并继续推进。';
 const Icon=blocked?AlertCircle:needsApproval||needsAnswer||waiting.condition?Clock3:UsersRound;
 const deadline=Number(waiting.deadline);
 const progress=children.map(child=>name(child.botId)+' '+(labels[child.state]??'状态待核对')).join(' · ');
 return <section className="conversation-work-status" aria-label={title}>
 <details key={waiting.operationId} className="conversation-work-status-disclosure"><summary><Icon size={13}/><strong role="status">{title}</strong>{progress&&<span title={progress}>{progress}</span>}<ChevronDown className="work-status-chevron" size={13}/></summary><div className="conversation-work-status-content">
  <p>{description}</p>
  {!waiting.condition&&waiting.doneWhen&&children.length>0&&<p className="work-stage-goal">{waiting.doneWhen}</p>}
  {needsApproval&&<button type="button" className="text-link" onClick={()=>onOpenConfirmation(job.roomId,waiting.approvalId)}>查看授权卡</button>}
  {waiting.questionRoomId&&<button type="button" className="text-link" onClick={()=>onOpenConfirmation(waiting.questionRoomId,waiting.questionId)}>去私聊回答</button>}
  {children.length>0&&<ul>{children.map(child=><li key={child.jobId??child.botId}>
   <span>{name(child.botId)}</span><small>{labels[child.state]??'状态待核对'}{child.reason?' · '+explain(child.reason):''}{child.model?'（'+child.model+'）':''}</small>
   {child.reason==='model_tool_approval_unavailable'&&onMember&&<button className="text-link" onClick={()=>onMember(child.botId)}>调整成员模型</button>}
   {child.questionRoomId&&child.questionId&&<button type="button" className="text-link" onClick={()=>onOpenConfirmation(child.questionRoomId,child.questionId)}>去私聊回答</button>}
   {child.approvalRoomId&&child.approvalId&&<button type="button" className="text-link" onClick={()=>onOpenConfirmation(child.approvalRoomId,child.approvalId)}>查看授权卡</button>}
   {child.exchangeId&&resultIds?.has(child.exchangeId)&&onResult&&<>
    {child.requestMessageId&&<button type="button" className="text-link" onClick={()=>onResult(child.exchangeId,child.botId,child.requestMessageId)}>查看派单</button>}
    {child.state==='delivered'&&child.resultMessageId&&<button type="button" className="text-link" onClick={()=>onResult(child.exchangeId,child.botId,child.resultMessageId)}>查看成员回执</button>}
   </>}
  </li>)}</ul>}
  <footer><div className="work-waiting-details">
   {Number.isFinite(deadline)&&deadline>0&&<small>本阶段期限：{new Date(deadline).toLocaleString()}。到期仍未完成时会保留进度并提示。</small>}
   <button type="button" className="text-button" onClick={onSource}>查看原消息</button>
   <button type="button" className="text-button" disabled={busy} onClick={onDetails}>查看执行记录<ArrowRight size={13}/></button>
  </div><button className="secondary" disabled={busy} onClick={onPause}>暂停会话</button></footer>
 </div></details></section>;
}
