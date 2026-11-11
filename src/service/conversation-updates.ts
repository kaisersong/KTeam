import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {KTeamError,record,fields,text} from '../errors.js';
import type {Upstreams} from '../adapters/upstream.js';
import type {TeamStore} from './team-store.js';
import type {TeamAutomation} from './automation.js';
import type {TeamCoordinator} from './coordination.js';
import type {ToolApprovals} from './tool-approvals.js';
import type {AgentLinks} from './agent-links.js';
import type {WorkRecovery} from './work-recovery.js';
import type {TeamRoles} from './team-roles.js';
import {ConversationService} from './conversation.js';
import {conversationPage} from './conversation-pages.js';
import {sharedRuntime} from '../runtime/native.js';
import {projectWork} from './work-projection.js';

const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function sequence(value:unknown):number {
 if(!Number.isSafeInteger(value)||Number(value)<0)throw new KTeamError('conversation_cursor_invalid');
 return Number(value);
}
type Cursor={v:1;room:string;epoch:string;seq:number;work:number;shared:string;settings:string;global:number;tasksAt:number};
type Cached={at:number;data?:any;tasks?:any;tasksAt:number};
/** Signed read positions over the original owners. This is not an execution event log. */
export class ConversationUpdates {
 private key=randomBytes(32);
 private cache=new Map<string,Cached>();
 constructor(
  private upstream:Upstreams,private store:TeamStore,private conversations:ConversationService,
  private automation:TeamAutomation,private coordinator:TeamCoordinator,private approvals:ToolApprovals,
  private links:AgentLinks,private recovery:WorkRecovery,private roles:TeamRoles,private epoch:string,
 ){}
 private cursor(value:unknown,roomId:string):Cursor|undefined {
  if(typeof value!=='string'||value.length>2048)return;
  try {
   const [encoded,signature,...rest]=value.split('.');
   if(!encoded||!signature||rest.length||!/^[a-f0-9]{64}$/.test(signature))return;
   const bytes=Buffer.from(encoded,'base64url'),expected=createHmac('sha256',this.key).update(bytes).digest();
   if(!timingSafeEqual(expected,Buffer.from(signature,'hex')))return;
   const result=JSON.parse(bytes.toString('utf8'));
   if(result.room!==roomId)throw new KTeamError('conversation_cursor_scope',403);
   if(result.v!==1||result.epoch!==this.epoch)return;
   for(const key of ['seq','work','global','tasksAt'])sequence(result[key]);
   if(typeof result.shared!=='string'||typeof result.settings!=='string')return;
   return result;
  }catch(error){if(error instanceof KTeamError&&error.code==='conversation_cursor_scope')throw error;return;}
 }
 private seal(value:Cursor){
  const bytes=Buffer.from(JSON.stringify(value));
  return bytes.toString('base64url')+'.'+createHmac('sha256',this.key).update(bytes).digest('hex');
 }
 private entry(roomId:string):Cached {
  const found=this.cache.get(roomId);
  if(found){this.cache.delete(roomId);this.cache.set(roomId,found);return found;}
  while(this.cache.size>=8)this.cache.delete(this.cache.keys().next().value!);
  const value={at:0,tasksAt:0};this.cache.set(roomId,value);return value;
 }
 private shared(data:any,ids:Set<string>){
  const states=(data.messageState??[]).filter((state:any)=>ids.has(state.messageId)||state.pinned);
  return {shared:data.shared,library:data.library,messageState:states.slice(0,350),messageStateLimited:states.length>350,historyAvailable:!!data.history?.length};
 }
 private async sameScope(roomId:string,before:any){
  const after=await this.conversations.scope(roomId);
  if(digest({room:after.room,members:after.members})!==digest({room:before.room,members:before.members}))throw new KTeamError('team_scope_changed',409);
  return after;
 }
 async read(value:unknown){
  const input=record(value);
  fields(input,['roomId','cursor','resumeAfter','tail','messageIds','sequences','force']);
  const roomId=text(input.roomId,'room_id'),scope=await this.conversations.scope(roomId);
  if(input.cursor!==undefined&&(typeof input.cursor!=='string'||input.cursor.length>2048)
   ||input.tail!==undefined&&typeof input.tail!=='boolean'||input.force!==undefined&&typeof input.force!=='boolean'
   ||input.messageIds!==undefined&&(!Array.isArray(input.messageIds)||input.messageIds.length>300||input.messageIds.some(id=>typeof id!=='string'||id.length>256))
   ||input.sequences!==undefined&&(!Array.isArray(input.sequences)||input.sequences.length>300||input.sequences.some(n=>!Number.isSafeInteger(n)||Number(n)<1)))throw new KTeamError('conversation_cursor_invalid');
  const ids=new Set<string>((input.messageIds as string[]|undefined)??[]),sequences=new Set<number>((input.sequences as number[]|undefined)??[]);
  const prior=this.cursor(input.cursor,roomId),resume=input.resumeAfter===undefined?0:sequence(input.resumeAfter),reset=!prior;
  let after=prior?.seq??resume;
  // An untrusted persisted offset past the real head cannot hide the original history.
  if(reset&&resume>0&&!input.tail){const head=await conversationPage(this.upstream,roomId,{tail:true,limit:1});if(resume>Number(head.toSequence??0))after=0;}
  const messages=await conversationPage(this.upstream,roomId,{after,tail:!!input.tail||reset&&after===0,limit:50});
  for(const message of messages.messages){ids.add(message.messageId);sequences.add(message.roomSequence);}
  const observed=Math.max(after,messages.toSequence??0),version=this.store.viewRevision(roomId),global=this.store.viewRevision(),cache=this.entry(roomId),now=Date.now(),errors:{section:string;code:string}[]=[];
  let work:any,shared:any,settings:any,roles:any,proposals:any,workVersion=prior?.work??0,taskStamp=prior?.tasksAt??0;
  const needWork=input.force||reset||prior?.work!==version||now-cache.tasksAt>=4000||messages.messages.length>0;
  const needShared=input.force||reset||now-cache.at>=4000||messages.messages.length>0;
  const [taskRead,sharedRead]=await Promise.allSettled([
   needWork?this.upstream.aimp(roomId,'tasks'):Promise.resolve(cache.tasks),
   needShared?this.upstream.conversationData(roomId):Promise.resolve(cache.data),
  ]);
  if(needWork){
   if(taskRead!.status==='fulfilled'&&taskRead!.value){
    const snapshot=taskRead!.value;
    // Concurrent old reads may be returned to their caller, but cannot regress the shared cache.
    if(now>=cache.tasksAt){cache.tasks=snapshot;cache.tasksAt=now;}
    const page=this.store.workPage(roomId),active=this.store.workPage(roomId,undefined,true);
    const jobs=[...new Map([...active.jobs,...page.jobs].map(job=>[job.id,job])).values()].sort((a,b)=>String(b.createdAt??'').localeCompare(String(a.createdAt??'')));
    const wanted=new Set(jobs.map(job=>job.task?.taskRef));
    const tasks=(snapshot.tasks??[]).filter((task:any)=>wanted.has(task.taskRef)||!['accepted','halted','cancelled'].includes(task.state)).slice(-50).map((task:any)=>({taskRef:task.taskRef,threadId:task.threadId,state:task.state,revision:task.revision,headId:task.headId,headHash:task.headHash,terms:{description:String(task.terms?.description??'').slice(0,1024)}}));
    work={ok:true,jobs,tasks,recordCursor:page.nextBefore,activeLimited:active.nextBefore!==undefined,tasksLimited:(snapshot.tasks??[]).length>tasks.length,
     workingBotIds:this.store.workingBotIds(),questions:this.automation.privateChats?.questions(roomId)??[],approvals:this.approvals.list(roomId),connection:this.links.forRoom(roomId),
     recovery:jobs.some(job=>['unknown','blocked','stopped'].includes(job.state))?this.recovery.view(roomId,snapshot.tasks??[]):undefined,
     pendingSubmissions:this.store.pendingSubmissions(roomId),inputReceipts:this.automation.inputs?.receipts(roomId)??[],
     inputCapabilities:jobs.filter(job=>['routing','running','waiting'].includes(job.state)).map(job=>this.automation.inputs?.capability(job))};
    workVersion=version;taskStamp=now;proposals=this.coordinator.proposals(roomId);
    if(this.store.settings(roomId)?.kind==='group'){
     try{roles=(await this.roles.view(roomId)).roles;}catch(error){errors.push({section:'roles',code:error instanceof KTeamError?error.code:'team_roles_unavailable'});}
    }
   }else errors.push({section:'work',code:taskRead!.status==='rejected'&&taskRead!.reason instanceof KTeamError?taskRead!.reason.code:'conversation_work_unavailable'});
  }
  let sharedHash=prior?.shared??'';
  if(sharedRead!.status==='fulfilled'&&sharedRead!.value){
   const data=sharedRead!.value;
   if(needShared&&now>=cache.at){cache.data=data;cache.at=now;}
   const projection=this.shared(data,ids),hash=digest(projection);
   if(reset||input.force||hash!==sharedHash){shared=projection;sharedHash=hash;}
  }else errors.push({section:'shared',code:sharedRead!.status==='rejected'&&sharedRead!.reason instanceof KTeamError?sharedRead!.reason.code:'conversation_shared_unavailable'});
  const current=await this.sameScope(roomId,scope);
  const view={settings:this.store.settings(roomId),seen:this.store.seenWithin(roomId,[...sequences]),members:current.members},settingsHash=digest(view);
  if(reset||input.force||settingsHash!==prior?.settings)settings=view;
  const cursor=this.seal({v:1,room:roomId,epoch:this.epoch,seq:observed,work:workVersion,shared:sharedHash,settings:settingsHash,global,tasksAt:taskStamp});
  const response={ok:true,roomId,cursor,previousCursor:input.cursor??null,reset,messages,work,shared,settings,roles,proposals,errors,globalChanged:reset||global!==prior?.global};
  if(Buffer.byteLength(JSON.stringify(response))>1750*1024)throw new KTeamError('conversation_projection_too_large',413);
  return response;
 }
 async history(value:unknown){
  const input=record(value);fields(input,['roomId','after','before','tail']);
  if(input.tail!==undefined&&typeof input.tail!=='boolean')throw new KTeamError('conversation_cursor_invalid');
  const roomId=text(input.roomId,'room_id'),scope=await this.conversations.scope(roomId);
  const result=await conversationPage(this.upstream,roomId,{after:input.after===undefined?0:sequence(input.after),before:input.before===undefined?undefined:sequence(input.before),tail:input.tail===true,limit:50});
  await this.sameScope(roomId,scope);return result;
 }
 async records(value:unknown){
  const input=record(value);fields(input,['roomId','before']);
  const roomId=text(input.roomId,'room_id'),scope=await this.conversations.scope(roomId);
  const page=this.store.workPage(roomId,input.before===undefined?undefined:sequence(input.before));
  await this.sameScope(roomId,scope);return {ok:true,...page};
 }
 async detail(value:unknown){
  const input=record(value);fields(input,['roomId','jobId','messageId','eventId']);
  const roomId=text(input.roomId,'room_id'),scope=await this.conversations.scope(roomId);
  const job=input.jobId===undefined?this.store.jobForMessage(roomId,text(input.messageId,'message_id')):this.store.job(text(input.jobId,'job_id'));
  if(!job||job.roomId!==roomId)throw new KTeamError('work_record_not_found',404);
  const version=this.store.workRecordVersion(job.id);
  const core=await sharedRuntime(),event=input.eventId===undefined?undefined:(job.toolTrace??[]).find((event:any)=>event.id===text(input.eventId,'event_id'));
  if(input.eventId!==undefined&&!event)throw new KTeamError('work_event_not_recorded',404);
  let budget=512*1024,truncated=false;
  const bounded=(value:any,depth=0):any=>{
   if(budget<=0||depth>10){truncated=true;return '[记录预览已截断]';}
   if(typeof value==='string'){
    const safe=core.redactSecrets(value).text,limit=Math.max(0,Math.min(16384,Math.floor(budget/3)));
    if(safe.length>limit)truncated=true;
    const result=safe.slice(0,limit);budget-=Buffer.byteLength(result);return result;
   }
   if(Array.isArray(value)){if(value.length>100)truncated=true;return value.slice(0,100).map(item=>bounded(item,depth+1));}
   if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).slice(0,100).map(([key,value])=>[key,bounded(value,depth+1)]));
   return value;
  };
  // Select display fields before redaction; never send the entire internal job or harness configuration.
  const result=bounded(event??{...projectWork(job,this.store.workRecordVersion(job.id)),toolTrace:job.toolTrace??[],answerDraft:job.answerDraft,cards:job.cards??[],harness:job.harness?{toolNames:job.harness.toolNames,memoryBackend:job.harness.memoryBackend}:undefined});
  await this.sameScope(roomId,scope);
  if(this.store.workRecordVersion(job.id)!==version)throw new KTeamError('work_record_changed',409);
  return {ok:true,jobId:job.id,viewRevision:version,...(event?{event:result}:{job:result}),previewTruncated:truncated};
 }
}
