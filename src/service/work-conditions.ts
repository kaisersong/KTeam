import {createHash} from 'node:crypto';
import {constants,openSync,closeSync,fstatSync,readSync,lstatSync,realpathSync} from 'node:fs';
import {resolve,relative,join,sep} from 'node:path';
import {KTeamError,record,fields,text} from '../errors.js';
import {sharedRuntime} from '../runtime/native.js';
import {harnessWorkspace} from '../runtime/harness.js';
import {runtimeIntegrationRevision} from './integration-settings.js';
import {ToolPermissions} from './tool-permissions.js';
import {profile} from './bot-profile.js';
import type {TeamStore} from './team-store.js';
import type {Upstreams} from '../adapters/upstream.js';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const within=(root:string,path:string)=>path===root||path.startsWith(root+sep);
const missing=(error:unknown)=>(error as NodeJS.ErrnoException)?.code==='ENOENT';
/** Bounded observations, under the original read permission contract. No model or timer. */
export class WorkConditions {
 constructor(private upstream:Upstreams,private store:TeamStore){}
 private async fileScope(botId:string,path:string){
  const bot=((await this.upstream.listBots()).agents as any[]).find(bot=>bot.id===botId&&!bot.archivedAt);if(!bot)throw new KTeamError('condition_scope_changed',409);
  const cwd=harnessWorkspace(profile(bot).workspace),binding=this.store.binding(botId);if(!binding||!within(cwd,path)||path===cwd)throw new KTeamError('condition_path_denied',403);
  const core=await sharedRuntime(),rules=core.mergeRules(await core.loadSettings(cwd)),permissions=new core.PermissionManager({mode:'default',cwd,...rules});
  if(await permissions.check('read',{file_path:path})!=='allow'||!core.createSandboxPolicy({pathAllowlist:[cwd],pathDenylist:[this.store.root],network:'deny'}).checkPath(path).allowed)throw new KTeamError('condition_path_denied',403);
  return {cwd,authorization:hash([cwd,rules,new ToolPermissions(this.store).revision({botId,bindingRevision:binding.revision,cwd}),await runtimeIntegrationRevision()])};
 }
 private snapshot(cwd:string,path:string,content:boolean){
  // Canonical workspace is frozen; every existing descendant must remain a real path.
  if(realpathSync(cwd)!==cwd)throw new KTeamError('condition_scope_changed',409);
  const parts=relative(cwd,path).split(sep);let current=cwd;
  for(const part of parts){current=join(current,part);try{if(lstatSync(current).isSymbolicLink())throw new KTeamError('condition_path_denied',403);}catch(error){if(missing(error))return {present:false};throw error;}}
  let fd:number;try{fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);}catch(error){if(missing(error))return {present:false};throw error;}
  try{const stat=fstatSync(fd);if(!stat.isFile()||stat.nlink!==1)throw new KTeamError('condition_file_invalid',409);
   if(realpathSync(path)!==path||!within(cwd,realpathSync(path)))throw new KTeamError('condition_path_denied',403);
   const same=()=>{const current=lstatSync(path);if(current.dev!==stat.dev||current.ino!==stat.ino||current.isSymbolicLink()||realpathSync(path)!==path)throw new KTeamError('condition_file_unstable',503);};same();if(!content)return {present:true,size:stat.size};if(stat.size>1024*1024)throw new KTeamError('condition_file_too_large',409);
   const bytes=Buffer.alloc(1024*1024+1);let count=0;while(count<bytes.length){const read=readSync(fd,bytes,count,bytes.length-count,count);if(!read)break;count+=read;}const after=fstatSync(fd);
   if(count>1024*1024||after.size!==count||stat.mtimeMs!==after.mtimeMs||stat.ctimeMs!==after.ctimeMs||realpathSync(path)!==path)throw new KTeamError('condition_file_unstable',503);
   same();return {present:true,size:count,sha256:createHash('sha256').update(bytes.subarray(0,count)).digest('hex')};
  }finally{closeSync(fd);}
 }
 async capture(job:any,botId:string,value:unknown){
  const input=record(value);fields(input,['kind','path','jobId']);
  if(input.kind==='file_exists'||input.kind==='file_changed'){
   if(input.jobId!==undefined)throw new KTeamError('condition_input_invalid');const bot=((await this.upstream.listBots()).agents as any[]).find(bot=>bot.id===botId),cwd=harnessWorkspace(profile(bot??{}).workspace),path=resolve(cwd,text(input.path,'condition_path',4096)),scope=await this.fileScope(botId,path),baseline=this.snapshot(scope.cwd,path,input.kind==='file_changed');
   return {kind:input.kind,path,...scope,baseline};
  }
  if(input.kind==='work_result'){
   if(input.path!==undefined)throw new KTeamError('condition_input_invalid');const jobId=text(input.jobId,'condition_job_id'),target=this.store.job(jobId);
   if(!target||target.id===job.id||target.roomId!==job.roomId||['followup','assistant-notice'].includes(target.trigger))throw new KTeamError('condition_job_denied',403);
   return {kind:input.kind,jobId,roomId:target.roomId,originId:target.originId,createdAt:target.createdAt};
  }throw new KTeamError('condition_input_invalid');
 }
 async assertScope(op:any){if(!op.condition||op.condition.kind==='work_result')return;const scope=await this.fileScope(op.botId,op.condition.path);if(scope.authorization!==op.condition.authorization||scope.cwd!==op.condition.cwd)throw new KTeamError('condition_scope_changed',409);}
 async observe(job:any,op:any):Promise<{ready:boolean;results?:any[]}>{
  const condition=op.condition;
  if(condition.kind==='work_result'){
   const target=this.store.job(condition.jobId);if(!target||target.roomId!==condition.roomId||target.originId!==condition.originId||target.createdAt!==condition.createdAt)throw new KTeamError('condition_scope_changed',409);
   if(!['delivered','blocked','unknown','stopped','cancelled','noop'].includes(target.state))return {ready:false};
   if(target.state!=='delivered'||target.needsReview)return {ready:true,results:[{state:target.state==='delivered'?'needs_review':target.state,jobId:target.id,reason:target.reason??'work_not_completed'}]};
   const results:any[]=[];if(!target.results?.length)throw new KTeamError('condition_result_invalid',409);
   for(const receipt of target.results){const message=(await this.upstream.conversationMessage(job.roomId,receipt.messageId)).message as any,task=((await this.upstream.aimp(job.roomId,'tasks')).tasks as any[]).find(task=>task.taskRef===receipt.taskRef);
    if(message.sender?.logicalAgentId!==receipt.botId||message.sourceRef?.kind!=='aimp_reply'||message.sourceRef?.taskRef!==receipt.taskRef||!task?.artifactVerification?.verified||!['delivered','accepted'].includes(task.state))throw new KTeamError('condition_result_invalid',409);
    results.push({state:'delivered',jobId:target.id,botId:receipt.botId,roomId:job.roomId,messageId:message.messageId,text:String(message.text).slice(0,12000)});
   }return {ready:true,results};
  }
  const scope=await this.fileScope(op.botId,condition.path);if(scope.authorization!==condition.authorization||scope.cwd!==condition.cwd)throw new KTeamError('condition_scope_changed',409);
  const current=this.snapshot(scope.cwd,condition.path,condition.kind==='file_changed');
  const ready=current.present&&(condition.kind==='file_exists'||(current as any).sha256!==condition.baseline.sha256);
  return {ready,results:ready?[{state:'delivered',condition:condition.kind,path:condition.path,...current,observedAt:Date.now(),meaning:'仅证明本次观察时条件满足；继续执行前仍须按原权限读取当前文件。'}]:undefined};
 }
}
