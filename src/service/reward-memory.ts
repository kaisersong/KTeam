import {createHash} from 'node:crypto';
import type {TeamStore} from './team-store.js';
import {KTeamError} from '../errors.js';
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Evidence-derived hints. Never consulted by permission, claim, lease or approval code. */
export class RewardMemory {
 constructor(private store:TeamStore,private now=Date.now){}
 recordAccepted(roomId:string,task:any){
  if(task.state!=='accepted'||!task.artifactVerification?.verified)throw new KTeamError('reward_evidence_required',409);
  const job=this.store.jobs(roomId).find(job=>(job.results??[]).some((r:any)=>r.taskRef===task.taskRef));const result=job?.results?.find((r:any)=>r.taskRef===task.taskRef),binding=result?this.store.binding(result.botId):null;if(!job||!result||!binding||binding.fingerprint!==result.fingerprint)return;
  const artifacts=this.store.operationsWithPrefix('artifact-delivery:').filter(row=>row.jobId===job.id&&row.botId===result.botId&&row.status==='published'),id='reward-memory:'+digest([roomId,task.taskRef,task.artifacts]);
  if(this.store.operation(id))return;
  this.store.saveOperation({id,roomId,botId:result.botId,profileRevision:result.profileRevision??job.executionScope?.profileRevision??0,fingerprint:binding.fingerprint,bindingRevision:binding.revision,sourceTaskRef:task.taskRef,sourceMessageId:result.messageId,evidence:{kind:'explicit-human-acceptance',artifactVerification:task.artifactVerification,artifacts:task.artifacts,typedReceipts:artifacts.map(a=>a.receipt)},hint:artifacts.length?'此前同范围交付采用候选生成、结构校验和版本发布，并由用户明确接受；这不证明新的内容正确，仍需逐次核对。':'此前答复有传输回执并获用户明确接受；不推断其中操作已执行或产物已验证。',createdAt:this.now(),expiresAt:this.now()+30*86400000,status:'active'},0);
 }
 recall(roomId:string,botId:string,profileRevision=0){const binding=this.store.binding(botId);if(!binding)return [];return this.store.operationsWithPrefix('reward-memory:').filter(row=>row.status==='active'&&row.profileRevision===profileRevision&&row.expiresAt>this.now()&&row.roomId===roomId&&row.botId===botId&&row.fingerprint===binding.fingerprint&&row.bindingRevision===binding.revision).slice(0,4).map(({id,sourceTaskRef,sourceMessageId,hint,expiresAt})=>({id,sourceTaskRef,sourceMessageId,hint,expiresAt,authority:'none'}));}
 revoke(id:string,roomId:string){const row=this.store.operation(id);if(!id.startsWith('reward-memory:')||!row||row.roomId!==roomId)throw new KTeamError('reward_not_found',404);if(row.status!=='revoked')this.store.saveOperation({...row,status:'revoked',revokedAt:this.now()},row.revision);}
}
