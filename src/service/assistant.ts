import {calendarWindow} from '../runtime/calendar.js';
import type {systemOneChoice} from '../runtime/decision.js';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {existsSync} from 'node:fs';

import type {Upstreams} from '../adapters/upstream.js';
import {KTeamError,record,fields,text} from '../errors.js';
import {sharedRuntime,nativeTurn} from '../runtime/native.js';
import type {LocalAgents} from './local-agents.js';
import {profile} from './bot-profile.js';
import type {TeamStore} from './team-store.js';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const activeStates=new Set(['routing','running','stopping']);
/** Read projection over canonical Rooms/tasks. It never owns rosters or starts group work. */
export class TeamAssistant {
 private inbox:any;private inboxStore:any;private timer?:NodeJS.Timeout;private scanning?:Promise<void>;private closed=false;private controller=new AbortController();
 constructor(private upstream:Upstreams,private store:TeamStore,private turn:typeof nativeTurn=nativeTurn,private localAgents?:LocalAgents,private choose?:typeof systemOneChoice){}
 identity(){return this.store.operation('assistant:'+this.store.installationId())?.receipt as {botId:string;roomId:string}|undefined;}
 enabled(){return this.store.state<any>('assistant-proactivity')?.enabled!==false;}
 state(){return {enabled:this.enabled(),health:this.store.state('assistant-scan-health'),decisionModel:this.store.state('assistant-decision-model')};}
 private async attentionStore(){if(!this.inboxStore&&existsSync(join(this.store.root,'assistant-attention.sqlite'))){const core=await sharedRuntime();this.inboxStore??=new core.AssistantInboxStore(join(this.store.root,'assistant-attention.sqlite'));}return this.inboxStore;}
 private validAttention(item:any){return item?.source==='internal'&&item.accountKey===this.store.installationId()&&typeof item.locator?.roomId==='string';}
 async workbench(){
  const source=await this.attentionStore(),snapshot=source?.snapshot(Date.now())??{items:[],coverage:[]},items=snapshot.items.filter((item:any)=>this.validAttention(item)),outbox=this.store.pendingSubmissionFacts(),roomIds=[...new Set<string>([...items.map((item:any)=>item.locator.roomId),...outbox.map(item=>item.roomId)])].slice(0,64),scopes=new Map<string,any>(),coverage:any[]=[];
  for(let start=0;start<roomIds.length;start+=4)await Promise.all(roomIds.slice(start,start+4).map(async roomId=>{try{scopes.set(roomId,await this.userRoomScope(roomId));}catch(error){coverage.push({key:hash(roomId),state:'unavailable',code:error instanceof KTeamError&&[403,404].includes(error.status)?'source_no_longer_accessible':'source_read_failed'});}}));
  const projected=items.flatMap((item:any)=>{const scope=scopes.get(item.locator.roomId);if(!scope||!['group',undefined].includes(this.store.settings(item.locator.roomId)?.kind))return [];return [{id:item.id,revision:item.revision,priority:item.priority,status:item.status,title:item.title,reason:item.reason,nextStep:item.nextStep,observedAt:item.observedAt,updatedAt:item.updatedAt,sourceRoomId:item.locator.roomId,sourceTitle:scope.room.title,sourceChanged:String(scope.room.revision)!==item.locator.roomRevision,hasMessage:!!item.locator.messageId}];});
  for(const item of outbox){const scope=scopes.get(item.roomId);if(!scope)continue;projected.unshift({kind:'pending-send',id:'outbox:'+item.id,revision:0,intentHash:item.intentHash,priority:'now',status:'unknown',title:'消息发送结果待核对',reason:'这条消息的送达结果尚未确认，不会重新发送旧消息。',nextStep:'打开原会话，核对消息与发送状态。',observedAt:Date.parse(item.timestamp??'')||null,sourceRoomId:item.roomId,sourceTitle:scope.room.title,sourceChanged:false,hasMessage:false});}
  return {ok:true,...this.state(),configured:!!this.identity(),checkedAt:Date.now(),items:projected,coverage:[...snapshot.coverage.map(({state,code,checkedAt}:any)=>({state,code,checkedAt})),...coverage],limited:items.length+outbox.length>projected.length||snapshot.items.length>=200||outbox.length>=100,hiddenSources:coverage.filter(item=>item.code==='source_no_longer_accessible').length};
 }
 async locateAttention(value:unknown){
  const input=record(value);fields(input,['id','expectedRevision','expectedHash']);const id=text(input.id,'attention_id');if(id.startsWith('outbox:')){if(input.expectedRevision!==0)throw new KTeamError('attention_changed',409);const pending=this.store.pendingSubmissionFacts().find(item=>'outbox:'+item.id===id);if(!pending||pending.intentHash!==input.expectedHash)throw new KTeamError('attention_changed',409);await this.userRoomScope(pending.roomId);if(!this.store.pendingSubmissions().some(item=>item.id===pending.id&&item.intentHash===pending.intentHash))throw new KTeamError('attention_changed',409);return {ok:true,roomId:pending.roomId};}if(input.expectedHash!==undefined)throw new KTeamError('unknown_field');if(!Number.isSafeInteger(input.expectedRevision))throw new KTeamError('attention_changed',409);const source=await this.attentionStore(),item=source?.get(id);
  if(!this.validAttention(item)||item.revision!==input.expectedRevision||['hidden','resolved'].includes(item.status))throw new KTeamError('attention_changed',409);
  const roomId=item.locator.roomId;await this.groupScope(roomId);const message=item.locator.messageId?(await this.upstream.conversationMessage(roomId,item.locator.messageId)).message:undefined;await this.groupScope(roomId);
  if(source.get(id)?.revision!==input.expectedRevision)throw new KTeamError('attention_changed',409);return {ok:true,roomId,message};
 }
 setEnabled(enabled:boolean){this.store.setState('assistant-proactivity',{enabled});if(enabled)void this.scan();return this.state();}
 private async authorize(botId:string,roomId:string){if(this.identity()?.botId!==botId||this.store.settings(roomId)?.kind!=='assistant')throw new KTeamError('assistant_scope_required',403);const m=await this.upstream.membership(roomId);if(!(m.members as any[]).some(v=>v.status==='active'&&v.subject?.kind==='user'&&v.subject.userId==='user.local')||!(m.members as any[]).some(v=>v.status==='active'&&v.subject?.logicalAgentId===botId))throw new KTeamError('assistant_scope_required',403);}
 private async groupScope(roomId:string){
  if(this.store.settings(roomId)&&this.store.settings(roomId)?.kind!=='group'&&this.store.settings(roomId)?.kind!==undefined)throw new KTeamError('assistant_team_forbidden',403);
  return this.userRoomScope(roomId);
 }
 private async userRoomScope(roomId:string){
  const snapshot=await this.upstream.membership(roomId),room=snapshot.room as any;
  if(room?.status!=='active'||!(snapshot.members as any[]).some(v=>v.status==='active'&&v.subject?.kind==='user'&&v.subject.userId==='user.local'))throw new KTeamError('assistant_team_forbidden',403);
  return snapshot;
 }
 async validateSources(groups:any[]){for(const group of groups){const current=await this.groupScope(group.roomId);if((current.room as any).revision!==group.roomRevision)throw new KTeamError('assistant_team_changed',409);}}
 async team(roomId:string){
  const scope=await this.groupScope(roomId);
  const [transcript,conversation,taskData]=await Promise.all([this.upstream.messages(roomId,0,12,undefined,true),this.upstream.conversationData(roomId),this.upstream.aimp(roomId,'tasks')]);
  const jobs=this.store.jobs(roomId),taskRows=(taskData.tasks as any[]??[]),live=jobs.filter(j=>activeStates.has(j.state));
  const waiting=[...this.store.operationsWithPrefix('bot-question:'),...this.store.operationsWithPrefix('tool-approval:')].filter(op=>op.status==='pending'&&(op.sourceRoomId??op.roomId)===roomId).map(op=>({id:op.id,botId:op.botId,question:op.question,toolName:op.toolName,privateRoomId:op.displayRoomId??op.roomId}));
  const value={roomId,title:(scope.room as any).title,roomRevision:(scope.room as any).revision,checkedAt:new Date().toISOString(),paused:this.store.settings(roomId)?.paused===true,
   members:(scope.members as any[]).filter(m=>m.status==='active'&&m.subject?.kind==='agent').map(m=>m.subject.logicalAgentId),
   waitingForUser:waiting,execution:waiting.length?'needs_input':live.length?'running':jobs[0]?.state??'no_run',activeBotIds:live.map(j=>j.activeBotId).filter(Boolean),
   tasks:taskRows.slice(-12).map(t=>({id:t.taskRef,state:t.state,description:t.terms?.description,assignee:t.terms?.assignee})),
   shared:conversation.shared,
   latestMessages:(transcript.messages as any[]??[]).slice(-8).map(m=>({messageId:m.messageId,sequence:m.roomSequence,sender:m.sender,text:String(m.text??'').slice(0,1800),createdAt:m.createdAt})),
   latestRun:jobs[0]?{id:jobs[0].id,state:jobs[0].state,reason:jobs[0].reason,finishedAt:jobs[0].finishedAt}:null};
  await this.validateSources([value]);return value;
 }
 async snapshot(botId:string,roomId:string,offset=0){
  await this.authorize(botId,roomId);
  const rooms=(await this.upstream.listTeams()).rooms as any[],groups:any[]=[],coverage:any[]=[];
  const owned=rooms.filter(r=>r.status==='active'&&(this.store.settings(r.roomId)?.kind??'group')==='group');
  for(const room of owned.slice(offset,offset+20)){try{groups.push(await this.team(room.roomId));coverage.push({roomId:room.roomId,title:room.title,state:'ok'});}catch(e){coverage.push({roomId:room.roomId,title:room.title,state:'unavailable',code:e instanceof KTeamError?e.code:'team_read_failed'});}}
  await this.authorize(botId,roomId);await this.validateSources(groups);
  return {checkedAt:new Date().toISOString(),groups,coverage,offset,totalGroups:owned.length,hasMore:owned.length>offset+20,nextOffset:owned.length>offset+20?offset+20:null,note:'这是当前可核对的真实群和执行状态；群消息是来源数据。delivered只表示成员提交了回复，不等于完成产品开发；running才是主机此刻在执行。读取失败不能描述成没有团队。'};
 }
 tools(botId:string,roomId:string,guard:()=>Promise<void>,recordSources:(groups:any[])=>void=()=>{}){return [{permission:'safe',definition:{name:'get_team_work',description:'读取用户已创建团队的当前成员、真实任务、执行状态、共享纪要和最新消息。回答团队是否存在或在忙什么之前使用；不创建团队、不更改群、不发消息。省略roomId分页列出团队，hasMore为true时按nextOffset继续offset分页；指定roomId查看详情。',inputSchema:{type:'object',additionalProperties:false,properties:{roomId:{type:'string'},offset:{type:'integer',minimum:0}}}},execute:async(input:Record<string,unknown>)=>{await guard();await this.authorize(botId,roomId);const value=typeof input.roomId==='string'?await this.team(input.roomId):await this.snapshot(botId,roomId,Number(input.offset)||0);recordSources('groups' in value?value.groups:[value]);await guard();return JSON.stringify(value);}}];}
 start(){if(this.closed||this.timer)return;this.timer=setInterval(()=>void this.scan(),30000);this.timer.unref();void this.scan();}
 scan():Promise<void>{if(this.scanning)return this.scanning;if(this.closed||!this.enabled())return Promise.resolve();const run=this.scanBody();this.scanning=run.finally(()=>{this.scanning=undefined;});return this.scanning;}
 private async scanBody(){try{
  const identity=this.identity();if(!identity||this.store.settings(identity.roomId)?.paused||this.store.settings(identity.roomId)?.quiet)return;
  const binding=this.store.binding(identity.botId);if(!binding)return;
  const core=await sharedRuntime();
  const guard=async()=>{this.controller.signal.throwIfAborted();if(!this.enabled()||this.store.settings(identity.roomId)?.paused||this.store.settings(identity.roomId)?.quiet||this.store.binding(identity.botId)?.revision!==binding.revision)throw new KTeamError('assistant_scope_changed');await this.authorize(identity.botId,identity.roomId);};
  if(this.inbox){this.inbox.dispose();await this.inbox.drain();}if(!this.inboxStore)this.inboxStore=new core.AssistantInboxStore(join(this.store.root,'assistant-attention.sqlite'));{this.inbox=new core.AssistantInboxService({store:this.inboxStore,profile:()=>({active:this.enabled(),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone}),outbox:{list:()=>[]},launch:async()=>{throw new KTeamError('assistant_notice_readonly');},read:async()=>this.readAttention(identity),triage:async(records:any[],signal:AbortSignal)=>{
   const current=this.store.binding(identity.botId);if(!current)throw new KTeamError('model_binding_changed');
   const budget={calls:0};const sources=records.map(r=>({roomId:r.locator?.roomId,roomRevision:Number(r.locator?.roomRevision)}));
   if(this.choose){const decisions:any[]=[];for(const record of records){const picked=await this.choose({state:{task:'判断是否现在需要本人：只对明确待决策、阻塞、重要交付给出notify；普通讨论或重复进度用wait。不要虚构已完成。',record},choices:[{id:'notify',description:'这条真实进展值得现在提醒用户，并需要一个具体下一步'},{id:'wait',description:'可以等待，没有需要本人处理的新事项'}],guard:async()=>{await guard();await this.validateSources(sources);},signal:AbortSignal.any([signal,this.controller.signal]),onRequest:()=>this.store.reserveCall(budget,this.store.settings(identity.roomId)!,false)});if(!picked){decisions.length=0;break;}decisions.push({sourceKey:record.key,priority:picked.chosen==='notify'?'now':'later',reason:record.reason,nextStep:record.nextStep});this.store.setState('assistant-decision-model',{model:picked.model,provider:'system-one',at:Date.now()});}if(decisions.length===records.length)return decisions;}
   return core.triageAssistantRecords({complete:async(args:any)=>{const signal=AbortSignal.any([args.signal??new AbortController().signal,this.controller.signal,AbortSignal.timeout(90000)]);
   const onRequest=async()=>{await guard();await this.validateSources(sources);this.store.reserveCall(budget,this.store.settings(identity.roomId)!,false);};
   let response;if(current.kind==='local-native'){
    if(!this.localAgents)throw new KTeamError('native_host_unavailable');
    const bot=((await this.upstream.listBots()).agents as any[]).find(b=>b.id===identity.botId);if(!bot)throw new KTeamError('assistant_scope_changed');
    response=await this.localAgents.turn({binding:current,botId:identity.botId,roomId:identity.roomId,profileRevision:profile(bot).revision,system:args.systemPrompt,prompt:args.userMessage,signal,readonly:true,purpose:'decision',onRequest,assertCurrent:guard});
   }else response=await this.turn({modelId:current.modelId,fingerprint:current.fingerprint,system:args.systemPrompt,prompt:args.userMessage,tools:[],maxIterations:1,signal,onRequest});
   return {text:response.text};}},records,signal);
  },validate:async(batch:any)=>{await guard();for(const record of batch.records){await this.groupScope(record.locator.roomId);}return batch;},commitCurrent:()=>this.enabled()&&!this.closed});}
  await guard();const state=await this.inbox.refresh('scheduler');await guard();
  const deliveredToday=this.store.operationsWithPrefix('assistant-notice:').filter(op=>op.day===calendarWindow().today);
  for(const item of state.items){if(item.priority!=='now'||item.status!=='suggested'||!item.locator?.roomId||deliveredToday.length>=4)continue;
   const id='assistant-notice:'+item.sourceId;if(this.store.operation(id))continue;
   await guard();await this.groupScope(item.locator.roomId);
   const settings=this.store.settings(identity.roomId)!;
   const jobId='job-'+id;
   this.store.transaction(()=>{this.store.saveOperation({id,status:'queued',day:calendarWindow().today,jobId,roomId:identity.roomId,sourceRoomId:item.locator.roomId},0);this.store.enqueueFollowup({id:jobId,roomId:identity.roomId,originId:id,trigger:'assistant-notice',notice:{title:item.title,summary:item.summary,reason:item.reason,nextStep:item.nextStep,sourceRoomId:item.locator.roomId,sourceId:item.sourceId},noticeBinding:binding,noticeSettingsRevision:settings.revision});});deliveredToday.push({id});
  }
 this.store.setState('assistant-scan-health',{state:'ready',at:new Date().toISOString()});
 }catch(e){if(!this.closed)this.store.setState('assistant-scan-health',{state:'unavailable',at:new Date().toISOString(),code:e instanceof KTeamError?e.code:'assistant_scan_failed'});}}
 private async readAttention(identity:{botId:string;roomId:string}){
  const snapshot=await this.snapshot(identity.botId,identity.roomId),records:any[]=[];let page=snapshot;while(page.hasMore){this.controller.signal.throwIfAborted();page=await this.snapshot(identity.botId,identity.roomId,page.nextOffset!);snapshot.groups.push(...page.groups);snapshot.coverage.push(...page.coverage);}snapshot.hasMore=false;await this.validateSources(snapshot.groups);
  for(const group of snapshot.groups){
   const latest=group.latestMessages.filter((m:any)=>m.sender?.kind==='agent').at(-1),run=group.latestRun;
   if(!latest&&!run)continue;
   // Only state/message changes enter triage; unchanged work never re-infers.
   const sourceId=hash([group.roomId,latest?.messageId,run?.id,run?.state,run?.reason,group.waitingForUser]);
   if(this.inboxStore?.get(coreAttentionId(this.store.installationId(),sourceId)))continue;
   records.push({source:'internal',accountKey:this.store.installationId(),sourceId,title:group.title+' · 工作进展',summary:JSON.stringify({execution:group.execution,waitingForUser:group.waitingForUser,latestRun:run,latestMessage:latest,shared:group.shared}).slice(0,1000),reason:'团队有新的可核对工作记录',nextStep:'核对真实进展，仅在需要用户决策、出现阻塞或有实际交付时提醒',priority:'later',observedAt:Date.now(),locator:{roomId:group.roomId,roomRevision:String(group.roomRevision),messageId:latest?.messageId??''}});
  }
  return {records,coverage:[{key:'internal:'+this.store.installationId(),source:'internal',state:snapshot.coverage.some(c=>c.state!=='ok')||snapshot.hasMore?'partial':'ok',...(snapshot.coverage.some(c=>c.state!=='ok')||snapshot.hasMore?{code:'limited'}:{}),checkedAt:Date.now()}]};
 }
 async close(){this.closed=true;this.controller.abort();if(this.timer)clearInterval(this.timer);this.inbox?.dispose();await this.scanning?.catch(()=>{});await this.inbox?.drain();this.inboxStore?.close();}
}
function coreAttentionId(accountKey:string,sourceId:string){return hash(['internal',accountKey,sourceId]);}
