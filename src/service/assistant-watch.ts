import {createHash} from 'node:crypto';
import {z} from 'zod';
import {KTeamError} from '../errors.js';
import {watchStatus,type WatchDraft,type WatchItem,type WatchState} from '../protocol/assistant-watch.js';
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
}).strict().refine(value=>value.stopAt>value.checkAt);
const update = z.object({id,expectedRevision:z.number().int().positive()});
const command = z.union([
 z.object({action:z.literal('create'),id,draft}).strict(),
 update.extend({action:z.literal('edit'),draft}).strict(),
 update.extend({action:z.enum(['check','pause','resume','stop','done','dismiss','snooze'])}).strict(),
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
}

export class AssistantWatch {
 constructor(
  private store:TeamStore,
  private scope:()=>Promise<void>,
  private evidence:(itemId:string,scans:Map<string,Promise<DailyItem[]>>,signal:AbortSignal)=>Promise<DailyItem>,
  private room:()=>string|undefined,
  private now=Date.now,
 ){}
 private prefix(){
  const room=this.room();
  if(!room)throw new KTeamError('assistant_scope_required',403);
  return namespace+fingerprint(room)+':';
 }
 private rows(prefix:string):Saved[]{return this.store.operationsWithPrefix(prefix);}
 private async original(row:Saved,scans=new Map<string,Promise<DailyItem[]>>(),signal=AbortSignal.timeout(6000)) {
  if(!row.draft.itemId)return undefined;
  const original = await this.evidence(row.draft.itemId,scans,signal);
  if(evidenceRevision(original)!==row.evidence)throw new KTeamError('daily_source_changed',409);
  return original;
 }
 private async project(row:Saved,prefix:string,scans:Map<string,Promise<DailyItem[]>>,signal:AbortSignal):Promise<WatchItem>{
  const {draft:value,...rowFields}=row;
  const {id,revision,state,checkedAt,snoozedUntil}=rowFields;
  const {title,condition,kind,link,checkAt,stopAt}=value;
  const safe={id:id.slice(prefix.length),revision,state,checkAt,stopAt,checkedAt,snoozedUntil,sourceLinked:Boolean(value.itemId)};
  const status=watchStatus(safe,this.now());
  try {
   const source=await this.original(row,scans,signal);
   return {...safe,status,details:{title,condition,kind,link,originalLink:source?.url}};
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
  const input=parsed.data;
  await this.scope();
  const prefix=this.prefix();
  const key=prefix+input.id;
  const old:Saved|undefined=this.store.operation(key);
  const now=this.now();
  if(input.action==='create'&&old){
   if(old.initialDigest!==fingerprint(input.draft))throw new KTeamError('watch_changed',409);
   return this.view(assertCurrent);
  }
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
    next={...next,draft:{...input.draft,itemId:previous.draft.itemId},checkedAt:undefined,snoozedUntil:undefined};
   }else if(input.action==='check'||input.action==='snooze'){
    if(previous.state!=='active'||now>=previous.draft.stopAt)throw new KTeamError('watch_changed',409);
    if(input.action==='check')next.checkedAt=now;
    else {next.snoozedUntil=Math.min(now+3600000,previous.draft.stopAt);next.checkedAt=undefined;}
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
   this.store.saveOperation(next,old?.revision??0);
  });
  return this.view(assertCurrent);
 }
}
