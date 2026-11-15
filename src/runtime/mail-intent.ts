import {MailNotSubmitted} from '../service/mail/mail-send-errors.js';
import {createHash} from 'node:crypto';
import type {TeamStore} from '../service/team-store.js';
import {KTeamError} from '../errors.js';
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
type ReceiptReader=(id:string)=>Promise<any>;
/** Host-owned intent identity survives model UUID changes. No send grant is created here. */
export class MailIntent {
 private reader?:ReceiptReader;
 constructor(private store:TeamStore,private scope:{jobId:string;roomId:string;botId:string;originId:string;taskRef?:string},private guard:()=>Promise<void>,private effect?:(input:any)=>Promise<any>,private readEffects?:(taskRef:string)=>Promise<any>){}
 registerReceiptReader(reader:ReceiptReader){this.reader=reader;}
 private save(row:any,patch:any){return this.store.saveOperation({...row,...patch},row.revision??0);}
 private async update(row:any,state:string,evidence?:any){if(!this.effect||!row.taskRef)return;await this.effect({taskRef:row.taskRef,effectId:row.effectId,logicalAction:row.logicalAction??row.id,externalIdempotencyKey:row.id,clauseVersion:1,state,evidence});}
 private async settle(row:any){if(row.effectSynced||!this.effect||!row.taskRef)return row;const evidence={kind:'mail-provider-receipt',requestId:row.requestId,payloadHash:row.payloadHash,result:JSON.parse(row.result)};const confirmed=async()=>{if(!this.readEffects)return false;const result=await this.readEffects(row.taskRef),effect=result.effects?.find((e:any)=>e.effectId===row.effectId);return effect?.state==='completed'&&hash(effect.evidence)===hash(evidence);};await this.guard();if(!await confirmed()){try{await this.update(row,'completed',evidence);}catch(error){if(!await confirmed())throw new KTeamError('mail_effect_receipt_unknown',503);}}return this.save(row,{effectSynced:true});}
 private async reconcile(row:any,reader=this.reader){
  if(row.status==='accepted'){await this.settle(row);return this.store.operation(row.id);}
  if(!reader||!['pending','unknown'].includes(row.status))return row;
  const receipt=await reader(row.requestId);await this.guard();if(!receipt||receipt.requestId!==row.requestId||receipt.accountId!==row.accountId)return row;
  if(receipt.status==='accepted'&&receipt.result){row=this.save(row,{status:'accepted',result:JSON.stringify(receipt.result),acceptedAt:Date.now()});return this.settle(row);}
  if(receipt.status==='rejected'){const failed=async()=>{if(!this.readEffects||!row.taskRef)return false;const actual=await this.readEffects(row.taskRef);return actual.effects?.some((effect:any)=>effect.effectId===row.effectId&&effect.state==='failed');};if(!await failed()){try{await this.update(row,'failed',{kind:'not-applied',requestId:row.requestId,providerStatus:'rejected'});}catch(error){if(!await failed())throw error;}}return this.save(row,{status:'rejected',notApplied:true});}
  return row; // SMTP accept before durable finish remains pending/unknown.
 }
 statusTool(){return {permission:'safe',definition:{name:'mail_intent_status',description:'只读核对本成员当前工作来源的发信回执；不重新发送邮件，不接受任意requestId。',inputSchema:{type:'object',properties:{},additionalProperties:false}},execute:async()=>{await this.guard();const rows=[];for(const row of this.store.operationsWithPrefix('mail-intent:').filter(r=>r.roomId===this.scope.roomId&&r.botId===this.scope.botId&&r.originId===this.scope.originId)){const current=await this.reconcile(row);rows.push({intentId:current.id,status:current.status,requestId:current.requestId});}return JSON.stringify({items:rows});}};}
 assertPublishable(){for(const row of this.store.operationsWithPrefix('mail-intent:').filter(row=>row.roomId===this.scope.roomId&&row.botId===this.scope.botId&&row.originId===this.scope.originId)){if(['pending','unknown'].includes(row.status)||row.status==='accepted'&&this.effect&&!row.effectSynced)throw new KTeamError('mail_delivery_not_verified',409);}}
 async send(name:string,args:Record<string,unknown>,execute:(args:Record<string,unknown>)=>Promise<any>,reader=this.reader){
  await this.guard();const {requestId:ignored,...payload}=args,payloadHash=hash([name,payload]),intentHash=hash([this.scope.roomId,this.scope.botId,this.scope.originId,payloadHash]),id='mail-intent:'+intentHash;
  let row=this.store.operation(id);if(row)row=await this.reconcile(row,reader);
  if(row&&row.status!=='not_submitted'){if(row.status==='accepted')return row.result;throw new KTeamError(row.status==='rejected'?'mail_send_rejected':'mail_send_outcome_unknown',409);}
  if(this.store.operationsWithPrefix('mail-intent:').some(r=>r.payloadHash===payloadHash&&['pending','unknown'].includes(r.status)))throw new KTeamError('mail_send_outcome_unknown',409);
  if(row?.status==='not_submitted'&&this.readEffects&&this.effect&&row.taskRef){const state=await this.readEffects(row.taskRef),old=state.effects?.find((e:any)=>e.effectId===row.effectId);if(old&&old.state!=='failed'){if(old.state==='completed')throw new KTeamError('mail_effect_conflict',409);await this.update(row,'failed',{kind:'not-applied',phase:'before-send',requestId:row.requestId});}}
  const attempt=(row?.attempt??0)+1;if(attempt>3)throw new KTeamError('mail_retry_limit',409);
  const requestId=`${intentHash.slice(0,8)}-${intentHash.slice(8,12)}-4${intentHash.slice(13,16)}-8${intentHash.slice(17,20)}-${intentHash.slice(20,32)}`;
  row=this.store.saveOperation({...row,id,...this.scope,accountId:args.accountId,payloadHash,requestId,effectId:'effect_'+hash([id,attempt]),logicalAction:id+':repair:'+attempt,attempt,previousAttempts:[...(row?.previousAttempts??[]),...(row?[{effectId:row.effectId,taskRef:row.taskRef,status:row.status}]:[])],status:'pending',createdAt:row?.createdAt??Date.now()},row?.revision??0);let entered=false,registered=false;
  try{await this.guard();await this.update(row,'registered');registered=true;await this.guard();await this.update(row,'executing');entered=true;const result=await execute(name==='send_connected_mail'?{...payload,requestId}:payload);row=this.save(row,{status:'accepted',result,acceptedAt:Date.now()});await this.settle(row);return result;}
  catch(error){if(row.status==='accepted')throw error;const rejected=error instanceof KTeamError&&error.code==='mail_send_rejected',notSubmitted=!entered||error instanceof MailNotSubmitted||error instanceof KTeamError&&['mail_smtp_unconfigured','invalid_input'].includes(error.code),notApplied=notSubmitted||rejected;row=this.save(row,{status:rejected?'rejected':notSubmitted?'not_submitted':'unknown',unknownAt:Date.now()});if(registered)await this.update(row,notApplied?'failed':'unknown',notApplied?{kind:'not-applied',requestId,phase:'before-send'}:undefined).catch(()=>{});if(entered&&reader){const actual=await this.reconcile(row,reader);if(actual.status==='accepted')return actual.result;}throw error;}
 }
}
