import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,existsSync,readFileSync,writeFileSync,renameSync,rmSync,realpathSync,lstatSync} from 'node:fs';
import {dirname,join,extname} from 'node:path';
import type {TeamStore} from '../service/team-store.js';
import {KTeamError} from '../errors.js';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fileHash=(path:string)=>{if(!existsSync(path))return null;const stat=lstatSync(path);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>20*1024*1024||realpathSync(path)!==path)throw new KTeamError('artifact_target_invalid',409);return createHash('sha256').update(readFileSync(path)).digest('hex');};
export function validateHtmlCandidate(path:string){const sha256=fileHash(path);if(!sha256)throw new KTeamError('artifact_candidate_missing',409);const bytes=readFileSync(path),html=bytes.toString('utf8');if(bytes.length<32||html.includes('\u0000')||!/<html\b/i.test(html)||!/<\/html\s*>/i.test(html)||!/<body\b/i.test(html)||!/<\/body\s*>/i.test(html))throw new KTeamError('artifact_validation_failed',409);return {validatorId:'kteam-html-structure',validatorVersion:1,sha256,bytes:bytes.length,checks:[{id:'html-document',passed:true},{id:'bounded-regular-file',passed:true}],businessAcceptance:'requires-review' as const};}
/** A typed HTML pilot. This does not wrap arbitrary bash or assert semantic correctness. */
export class ArtifactDelivery {
 constructor(private store:TeamStore,private scope:{jobId:string;roomId:string;botId:string;originId:string;taskRef:string;bindingRevision:number;profileRevision:number},private guard:()=>Promise<void>,private effect:(input:any)=>Promise<any>,private readEffects?:(taskRef:string)=>Promise<any>){}
 private save(row:any,patch:any){return this.store.saveOperation({...row,...patch},row.revision??0);}
 private async settle(row:any){
  if(row.effectSynced)return row;
  const expected={kind:'host-local-html-validation',receipt:row.receipt};
  const observe=async()=>{if(!this.readEffects)return false;const snapshot=await this.readEffects(row.taskRef),actual=snapshot.effects?.find((effect:any)=>effect.effectId===row.effectId);return actual?.state==='completed'&&hash(actual.evidence)===hash(expected);};
  await this.guard();if(await observe())return this.save(row,{effectSynced:true});
  try{await this.effect({taskRef:row.taskRef,effectId:row.effectId,logicalAction:row.logicalAction,externalIdempotencyKey:row.id,clauseVersion:1,state:'completed',evidence:expected});return this.save(row,{effectSynced:true});}
  catch(error){if(await observe())return this.save(row,{effectSynced:true});throw new KTeamError('artifact_effect_receipt_unknown',503);}
 }
 private async reconcileInert(row:any){
  const old=this.store.job(row.jobId);if(row.jobId===this.scope.jobId||!old||!['blocked','unknown','stopped','cancelled'].includes(old.state)||row.botId!==this.scope.botId||row.roomId!==this.scope.roomId||row.originId!==this.scope.originId||row.bindingRevision!==this.scope.bindingRevision||row.profileRevision!==this.scope.profileRevision)return row;
  if(this.store.operationsWithPrefix('harness-process:'+row.jobId+':').some(process=>process.state!=='stopped'||process.stopConfirmed===false))return row;
  await this.guard();const actual=fileHash(row.target);
  if(row.validation&&actual===row.validation.sha256){row=this.save(row,{status:'published',receipt:{...row.validation,ref:row.target,observedAfterRestart:true}});return this.settle(row);}
  if(actual!==row.before||!this.readEffects)return row;
  const proof={kind:'not-applied',target:row.target,before:row.before,oldJobId:row.jobId,hostObservedInert:true};
  const snapshot=await this.readEffects(row.taskRef),effect=snapshot.effects?.find((effect:any)=>effect.effectId===row.effectId);
  if(effect&&effect.state!=='failed')await this.effect({taskRef:row.taskRef,effectId:row.effectId,state:'failed',evidence:proof});
  return this.save(row,{status:'failed',notApplied:proof});
 }
 private async settleFailure(row:any){
  if(!this.readEffects||!row.notApplied)return;
  await this.guard();const snapshot=await this.readEffects(row.taskRef),effect=snapshot.effects?.find((e:any)=>e.effectId===row.effectId);if(!effect||effect.state==='failed')return;if(effect.state==='completed')throw new KTeamError('artifact_effect_conflict',409);
  await this.effect({taskRef:row.taskRef,effectId:row.effectId,state:'failed',evidence:{...row.notApplied,kind:'not-applied'}});
 }
 async render(name:string,args:Record<string,unknown>,execute:(candidateArgs:Record<string,unknown>)=>Promise<any>){
  await this.guard();const target=String(args.output_path),slot=hash([target]),intent=hash([this.scope.originId,this.scope.bindingRevision,this.scope.profileRevision,name,args]);let id='artifact-delivery:'+hash([slot,intent]);
  for(const row of this.store.operationsWithPrefix('artifact-delivery:').filter(row=>row.slot===slot&&['registered','executing','validated','unknown'].includes(row.status)))await this.reconcileInert(row);
  const pending=this.store.operationsWithPrefix('artifact-delivery:').find(row=>row.slot===slot&&['registered','executing','validated','unknown'].includes(row.status));if(pending&&!(pending.intent===intent&&pending.roomId===this.scope.roomId&&pending.botId===this.scope.botId))throw new KTeamError('artifact_prior_outcome_unknown',409);
  const priorFailure=this.store.operationsWithPrefix('artifact-delivery:').find(row=>row.slot===slot&&row.originId===this.scope.originId&&row.status==='failed');
  const attempts=this.store.operationsWithPrefix('artifact-delivery:').filter(row=>row.roomId===this.scope.roomId&&row.botId===this.scope.botId&&row.intent===intent);
  let row=attempts[0];
  if(row){
   if(row.status==='validated'&&row.validation&&fileHash(target)===row.validation.sha256)row=this.save(row,{status:'published',receipt:{...row.validation,ref:target,observedAfterRestart:true}});
   if(row.status==='published'&&fileHash(target)===row.validation?.sha256){await this.settle(row);return row.result;}
   if(row.status!=='failed'||!row.notApplied||fileHash(target)!==row.before||attempts.length>=3)throw new KTeamError('artifact_prior_outcome_unknown',409);
   await this.settleFailure(row);id+=':repair:'+attempts.length;
  }
  const effectId='effect_'+hash([id,intent]),logicalAction='html:'+hash([intent,id]);
  const parent=dirname(target);if(extname(target).toLowerCase()!=='.html'||realpathSync(parent)!==parent)throw new KTeamError('artifact_target_invalid',409);
  const before=fileHash(target),candidateDir=mkdtempSync(join(parent,'.kteam-candidate-')),candidate=join(candidateDir,'candidate.html');
  const contract={kind:'host-local-html-v1',sourceMessageId:this.scope.originId,target,checks:['html-document','bounded-regular-file'],subjective:'requires-review'};
  row=this.store.saveOperation({id,...this.scope,slot,intent,effectId,logicalAction,target,candidate,status:'registered',before,repairOf:priorFailure?.notApplied?priorFailure.id:undefined,contractDigest:hash(contract),contract,createdAt:Date.now()},0);
  let entered=false,registered=false,published=false;
  const update=async(state:string,evidence?:any)=>this.effect({effectId,logicalAction,externalIdempotencyKey:id,clauseVersion:1,state,evidence});
  try{
   await update('registered');registered=true;await this.guard();await update('executing');row=this.save(row,{status:'executing'});entered=true;
   const result=await execute({...args,output_path:candidate});let parsed:any;try{parsed=JSON.parse(String(result));}catch{throw new KTeamError('artifact_renderer_response_invalid',409);}if(parsed.success!==true)throw new KTeamError('artifact_render_failed',409);
   const validation=validateHtmlCandidate(candidate);await this.guard();row=this.save(row,{status:'validated',validation:{...validation,contractDigest:row.contractDigest,bindingRevision:this.scope.bindingRevision,profileRevision:this.scope.profileRevision,sourceMessageId:this.scope.originId},result:JSON.stringify(parsed).split(candidate).join(target)});
   if(fileHash(target)!==before)throw new KTeamError('artifact_target_changed',409);
   // Preserve old bytes for this published version. No receipt is inferred from an LLM assertion.
   if(before){const archive=join(this.store.root,'artifact-versions');mkdirSync(archive,{recursive:true,mode:0o700});const old=join(archive,before+'.html');if(!existsSync(old))writeFileSync(old,readFileSync(target),{flag:'wx',mode:0o600});}
   await this.guard();if(fileHash(target)!==before)throw new KTeamError('artifact_target_changed',409);renameSync(candidate,target);published=true;
   if(fileHash(target)!==validation.sha256)throw new KTeamError('artifact_published_changed',409);
   const encoded=JSON.stringify(parsed).split(candidate).join(target),receipt={...row.validation,ref:target,publishedAt:Date.now()};row=this.save(row,{status:'published',receipt,result:encoded});row=await this.settle(row);rmSync(candidateDir,{recursive:true,force:true});return encoded;
  }catch(error){
   if(published||row.status==='published')throw error;
   const notApplied=!published&&fileHash(target)===before;row=this.save(row,{status:notApplied?'failed':'unknown',failure:error instanceof KTeamError?error.code:'artifact_render_failed',notApplied:notApplied?{kind:'target-unchanged',before,target}:undefined});
   if(entered||registered)await update(notApplied?'failed':'unknown',notApplied?{kind:'not-applied',target,before}:undefined).catch(()=>{});
   // Retain uncertain candidates for review. Never retry a renderer because it threw.
   if(notApplied)rmSync(candidateDir,{recursive:true,force:true});throw error;
  }
 }
 assertPublishable(){const rows=this.store.operationsWithPrefix('artifact-delivery:').filter(row=>row.roomId===this.scope.roomId&&row.originId===this.scope.originId&&row.botId===this.scope.botId);const seen=new Set<string>();for(const row of rows){if(seen.has(row.slot))continue;seen.add(row.slot);if(row.status!=='published'||!row.effectSynced||!row.receipt||fileHash(row.target)!==row.receipt.sha256)throw new KTeamError('artifact_delivery_not_verified',409);}}
}
