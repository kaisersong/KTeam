import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {KTeamError} from '../errors.js';
import {watchStatus,type WatchDraft,type WatchItem,type WatchState,type WatchReminder,type WatchPrompt,type WatchProposal} from '../protocol/assistant-watch.js';
import type {DailyItem} from '../protocol/assistant-daily-types.js';
import type {TeamStore} from './team-store.js';

const time = z.number().int().min(0).max(8640000000000000);
const id = z.uuid();
const draft = z.object({
 title:z.string().trim().min(1).max(160),
 condition:z.string().trim().min(1).max(500),
 kind:z.enum(['waiting','commitment']),
 checkAt:time,stopAt:time,
 link:z.url({protocol:/^https$/}).max(1000).refine(value=>{const url=new URL(value);return !url.username&&!url.password;}).optional(),
 itemId:z.string().regex(/^[a-z0-9]{64}$/).optional(),
 calendar:z.object({day:z.iso.date(),titles:z.array(z.string().trim().min(1).max(120)).min(1).max(5)}).strict().optional(),
}).strict().refine(value=>value.stopAt>value.checkAt);
const update = z.object({id,expectedRevision:z.number().int().positive()});
const command = z.union([
 z.object({action:z.literal('create'),id,draft}).strict(),
 update.extend({action:z.literal('edit'),draft,clearCalendar:z.boolean().optional()}).strict(),
 update.extend({action:z.enum(['check','pause','resume','stop','done','dismiss','snooze','recheck'])}).strict(),
 z.object({action:z.enum(['confirm-draft','dismiss-draft']),id}).strict(),
 update.extend({action:z.literal('decide'),choice:z.enum(['online','decline'])}).strict(),
]);
const changes = {pause:'paused',resume:'active',stop:'stopped',done:'done',dismiss:'dismissed'} as const;
const namespace = 'assistant-watch:';
const activeLimit = 60;
const retainedHistory = 20;
const pending = (row:Saved) => row.state==='active'||row.state==='paused';
const fingerprint = (value:unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const evidenceRevision = (item:DailyItem) => fingerprint([item.source.account,item.source.id,item.source.revision,item.originalId,item.title,item.detail,item.url]);

interface Saved {
 id:string;
 revision:number;
 initialDigest:string;
 draft:WatchDraft;
 evidence?:string;
 state:WatchState;
 checkedAt?:number;
 snoozedUntil?:number;
 reminder?:WatchReminder;
 decision?:WatchItem['decision'];
}

export type ReminderReview={body:string;verifiedTitles?:string[];evidenceDigest?:string;verify?:()=>Promise<void>};
type PublishReminder=(notice:{kind:'watch-notice';id:string;roomId:string;body:string;deadline:number;guard:()=>Promise<void>})=>Promise<string>;

export class AssistantWatch {
 constructor(
  private store:TeamStore,
  private scope:()=>Promise<void>,
  private evidence:(itemId:string,scans:Map<string,Promise<DailyItem[]>>,signal:AbortSignal)=>Promise<DailyItem>,
  private room:()=>string|undefined,
  private now=Date.now,
  private verifyDecision?:(draft:WatchDraft,evidenceDigest:string|undefined)=>Promise<void>,
 ){}
 private prefix(){
  const room=this.room();
  if(!room)throw new KTeamError('assistant_scope_required',403);
  return namespace+fingerprint(room)+':';
 }
 private rows(prefix:string):Saved[]{return this.store.operationsWithPrefix(prefix);}
 private proposalKey(room:string){return 'assistant-watch-proposal:'+room;}
 private currentProposal(room:string){
  const proposal=this.store.state<WatchProposal&{originId:string}>(this.proposalKey(room));
  return proposal&&proposal.expiresAt>this.now()?proposal:undefined;
 }
 async propose(raw:unknown,originId:string,assertCurrent:()=>Promise<void>){
  const parsed=draft.safeParse(raw);
  if(!parsed.success||parsed.data.itemId||parsed.data.checkAt<=this.now())throw new KTeamError('watch_invalid',400);
  await this.scope();
  await assertCurrent();
  const room=this.room();
  if(!room)throw new KTeamError('assistant_scope_required',403);
  const previous=this.currentProposal(room);
  if(previous?.originId===originId)return previous;
  const proposal:WatchProposal={id:randomUUID(),draft:parsed.data,expiresAt:parsed.data.checkAt};
  this.store.setState(this.proposalKey(room),{...proposal,originId});
  return proposal;
 }
 prompts(){
  const room=this.room();
  if(!room)return {watchPrompts:[] as WatchPrompt[]};
  const prefix=this.prefix(),now=this.now();
  const watchPrompts=this.rows(prefix).filter(row=>row.state==='active'&&!row.decision&&row.reminder&&now<row.draft.stopAt)
   .slice(0,5).map(row=>({id:row.id.slice(prefix.length),revision:row.revision,title:row.draft.itemId?'有一件来源事项待处理':row.draft.title,
    reviewedAt:row.reminder!.at,verifiedTitles:row.reminder?.status==='sent'?row.reminder.verifiedTitles:undefined}));
  const proposal=this.currentProposal(room);
  return {watchPrompts,watchProposal:proposal&&{id:proposal.id,draft:proposal.draft,expiresAt:proposal.expiresAt}};
 }
 private async original(row:Saved,scans=new Map<string,Promise<DailyItem[]>>(),signal=AbortSignal.timeout(6000)) {
  if(!row.draft.itemId)return undefined;
  const original = await this.evidence(row.draft.itemId,scans,signal);
  if(evidenceRevision(original)!==row.evidence)throw new KTeamError('daily_source_changed',409);
  return original;
 }
 private async project(row:Saved,prefix:string,scans:Map<string,Promise<DailyItem[]>>,signal:AbortSignal):Promise<WatchItem>{
  const {draft:value,...rowFields}=row;
  const {id,revision,state,checkedAt,snoozedUntil,reminder,decision}=rowFields;
  const {title,condition,kind,link,checkAt,stopAt,calendar}=value;
  const safe={id:id.slice(prefix.length),revision,state,checkAt,stopAt,checkedAt,snoozedUntil,reminder,decision,sourceLinked:Boolean(value.itemId)};
  const status=watchStatus(safe,this.now());
  try {
   const source=await this.original(row,scans,signal);
   return {...safe,status,details:{title,condition,kind,link,calendar,originalLink:source?.url}};
  } catch {
   return {...safe,status:'source-unavailable'};
  }
 }
 async view(assertCurrent?:()=>void){
  await this.scope();
  const prefix=this.prefix();
  const all=this.rows(prefix);
  const rows=[...all.filter(pending),...all.filter(row=>!pending(row)).slice(0,retainedHistory)];
  const scans=new Map<string,Promise<DailyItem[]>>();
  const signal=AbortSignal.timeout(6000);
  const items:WatchItem[]=[];
  for(let offset=0;offset<rows.length;offset+=4){
   assertCurrent?.();
   items.push(...await Promise.all(rows.slice(offset,offset+4).map(row=>this.project(row,prefix,scans,signal))));
  }
  await this.scope();
  assertCurrent?.();
  // An edit while resolving the source cannot expose the previous revision.
  if(this.prefix()!==prefix)throw new KTeamError('assistant_scope_required',403);
  const latest=new Map(this.rows(prefix).map(row=>[row.id.slice(prefix.length),row.revision]));
  return {ok:true,items:items.filter(row=>latest.get(row.id)===row.revision).sort((a,b)=>a.checkAt-b.checkAt)};
 }
 async change(raw:unknown,assertCurrent?:()=>void){
  const parsed=command.safeParse(raw);
  if(!parsed.success)throw new KTeamError('watch_invalid',400);
  const request=parsed.data;
  await this.scope();
  const prefix=this.prefix();
  const key=prefix+request.id;
  const old:Saved|undefined=this.store.operation(key);
  const now=this.now();
  let proposal:WatchProposal|undefined;
  if(!('expectedRevision' in request)&&request.action!=='create'){
   const room=this.room()!;
   proposal=this.currentProposal(room);
   if(request.action==='confirm-draft'&&old)return this.view(assertCurrent);
   if(!proposal||proposal.id!==request.id)throw new KTeamError('watch_changed',409);
   if(request.action==='dismiss-draft'){
    assertCurrent?.();
    this.store.setState(this.proposalKey(room),null);
    return this.view(assertCurrent);
   }
  }
  const input='expectedRevision' in request||request.action==='create'?request:{action:'create' as const,id:request.id,draft:proposal!.draft};
  if(input.action==='create'&&old){
   if(old.initialDigest!==fingerprint(input.draft))throw new KTeamError('watch_changed',409);
   return this.view(assertCurrent);
  }
  if(input.action==='decide'&&old?.decision?.choice===input.choice&&old.revision===input.expectedRevision+1)return this.view(assertCurrent);
  if(input.action!=='create'&&old?.revision!==input.expectedRevision)throw new KTeamError('watch_changed',409);
  const content='draft' in input?input.draft:undefined;
  let evidence=old?.evidence;
  let next:Omit<Saved,'revision'>;
  if(content&&content.stopAt<=now)throw new KTeamError('watch_invalid',400);
  if(input.action==='create'){
   evidence=input.draft.itemId?evidenceRevision(await this.evidence(input.draft.itemId,new Map(),AbortSignal.timeout(6000))):undefined;
   next={id:key,draft:input.draft,state:'active',initialDigest:fingerprint(input.draft),evidence};
  } else {
   const previous=old!;
   if(content?.itemId&&content.itemId!==previous.draft.itemId)throw new KTeamError('watch_invalid',400);
   if(input.action==='check'||input.action==='edit'||input.action==='resume')await this.original(previous);
   next={...previous};
   if(input.action==='edit'){
    if(!['active','paused'].includes(previous.state))throw new KTeamError('watch_changed',409);
    if(input.clearCalendar&&input.draft.calendar)throw new KTeamError('watch_invalid',400);
    const calendar=input.clearCalendar?undefined:input.draft.calendar??previous.draft.calendar;
    next={...next,draft:{...input.draft,itemId:previous.draft.itemId,calendar},checkedAt:undefined,snoozedUntil:undefined,reminder:undefined};
   }else if(input.action==='check'||input.action==='snooze'||input.action==='recheck'){
    if(previous.state!=='active'||now>=previous.draft.stopAt)throw new KTeamError('watch_changed',409);
    if(input.action==='check')next.checkedAt=now;
    else {
     next.snoozedUntil=input.action==='snooze'?Math.min(now+3600000,previous.draft.stopAt):undefined;
     next.checkedAt=undefined;next.reminder=undefined;
    }
   }else if(input.action==='decide'){
    const titles=previous.reminder?.verifiedTitles;
    if(previous.state!=='active'||previous.reminder?.status!=='sent'||!titles?.length||now>=previous.draft.stopAt)throw new KTeamError('watch_changed',409);
    await this.verifyDecision?.(previous.draft,previous.reminder?.evidenceDigest);
    if(this.now()>=previous.draft.stopAt)throw new KTeamError('watch_changed',409);
    next={...previous,state:'done',decision:{choice:input.choice,at:this.now(),titles}};
   }else{
    if(previous.state!=='active'&&previous.state!=='paused'||input.action==='resume'&&(previous.state!=='paused'||now>=previous.draft.stopAt))throw new KTeamError('watch_changed',409);
    next.state=changes[input.action];
   }
  }
  await this.scope();
  assertCurrent?.();
  if(this.prefix()!==prefix)throw new KTeamError('assistant_scope_required',403);
  this.store.transaction(()=>{
   if(this.store.operation(key)?.revision!==old?.revision)throw new KTeamError('watch_changed',409);
   if(!old&&this.rows(prefix).filter(pending).length>=activeLimit)throw new KTeamError('watch_limit',409);
   if(proposal&&this.currentProposal(this.room()!)?.id!==input.id)throw new KTeamError('watch_changed',409);
   this.store.saveOperation(next,old?.revision??0);
   if(proposal)this.store.setState(this.proposalKey(this.room()!),null);
  });
  return this.view(assertCurrent);
 }
 async remindDue(enabled:()=>boolean,publish:PublishReminder,review:(draft:WatchDraft,original:DailyItem|undefined)=>Promise<ReminderReview>){
  const roomId=this.room();
  if(!roomId||!enabled())return;
  const prefix=this.prefix(),now=this.now();
  const due=this.rows(prefix).filter(row=>row.state==='active'&&watchStatus({...row,...row.draft},now)==='due').sort((a,b)=>a.draft.checkAt-b.draft.checkAt).slice(0,3);
  for(const row of due){
   const guard=async(revision:number)=>{
    await this.scope();
    if(!enabled()||this.room()!==roomId||this.store.operation(row.id)?.revision!==revision||this.now()>=row.draft.stopAt)throw new KTeamError('watch_changed',409);
   };
   try{
    await guard(row.revision);
    const original=await this.original(row).catch(()=>undefined);
    const checked=await review(row.draft,original);
    await guard(row.revision);
    const receipt:WatchReminder={at:this.now(),status:'attempted',verifiedTitles:checked.verifiedTitles,evidenceDigest:checked.evidenceDigest};
    const attempt=this.store.saveOperation({...row,reminder:receipt},row.revision);
    let status:WatchReminder['status']='unconfirmed';
    try{
     await publish({id:'assistant-watch-'+fingerprint([row.id,row.revision]),kind:'watch-notice',roomId,body:checked.body,
      deadline:Math.min(row.draft.stopAt,this.now()+5*60000),guard:async()=>{await guard(attempt.revision);if(original)await this.original(row);await checked.verify?.();await guard(attempt.revision);}});
     status='sent';
    }finally{
     if(this.store.operation(row.id)?.revision===attempt.revision)this.store.saveOperation({...attempt,reminder:{...receipt,status}},attempt.revision);
    }
   }catch{/* An invalidated check must not publish or repeat a reserved send. */}
  }
 }
}
