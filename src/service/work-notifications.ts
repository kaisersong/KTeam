import {createHash,randomUUID} from 'node:crypto';
import {KTeamError,record,fields,text} from '../errors.js';
import type {Upstreams} from '../adapters/upstream.js';
import type {TeamStore} from './team-store.js';
import type {TeamCoordinator} from './coordination.js';
import {defaultNotificationPreferences,notificationQuiet,type NotificationPreferences,type NotificationNavigation} from '../protocol/notification-preferences.js';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const booleans=['enabled','completed','blocked','input','sound','showPreview','quiet'] as const;
function validate(value:any){
 if(booleans.some(key=>typeof value[key]!=='boolean')||!value.quietHours||typeof value.quietHours.enabled!=='boolean'||![value.quietHours.start,value.quietHours.end].every(time=>typeof time==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(time))||value.quietHours.start===value.quietHours.end||typeof value.quietHours.timeZone!=='string'||value.quietHours.timeZone.length>128)throw new KTeamError('notification_settings_invalid');
 try{new Intl.DateTimeFormat('en',{timeZone:value.quietHours.timeZone}).format();}catch{throw new KTeamError('notification_settings_invalid');}return value as NotificationPreferences;
}
export function notificationPreferences(store:TeamStore){return validate(store.state('desktop-notification-preferences')??defaultNotificationPreferences());}
export function saveNotificationPreferences(store:TeamStore,value:unknown){const input=record(value);fields(input,['expectedRevision',...booleans,'quietHours']);const current=notificationPreferences(store);if(input.expectedRevision!==current.revision)throw new KTeamError('notification_settings_changed',409);if(input.quietHours!==undefined)fields(record(input.quietHours),['enabled','start','end','timeZone']);const {expectedRevision,...patch}=input,next=validate({...current,...patch,quietHours:{...current.quietHours,...(input.quietHours as any??{})},revision:current.revision+1});store.setState('desktop-notification-preferences',next);return {ok:true,preferences:next};}
interface Fact {key:string;kind:'question'|'approval'|'completed'|'blocked';roomId:string;sourceRoomId:string;botId:string;jobId:string;messageId?:string;taskRef?:string;referenceId?:string;version:string;at:number;expiresAt:number;summary?:string}
/** Delivery metadata over original jobs/questions/messages. No task owner, model, or timer. */
export class WorkNotifications {
 constructor(private upstream:Upstreams,private store:TeamStore,private coordinator:TeamCoordinator,private questions:()=>any[],private approvals:()=>any[],private guardJob:(job:any)=>Promise<void>,private now=Date.now){}
 private ledgerId(key:string){return 'desktop-notification:'+hash(key);}
 private facts():Fact[]{
  const facts:Fact[]=[];
  for(const question of this.questions()){const operation=this.store.operation(question.id);if(question.expiresAt<=this.now()||!operation||operation.status!=='pending')continue;facts.push({key:'question:'+question.id,kind:'question',roomId:question.roomId,sourceRoomId:question.sourceRoomId,botId:question.botId,jobId:question.jobId,messageId:question.messageId,referenceId:question.id,version:String(operation.revision),at:operation.createdAt??question.expiresAt-600000,expiresAt:question.expiresAt,summary:question.question});}
  for(const approval of this.approvals()){if(approval.expiresAt<=this.now())continue;facts.push({key:'approval:'+approval.id,kind:'approval',roomId:approval.roomId,sourceRoomId:approval.sourceRoomId,botId:approval.botId,jobId:approval.jobId,referenceId:approval.id,version:approval.hash,at:approval.expiresAt-120000,expiresAt:approval.expiresAt,summary:approval.toolName});}
  for(const job of this.store.jobs()){if(job.trigger==='peer'||this.store.settings(job.roomId)?.kind==='peer')continue;const at=Date.parse(job.finishedAt??job.failure?.at??job.recoveredAt??'');if(!Number.isFinite(at)||this.now()-at>86400000||at>this.now()+60000)continue;
   const last=job.results?.at(-1);if(job.state==='delivered'&&!job.needsReview&&last)facts.push({key:'completed:'+job.id+':'+last.messageId,kind:'completed',roomId:job.roomId,sourceRoomId:job.roomId,botId:last.botId,jobId:job.id,messageId:last.messageId,taskRef:last.taskRef,version:last.messageId,at,expiresAt:at+86400000});
   else if(['blocked','unknown'].includes(job.state)||job.needsReview)facts.push({key:'blocked:'+job.id,kind:'blocked',roomId:job.roomId,sourceRoomId:job.roomId,botId:job.activeBotId??job.members?.[0]??'',jobId:job.id,version:hash([job.state,job.reason,job.failure?.at]),at,expiresAt:at+86400000});
  }return facts.sort((a,b)=>Number(b.kind==='question'||b.kind==='approval')-Number(a.kind==='question'||a.kind==='approval')||a.at-b.at).slice(0,200);
 }
 private eligible(fact:Fact,preferences:NotificationPreferences){return preferences.enabled&&!notificationQuiet(preferences,this.now())&&(fact.kind==='completed'?preferences.completed:fact.kind==='blocked'?preferences.blocked:preferences.input)&&fact.expiresAt>this.now()&&!this.store.settings(fact.sourceRoomId)?.quiet&&!this.store.settings(fact.roomId)?.quiet;}
 private async assertFact(fact:Fact,forDelivery=true){
  const job=this.store.job(fact.jobId);if(!job||(['question','approval'].includes(fact.kind)&&!['running','routing'].includes(job.state)))throw new KTeamError('notification_source_changed',409);
  await this.guardJob(job);await this.coordinator.guardConversation(fact.sourceRoomId);if(fact.roomId!==fact.sourceRoomId)await this.coordinator.guardConversation(fact.roomId);
  const scope=await this.upstream.membership(fact.roomId);if((scope.room as any).status!=='active'||!(scope.members as any[]).some(member=>member.status==='active'&&member.subject?.kind==='user'&&member.subject.userId==='user.local'))throw new KTeamError('notification_source_changed',409);
  let message:any;if(fact.messageId){message=(await this.upstream.conversationMessage(fact.roomId,fact.messageId)).message;if(message.sender?.logicalAgentId!==fact.botId)throw new KTeamError('notification_source_changed',409);}
  if(fact.taskRef){const task=((await this.upstream.aimp(fact.roomId,'tasks')).tasks as any[]).find(task=>task.taskRef===fact.taskRef);if(!task?.artifactVerification?.verified||!['delivered','accepted'].includes(task.state)||message.sourceRef?.taskRef!==fact.taskRef)throw new KTeamError('notification_source_changed',409);if(forDelivery&&this.store.seen(fact.roomId).includes(message.roomSequence))throw new KTeamError('notification_already_read',409);}
  if(this.facts().find(item=>item.key===fact.key)?.version!==fact.version)throw new KTeamError('notification_source_changed',409);
  return {title:String((scope.room as any).title).slice(0,120),message};
 }
 settings(){const receipts=this.store.notificationAttempts().map(row=>({id:row.id,status:row.status==='claimed'&&row.claimedAt+30000<this.now()?'unknown':row.status,recordedStatus:row.status,kind:row.kind,at:row.issuedAt??row.claimedAt}));return {ok:true,preferences:notificationPreferences(this.store),receipts};}
 async pending(){
  const preferences=notificationPreferences(this.store);if(!preferences.enabled||notificationQuiet(preferences,this.now()))return {ok:true,preferences,items:[],deferred:true};const items:any[]=[];let unavailable=0;
  for(const fact of this.facts()){if(items.length>=20)break;if(!this.eligible(fact,preferences)||this.store.operation(this.ledgerId(fact.key)))continue;try{await this.assertFact(fact);items.push({key:fact.key,version:fact.version,settingsRevision:preferences.revision});}catch(error){if(!(error instanceof KTeamError)||![403,404,409].includes(error.status))unavailable++;}}
  return {ok:true,preferences,items,unavailable};
 }
 async claim(value:unknown){
  const input=record(value);fields(input,['key','version','settingsRevision']);const key=text(input.key,'notification_key',512),fact=this.facts().find(fact=>fact.key===key),preferences=notificationPreferences(this.store);
  if(!fact||fact.version!==input.version||preferences.revision!==input.settingsRevision||!this.eligible(fact,preferences))throw new KTeamError('notification_source_changed',409);
  const scope=await this.assertFact(fact),id=this.ledgerId(key);if(this.store.operation(id))return {ok:true,claimed:false};
  const token=randomUUID();this.store.transaction(()=>{if(notificationPreferences(this.store).revision!==preferences.revision||this.store.operation(id))throw new KTeamError('notification_source_changed',409);if(this.store.notificationAttemptCount(this.now()-60000)>=3)throw new KTeamError('notification_rate_limited',429);this.store.saveOperation({id,key,kind:fact.kind,status:'claimed',token,version:fact.version,claimedAt:this.now()},0);});
  const generic={question:'有一条问题需要你回复',approval:'有一项工具操作需要你批准',completed:'成员已提交答复，等待你核对',blocked:'工作有未完成或结果待核对的事项'};
  return {ok:true,claimed:true,id,token,title:scope.title,body:preferences.showPreview?(fact.summary??scope.message?.text??generic[fact.kind]).slice(0,180):generic[fact.kind],silent:!preferences.sound};
 }
 test(){const preferences=notificationPreferences(this.store);if(!preferences.enabled||notificationQuiet(preferences,this.now()))throw new KTeamError('notification_quiet',409);if(this.store.notificationAttemptCount(this.now()-60000,'test')>0)throw new KTeamError('notification_rate_limited',429);const key='test:'+randomUUID(),id=this.ledgerId(key),token=randomUUID();this.store.saveOperation({id,key,kind:'test',status:'claimed',token,version:'test',claimedAt:this.now()},0);return {ok:true,claimed:true,id,token,title:'KTeam 通知测试',body:'这是一条测试通知，不涉及工作、批准或消息已读。',silent:!preferences.sound};}
 acknowledge(value:unknown){const input=record(value);fields(input,['id','token','status']);const id=text(input.id,'notification_id'),row=this.store.operation(id);if(!row||!id.startsWith('desktop-notification:')||row.token!==input.token||!['issued','failed','unknown','skipped'].includes(String(input.status)))throw new KTeamError('notification_receipt_changed',409);if(row.status===input.status||input.status==='unknown'&&['issued','failed','skipped'].includes(row.status))return {ok:true,reused:true};this.store.saveOperation({...row,status:input.status,...(input.status==='issued'?{issuedAt:this.now()}:{})},row.revision);return {ok:true};}
 async locate(value:unknown):Promise<{ok:true;navigation:NotificationNavigation}>{const input=record(value);fields(input,['id']);const row=this.store.operation(text(input.id,'notification_id'));if(!row||!row.id.startsWith('desktop-notification:'))throw new KTeamError('notification_source_changed',409);if(row.kind==='test'&&row.claimedAt+86400000>this.now())return {ok:true,navigation:{settings:'notifications'}};const fact=this.facts().find(fact=>fact.key===row.key);if(!fact||fact.version!==row.version)throw new KTeamError('notification_source_changed',409);await this.assertFact(fact,false);return {ok:true,navigation:{roomId:fact.roomId,messageId:fact.messageId,jobId:fact.jobId,...(fact.kind==='question'?{questionId:fact.referenceId}:fact.kind==='approval'?{approvalId:fact.referenceId}:{})}};}
}
