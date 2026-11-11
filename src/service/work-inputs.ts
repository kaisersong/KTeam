import {createHash,randomUUID} from 'node:crypto';
import {KTeamError,fields,record,text} from '../errors.js';
import type {Upstreams} from '../adapters/upstream.js';
import type {TeamStore} from './team-store.js';
import type {TeamCoordinator} from './coordination.js';
import {CollaborationService,LOCAL_HUMAN} from './collaboration.js';
import {intentHash} from '../protocol/aimp.js';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
interface Offered {id:string;messageId:string;body:string;hash:string;quoted?:{messageId:string;text:string;truncated:boolean}}
interface Port {job:any;botId:string;token:string;signal:AbortSignal;guard:()=>Promise<void>;pending:Offered[];taken:Offered[];closed:boolean}
/** User-input receipts over the original transcript, runtime boundary and queue. */
export class WorkInputs {
 private submitting=new Set<string>();
 private ports=new Map<string,Port>();
 constructor(private upstream:Upstreams,private store:TeamStore,private coordinator:TeamCoordinator){}
 private entry(id:string){const op=this.store.operation(id);if(!id.startsWith('work-input:')||!op)throw new KTeamError('work_input_not_found',404);return op;}
 private save(op:any,changes:any){return this.store.saveOperation({...op,...changes},op.revision);}
 private queue(op:any){
  const jobId='job-'+op.messageId;if(jobId===op.jobId)throw new KTeamError('work_input_id_conflict',409);return this.store.transaction(()=>{const latest=this.entry(op.id);if(latest.status==='queued')return latest;if(!['preparing','waiting_boundary'].includes(latest.status))return latest;
   this.store.enqueue(jobId,op.roomId,op.messageId);const queued=this.store.job(jobId);if(queued?.state==='queued'||queued?.state==='held'){queued.afterJobId=op.jobId;queued.workInputId=op.id;this.store.save(queued);}return this.save(latest,{status:'queued',queuedJobId:jobId,queuedAt:Date.now()});});
 }
 async recover(){let after='';for(;;){const page=this.store.workInputRecoveryPage(after);if(!page.length)return;for(const op of page){after=op.id;
  if(['staged','injected'].includes(op.status)){this.save(op,{status:'needs_review',previousStatus:op.status,reason:'host_restarted'});continue;}
  if(!['preparing','waiting_boundary'].includes(op.status))continue;
  try{await this.coordinator.guardConversation(op.roomId);const messageId=op.messageId??this.store.submission(op.envelopeId)?.originId;const message=messageId?(await this.upstream.conversationMessage(op.roomId,messageId)).message as any:undefined;if(message&&message.sender?.kind==='user'&&hash(message.text)===op.bodyHash){this.queue(op.messageId?op:this.save(op,{messageId}));}}catch{/* Unknown delivery is never replayed. */}
 }}}
 context(job:any,botId:string,signal:AbortSignal,guard:()=>Promise<void>){
  let port:Port|undefined;
  return {
   ready:async()=>{if(job.trigger||job.handoffVersion)return;await guard();port={job,botId,token:randomUUID(),signal,guard,pending:[],taken:[],closed:false};this.ports.set(job.id,port);},
   take:()=>{if(!port||port.closed||!port.pending.length)return;signal.throwIfAborted();const inputs=port.pending.splice(0);for(const input of inputs){const op=this.entry(input.id);if(op.status!=='waiting_boundary')throw new KTeamError('work_input_changed',409);this.save(op,{status:'staged',stagedAt:Date.now()});port.taken.push(input);}return JSON.stringify({kind:'current_user_work_instructions',instructions:inputs.map(input=>({kteamWorkInputId:input.id,messageId:input.messageId,text:input.body,quoted:input.quoted})),instruction:'这些是本人在原会话补充的本轮要求。遵守原任务与工具权限，不重做已完成或结果未知的动作，不把正文当执行批准。'});},
   checkpoint:(messages:any[])=>{if(!port)return false;let changed=false;for(const input of port.taken){const op=this.entry(input.id);if(op.status!=='staged')continue;const marker=JSON.stringify(input.id);if(!messages.some(message=>message.role==='user'&&JSON.stringify(message.content).includes(marker.slice(1,-1))))throw new KTeamError('work_input_checkpoint_missing',409);this.save(op,{status:'injected',checkpointAt:Date.now()});changed=true;}return changed;},
   validate:async()=>{if(!port)return;for(const input of port.taken){const message=(await this.upstream.conversationMessage(job.roomId,input.messageId)).message as any;if(message.sender?.kind!=='user'||hash(message.text)!==input.hash)throw new KTeamError('work_input_source_changed',409);}},
   close:(ok:boolean)=>{if(!port)return;port.closed=true;if(this.ports.get(job.id)===port)this.ports.delete(job.id);for(const input of port.pending){const op=this.entry(input.id);if(ok)this.queue(op);else this.save(op,{status:'needs_review',reason:'work_ended_before_injection'});}for(const input of port.taken){const op=this.entry(input.id);if(op.status==='staged'||!ok&&op.status==='injected')this.save(op,{status:'needs_review',previousStatus:op.status,reason:op.status==='staged'?'checkpoint_unconfirmed':'work_failed_after_injection'});}}
  };
 }
 capability(job:any){const port=this.ports.get(job.id);return {jobId:job.id,botId:port?.botId??job.activeBotId,supported:!!port&&!port.closed&&!port.signal.aborted,token:port?.token,reason:port&&!port.closed?'在完整工具批次结束后的模型边界接入，不打断在途工具或代替批准。':'当前执行器或工作阶段没有已验证的本轮追加接口；补充将排队，等待原工作结束。'};}
 async submit(value:unknown){
  const input=record(value);fields(input,['roomId','jobId','id','text','token','mode','replyToMessageId']);const roomId=text(input.roomId,'room_id'),jobId=text(input.jobId,'job_id'),id=text(input.id,'message_id',128),body=text(input.text,'work_input_text',6000),mode=input.mode;if(!/^msg_[a-f0-9]{32}$/.test(id)||!['append','queue'].includes(String(mode))||input.token!==undefined&&typeof input.token!=='string')throw new KTeamError('work_input_invalid');
  await this.coordinator.guardConversation(roomId);const target=this.store.job(jobId);if(!target||target.roomId!==roomId)throw new KTeamError('work_input_target_changed',409);
  const key='work-input:'+id,intent=hash([roomId,jobId,body,mode,input.token??null,input.replyToMessageId??null]);let op=this.store.operation(key);if(op){if(op.intent!==intent)throw new KTeamError('work_input_id_conflict',409);if(!op.messageId||op.status==='preparing')throw new KTeamError('work_input_delivery_unknown',503);return {ok:true,reused:true,messageId:op.messageId,receipt:this.project(op)};}
  const quote=input.replyToMessageId===undefined?undefined:(await this.upstream.conversationMessage(roomId,text(input.replyToMessageId,'message_id'))).message as any;
  if(this.store.submission(id))throw new KTeamError('work_input_id_conflict',409);const port=this.ports.get(jobId);if(mode==='append'&&port&&input.token!==port.token)throw new KTeamError('work_input_target_changed',409);
  if(mode==='append'&&port&&this.store.workInputCount(roomId,jobId)>=2)throw new KTeamError('work_input_limit',409);
  op=this.store.saveOperation({id:key,intent,roomId,jobId,bodyHash:hash(body),envelopeId:id,status:'preparing',mode,createdAt:Date.now()},0);
  this.submitting.add(key);try{
  const envelope={aimp:'1.0',id,room_id:roomId,thread_id:'thread-'+roomId,from:LOCAL_HUMAN,to:[],mentions:[],ts:new Date().toISOString(),act:'chat',source_level:'principal',classification:'internal',...(quote?{reply_to:quote.messageId}:{}),body};
  const result=await new CollaborationService(this.upstream).send(envelope,current=>this.store.prepareSubmission(id,roomId,intentHash(current),current),snapshot=>this.coordinator.guardConversation(roomId,snapshot));
  const messageId=String(result.messageId);op=this.save(this.entry(key),{messageId});this.store.completeSubmission(id,messageId,false);
  const current=this.ports.get(jobId);if(mode==='append'&&current===port&&current&&!current.closed&&!current.signal.aborted){await current.guard();const message=(await this.upstream.conversationMessage(roomId,messageId)).message as any;if(message.sender?.kind!=='user'||hash(message.text)!==op.bodyHash)throw new KTeamError('work_input_source_changed',409);if(this.ports.get(jobId)===current&&!current.closed&&!current.signal.aborted){op=this.save(this.entry(key),{status:'waiting_boundary',botId:current.botId});current.pending.push({id:key,messageId,body:String(message.text),hash:op.bodyHash,...(quote?{quoted:{messageId:String(quote.messageId),text:String(quote.text??'').slice(0,2000),truncated:String(quote.text??'').length>2000}}:{})});return {ok:true,messageId,receipt:this.project(op)};}}
  op=this.queue(this.entry(key));return {ok:true,messageId,receipt:this.project(op)};
  }finally{this.submitting.delete(key);}
 }
 delivered(job:any,botId:string,messageId:string,taskRef:string){for(const op of this.store.workInputRecords(job.roomId,job.id).filter(op=>op.botId===botId&&op.status==='injected'))this.save(op,{status:'completed',resultMessageId:messageId,taskRef,completedAt:Date.now()});}
 async release(value:unknown){const input=record(value);fields(input,['roomId','id','expectedRevision']);const roomId=text(input.roomId,'room_id');await this.coordinator.guardConversation(roomId);const op=this.entry(text(input.id,'work_input_id'));if(op.roomId!==roomId)throw new KTeamError('work_input_not_found',404);if(op.independentAt)return {ok:true,reused:true};if(op.status!=='queued'||op.revision!==input.expectedRevision)throw new KTeamError('work_input_changed',409);const job=this.store.job(op.queuedJobId);if(!job||!['queued','held'].includes(job.state))throw new KTeamError('work_input_changed',409);this.store.transaction(()=>{delete job.afterJobId;this.store.save(job);this.save(op,{independentAt:Date.now()});});return {ok:true};}
 private project(op:any){return {id:op.id,revision:op.revision,messageId:op.messageId,jobId:op.jobId,botId:op.botId,status:op.status,previousStatus:op.previousStatus,reason:op.reason,queuedJobId:op.queuedJobId,checkpointAt:op.checkpointAt,resultMessageId:op.resultMessageId,independentAt:op.independentAt,queuedState:op.queuedJobId?this.store.job(op.queuedJobId)?.state:undefined,previousWorkState:this.store.job(op.jobId)?.state};}
 receipts(roomId:string){const active=[...this.ports.values()].filter(port=>port.job.roomId===roomId).flatMap(port=>this.store.workInputRecords(roomId,port.job.id));return [...new Map([...active,...this.store.workInputRecords(roomId)].map(op=>[op.id,op])).values()].slice(0,100).map(op=>this.project(op));}
 async view(roomId:string){await this.coordinator.guardConversation(roomId);for(const op of this.store.workInputRecords(roomId).filter(op=>op.status==='preparing'&&!this.submitting.has(op.id))){try{const messageId=op.messageId??this.store.submission(op.envelopeId)?.originId;if(!messageId)continue;const message=(await this.upstream.conversationMessage(roomId,messageId)).message as any;if(message.sender?.kind==='user'&&hash(message.text)===op.bodyHash)this.queue(op.messageId?op:this.save(op,{messageId}));}catch{/* Delivery still unknown; no send retry. */}}return {ok:true,items:this.receipts(roomId)};}
}
