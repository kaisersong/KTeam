import {normalizeHarnessInput} from '../runtime/harness.js';
import {isDeepStrictEqual} from 'node:util';
import type {TeamStore} from './team-store.js';

/** Host evidence only; model text and checkpoint state alone cannot release an owner. */
export function staleToolBatchApproval(store:TeamStore,batch:any,scope:{roomId:string;botId:string;bindingRevision:number;profileRevision:number;fingerprint:string;cwd:string}){
 if(batch?.state!=='waiting_approval'||!Array.isArray(batch.calls)||!Array.isArray(batch.results))return;
 const old=store.job(batch.ownerId),approval=store.operation(batch.approvalId);
 if(!old||old.roomId!==scope.roomId||!['blocked','stopped','delivered'].includes(old.state)||old.stopResultUnknown||store.state('harness-fence:'+scope.botId))return;
 const index=batch.results.filter((result:any)=>result.type==='tool_result').length,call=batch.calls[index];
 if(!call||!approval?.durable||!['pending','cancelled','denied','allowed'].includes(approval.status)||approval.jobId!==old.id||approval.roomId!==scope.roomId||approval.botId!==scope.botId||approval.bindingRevision!==scope.bindingRevision||approval.profileRevision!==scope.profileRevision||approval.modelFingerprint!==scope.fingerprint||(approval.sessionCwd??approval.cwd)!==scope.cwd||approval.batchId!==batch.id||approval.index!==index||approval.toolName!==call.name||!isDeepStrictEqual(approval.input,normalizeHarnessInput(call.name,call.input,scope.cwd)))return;
 return approval;
}
export function retireStaleToolBatch(store:TeamStore,batch:any,scope:Parameters<typeof staleToolBatchApproval>[2]){
 return store.transaction(()=>{const approval=staleToolBatchApproval(store,batch,scope);if(!approval)return false;
  if(approval.status!=='cancelled')store.saveOperation({...approval,status:'cancelled',reason:'stale_harness_owner'},approval.revision);
  return true;
 });
}

/** Only a linked recovery may quarantine its own ended execution; never resume an unknown call. */
export function retireUnknownToolBatch(store:TeamStore,batch:any,scope:Parameters<typeof staleToolBatchApproval>[2],recoveryJobId:string){
 const job=store.job(recoveryJobId),old=store.job(batch?.ownerId);
 if(!batch||!['executing','preparing'].includes(batch.state)||!job||job.trigger!=='recovery'||job.state!=='running'||job.roomId!==scope.roomId||job.activeBotId!==scope.botId||!old||old.roomId!==scope.roomId||old.activeBotId!==scope.botId||old.originId!==job.originId||!['stopped','blocked','unknown'].includes(old.state)||old.stopResultUnknown||store.state('harness-fence:'+scope.botId))return false;
 const binding=job.recoveryBindings?.[scope.botId];if(binding?.revision!==scope.bindingRevision||binding?.fingerprint!==scope.fingerprint)return false;
 let parent=job;const seen=new Set<string>();while(parent?.recoveryOf&&!seen.has(parent.id)){seen.add(parent.id);parent=store.job(parent.recoveryOf);if(!parent||parent.roomId!==scope.roomId||parent.originId!==job.originId)return false;if(parent.id===old.id){const id='quarantined-tool-batch:'+batch.id;if(!store.operation(id))store.saveOperation({id,status:'unknown',sourceJobId:old.id,recoveryJobId,roomId:scope.roomId,botId:scope.botId,batch:structuredClone(batch),reason:'ended_owner_reconcile_without_replay'},0);return true;}}
 return false;
}
