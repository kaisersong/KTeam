import {calendarWindow} from '../runtime/calendar.js';
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {KTeamError} from '../errors.js';
import {randomUUID} from 'node:crypto';

export interface Binding {botId:string;modelId:string;fingerprint:string;model:string;revision:number;kind:'xiaok-hosted'|'local-native'}
export interface TeamSettings {roomId:string;goal:string;mode:'auto'|'mentions';paused:boolean;quiet:boolean;revision:number;maxRuns:number;dailyCalls:number;kind?:'assistant'|'direct'|'group'|'peer';delivery?:'external-agent';goalConfirmed?:boolean;lastGoalOperation?:string}
export class TeamStore {
 private db:DatabaseSync;private transactionDepth=0;
 transaction<T>(fn:()=>T):T{if(this.transactionDepth)return fn();this.db.exec('BEGIN IMMEDIATE');this.transactionDepth++;try{const result=fn();this.db.exec('COMMIT');return result;}catch(error){this.db.exec('ROLLBACK');throw error;}finally{this.transactionDepth--;}}
 constructor(readonly root:string){
  this.db=new DatabaseSync(join(root,'team-extensions.sqlite'));
  this.db.exec(`CREATE TABLE IF NOT EXISTS bot_bindings(bot_id TEXT PRIMARY KEY,value_json TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS team_settings(room_id TEXT PRIMARY KEY,value_json TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS team_jobs(id TEXT PRIMARY KEY,room_id TEXT NOT NULL,origin_id TEXT NOT NULL,state TEXT NOT NULL,value_json TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS team_call_budgets(day TEXT PRIMARY KEY,calls INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS team_seen(room_id TEXT NOT NULL,sequence INTEGER NOT NULL,PRIMARY KEY(room_id,sequence));
   CREATE TABLE IF NOT EXISTS team_outbox(id TEXT PRIMARY KEY,room_id TEXT NOT NULL,intent_hash TEXT NOT NULL,envelope_json TEXT,state TEXT NOT NULL,origin_id TEXT);
   CREATE TABLE IF NOT EXISTS product_state(key TEXT PRIMARY KEY,value_json TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS product_operations(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,value_json TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS agent_deliveries(bot_id TEXT NOT NULL,room_id TEXT NOT NULL,origin_id TEXT NOT NULL,reads INTEGER NOT NULL,PRIMARY KEY(bot_id,room_id,origin_id));
   CREATE TABLE IF NOT EXISTS agent_reply_outbox(id TEXT PRIMARY KEY,link_id TEXT NOT NULL,room_id TEXT NOT NULL,hash TEXT NOT NULL,state TEXT NOT NULL,value_json TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS team_proposals(id TEXT PRIMARY KEY,room_id TEXT NOT NULL,run_id TEXT NOT NULL,reply_id TEXT,value_json TEXT NOT NULL);`);
  if(!this.state('harness-budget-v1')){this.db.prepare("UPDATE team_settings SET value_json=json_set(value_json,'$.maxRuns',128,'$.dailyCalls',1000,'$.revision',coalesce(json_extract(value_json,'$.revision'),0)+1) WHERE json_extract(value_json,'$.maxRuns')=6 AND json_extract(value_json,'$.dailyCalls')=20").run();this.setState('harness-budget-v1',true);}
  this.db.prepare("UPDATE team_jobs SET state='noop',value_json=json_set(value_json,'$.state','noop','$.reason','legacy_goal_gate_retired') WHERE state='awaiting_goal'").run();
 }
 stateEntries(prefix:string){return this.db.prepare('SELECT key,value_json FROM product_state WHERE substr(key,1,?)=?').all(prefix.length,prefix).map(r=>({key:String(r.key),value:JSON.parse(String(r.value_json))}));}
 resetSourceGates(){this.db.prepare("UPDATE product_state SET value_json='null' WHERE substr(key,1,16)='source-changing:'").run();}
 setState(key:string,value:unknown){this.db.prepare('INSERT INTO product_state VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json').run(key,JSON.stringify(value));}
 agentDelivery(botId:string,roomId:string,originId:string){this.db.prepare('INSERT INTO agent_deliveries VALUES(?,?,?,1) ON CONFLICT(bot_id,room_id,origin_id) DO UPDATE SET reads=reads+1').run(botId,roomId,originId);return Number(this.db.prepare('SELECT reads FROM agent_deliveries WHERE bot_id=? AND room_id=? AND origin_id=?').get(botId,roomId,originId)?.reads??0);}
 agentReply(id:string):any{const row=this.db.prepare('SELECT value_json FROM agent_reply_outbox WHERE id=?').get(id);return row?JSON.parse(String(row.value_json)):null;}
 prepareAgentReply(value:any){const prior=this.agentReply(value.id);if(prior&&prior.hash!==value.hash)throw new KTeamError('agent_reply_conflict',409);if(!prior)this.db.prepare('INSERT INTO agent_reply_outbox VALUES(?,?,?,?,?,?)').run(value.id,value.linkId,value.roomId,value.hash,'pending',JSON.stringify({...value,state:'pending'}));return prior;}
 completeAgentReply(id:string,messageId:string){const value=this.agentReply(id);if(!value)throw new KTeamError('agent_reply_not_found');const next={...value,state:'sent',messageId};this.db.prepare("UPDATE agent_reply_outbox SET state='sent',value_json=? WHERE id=?").run(JSON.stringify(next),id);return next;}
 rejectAgentReply(id:string,code:string){const value=this.agentReply(id);const next={...value,state:'rejected',code};this.db.prepare("UPDATE agent_reply_outbox SET state='rejected',value_json=? WHERE id=?").run(JSON.stringify(next),id);return next;}
 pendingAgentReplies(linkId:string):any[]{return this.db.prepare("SELECT value_json FROM agent_reply_outbox WHERE link_id=? AND state='pending'").all(linkId).map(row=>JSON.parse(String(row.value_json)));}
 state<T=any>(key:string):T|null{const row=this.db.prepare('SELECT value_json FROM product_state WHERE key=?').get(key);return row?JSON.parse(String(row.value_json)):null;}
 stateOnce(key:string,value:unknown){this.db.prepare('INSERT OR IGNORE INTO product_state VALUES(?,?)').run(key,JSON.stringify(value));return this.state(key);}
 installationId():string{return this.stateOnce('installation-id',randomUUID()) as string;}
 peerContacts(roomId:string,originIds?:string[]):any[]{if(originIds?.length===0)return [];return this.db.prepare("SELECT o.value_json FROM product_operations o JOIN team_jobs j ON j.id=json_extract(o.value_json,'$.rootJobId') WHERE substr(o.id,1,12)='bot-contact:' AND j.room_id=?"+(originIds?' AND j.origin_id IN ('+originIds.map(()=>'?').join(',')+')':'')+' ORDER BY o.rowid').all(roomId,...(originIds??[])).map(row=>JSON.parse(String(row.value_json)));}
 workingBotIds():string[]{return this.db.prepare("SELECT DISTINCT json_extract(value_json,'$.activeBotId') AS bot FROM team_jobs WHERE state IN ('routing','running','stopping') AND json_extract(value_json,'$.activeBotId') IS NOT NULL").all().map(row=>String(row.bot));}
 operationsWithPrefix(prefix:string):any[]{return this.db.prepare('SELECT value_json FROM product_operations WHERE substr(id,1,?)=? ORDER BY rowid DESC').all(prefix.length,prefix).map(row=>JSON.parse(String(row.value_json)));}
 operations():any[]{return this.db.prepare('SELECT value_json FROM product_operations ORDER BY rowid DESC LIMIT 100').all().map(row=>JSON.parse(String(row.value_json)));}
 operation(id:string):any{const row=this.db.prepare('SELECT value_json FROM product_operations WHERE id=?').get(id);return row?JSON.parse(String(row.value_json)):null;}
 saveOperation(value:any,expectedRevision:number){
  const next={...value,revision:expectedRevision+1};
  if(expectedRevision===0){const result=this.db.prepare('INSERT OR IGNORE INTO product_operations VALUES(?,?,?)').run(value.id,next.revision,JSON.stringify(next));if(result.changes!==1)throw new KTeamError('operation_conflict',409);}
  else if(this.db.prepare('UPDATE product_operations SET revision=?,value_json=? WHERE id=? AND revision=?').run(next.revision,JSON.stringify(next),value.id,expectedRevision).changes!==1)throw new KTeamError('operation_conflict',409);
  return next;
 }
 proposal(id:string):any{const row=this.db.prepare('SELECT value_json FROM team_proposals WHERE id=?').get(id);return row?JSON.parse(String(row.value_json)):null;}
 proposalForRun(runId:string):any{const row=this.db.prepare('SELECT value_json FROM team_proposals WHERE run_id=? ORDER BY rowid LIMIT 1').get(runId);return row?JSON.parse(String(row.value_json)):null;}
 saveProposal(value:any){const previous=this.proposal(value.id);if(previous&&previous.hash!==value.hash)throw new KTeamError('proposal_changed',409);this.db.prepare('INSERT OR IGNORE INTO team_proposals VALUES(?,?,?,NULL,?)').run(value.id,value.roomId,value.runId,JSON.stringify(value));return previous??value;}
 proposals(roomId?:string):any[]{return this.db.prepare('SELECT value_json,reply_id FROM team_proposals '+(roomId?'WHERE room_id=? ':'')+'ORDER BY rowid DESC LIMIT 100').all(...(roomId?[roomId]:[])).map(row=>({...JSON.parse(String(row.value_json)),replyId:row.reply_id??null}));}
 attachProposals(runId:string,messageId:string){this.db.prepare('UPDATE team_proposals SET reply_id=? WHERE run_id=? AND reply_id IS NULL').run(messageId,runId);}
 proposalsForMessage(messageId:string):any[]{return this.db.prepare('SELECT value_json FROM team_proposals WHERE reply_id=?').all(messageId).map(row=>JSON.parse(String(row.value_json)));}
 switchSource(botId:string,binding:Binding|null,driver?:string){
  return this.transaction(()=>{
   const prior=this.binding(botId);if(!binding&&prior)this.setState('system-binding:'+botId,prior);
   if(binding)this.bind(binding);else this.db.prepare('DELETE FROM bot_bindings WHERE bot_id=?').run(botId);
   for(const row of this.db.prepare("SELECT key,value_json FROM product_state WHERE key LIKE 'conversation:%'").all()){
    const value=JSON.parse(String(row.value_json));let changed=false;value.members=value.members.map((m:any)=>{if(m.botId!==botId)return m;changed=true;return binding?{...m,modelId:binding.modelId,model:binding.model,fingerprint:binding.fingerprint,bindingRevision:binding.revision,existing:true,unbound:false,external:undefined}:{...m,modelId:'',model:'原Agent会话',fingerprint:'none',bindingRevision:undefined,existing:true,unbound:true,external:{driver}};});
    if(changed){this.setState(String(row.key),value);const roomId=String(row.key).slice('conversation:'.length),settings=this.settings(roomId);if(settings)this.configure({...settings,delivery:value.members.every((m:any)=>!this.binding(m.botId))?'external-agent':undefined},settings.revision);}
   }
  });
 }
 binding(botId:string):Binding|null{const row=this.db.prepare('SELECT value_json FROM bot_bindings WHERE bot_id=?').get(botId);return row?JSON.parse(String(row.value_json)):null;}
 bind(value:Binding){this.db.prepare('INSERT INTO bot_bindings VALUES(?,?) ON CONFLICT(bot_id) DO UPDATE SET value_json=excluded.value_json').run(value.botId,JSON.stringify(value));return value;}
 settings(roomId:string):TeamSettings|null{const row=this.db.prepare('SELECT value_json FROM team_settings WHERE room_id=?').get(roomId);return row?JSON.parse(String(row.value_json)):null;}
 configure(value:TeamSettings,expectedRevision:number){const previous=this.settings(value.roomId);if((previous?.revision??0)!==expectedRevision)throw new KTeamError('team_revision_conflict',409);const next={...value,revision:expectedRevision+1};this.db.prepare('INSERT INTO team_settings VALUES(?,?) ON CONFLICT(room_id) DO UPDATE SET value_json=excluded.value_json').run(value.roomId,JSON.stringify(next));return next;}
 enqueueFollowup(value:any){const job={...value,state:this.settings(value.roomId)?.paused?'held':'queued',calls:0,createdAt:new Date().toISOString()};this.db.prepare('INSERT OR IGNORE INTO team_jobs VALUES(?,?,?,?,?)').run(job.id,job.roomId,job.originId,job.state,JSON.stringify(job));}
 enqueue(id:string,roomId:string,originId:string){const state=this.settings(roomId)?.paused?'held':'queued';this.db.prepare('INSERT OR IGNORE INTO team_jobs VALUES(?,?,?,?,?)').run(id,roomId,originId,state,JSON.stringify({id,roomId,originId,state,...(state==='held'?{reason:'team_paused'}:{}),calls:0,createdAt:new Date().toISOString()}));}
 pause(roomId:string){
  this.db.exec('BEGIN IMMEDIATE');try{
   const previous=this.settings(roomId);if(!previous)throw new KTeamError('team_settings_not_found');
   const settings=this.configure({...previous,paused:true},previous.revision);
   this.db.prepare("UPDATE team_jobs SET state='held',value_json=json_set(value_json,'$.state','held','$.reason','team_paused') WHERE room_id=? AND state='queued'").run(roomId);
   this.db.exec('COMMIT');return settings;
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 resume(roomId:string){
  this.db.exec('BEGIN IMMEDIATE');try{
   const previous=this.settings(roomId);if(!previous)throw new KTeamError('team_settings_not_found');
   const settings=this.configure({...previous,paused:false},previous.revision);
   this.db.prepare("UPDATE team_jobs SET state='queued',value_json=json_remove(json_set(value_json,'$.state','queued'),'$.reason') WHERE room_id=? AND state='held'").run(roomId);
   this.db.exec('COMMIT');return settings;
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 job(id:string):any{const row=this.db.prepare('SELECT value_json FROM team_jobs WHERE id=?').get(id);return row?JSON.parse(String(row.value_json)):null;}
 waitingJobs():any[]{return this.db.prepare("SELECT value_json FROM team_jobs WHERE state='waiting' ORDER BY rowid LIMIT 100").all().map(row=>JSON.parse(String(row.value_json)));}
 recordedJobs(roomId:string){return this.db.prepare('SELECT value_json FROM team_jobs WHERE room_id=? ORDER BY rowid DESC LIMIT 10000').all(roomId).map(r=>JSON.parse(String(r.value_json)));}
 jobForMessage(roomId:string,messageId:string){const row=this.db.prepare("SELECT value_json FROM team_jobs WHERE room_id=? AND EXISTS(SELECT 1 FROM json_each(team_jobs.value_json,'$.results') WHERE json_extract(value,'$.messageId')=?) ORDER BY rowid DESC LIMIT 1").get(roomId,messageId);return row?JSON.parse(String(row.value_json)):null;}
 jobs(roomId?:string){return this.db.prepare('SELECT value_json FROM team_jobs '+(roomId?'WHERE room_id=? ':'')+'ORDER BY rowid DESC LIMIT 100').all(...(roomId?[roomId]:[])).map(row=>JSON.parse(String(row.value_json)));}
 prepareSubmission(id:string,roomId:string,intentHash:string,envelope:unknown){
  const prior=this.db.prepare('SELECT intent_hash FROM team_outbox WHERE id=?').get(id);
  if(prior&&prior.intent_hash!==intentHash)throw new KTeamError('aimp_id_conflict',409);
  this.db.prepare("INSERT OR IGNORE INTO team_outbox VALUES(?,?,?,?,'pending',NULL)").run(id,roomId,intentHash,JSON.stringify(envelope));
 }
 pendingSubmissions(roomId?:string){return this.db.prepare("SELECT id,room_id AS roomId,intent_hash AS intentHash FROM team_outbox WHERE state='pending' "+(roomId?'AND room_id=? ':'')+'ORDER BY rowid LIMIT 100').all(...(roomId?[roomId]:[])) as {id:string;roomId:string;intentHash:string}[];}
 completeSubmission(id:string,originId:string,enqueue=true){
  this.db.exec('BEGIN IMMEDIATE');try{
   const row=this.db.prepare('SELECT room_id FROM team_outbox WHERE id=?').get(id);if(!row)throw new KTeamError('submission_not_found');
   if(enqueue)this.enqueue('job-'+originId,String(row.room_id),originId);
   this.db.prepare("UPDATE team_outbox SET state='sent',origin_id=?,envelope_json=NULL WHERE id=?").run(originId,id);
   this.db.exec('COMMIT');
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 save(job:any){this.db.prepare('UPDATE team_jobs SET state=?,value_json=? WHERE id=?').run(job.state,JSON.stringify(job),job.id);}
 claim(excludedRooms:string[]=[],peerOnly=false){
  const row=this.db.prepare("SELECT value_json FROM team_jobs WHERE state='queued' AND room_id NOT IN (SELECT value FROM json_each(?)) AND (?=0 OR json_extract(value_json,'$.trigger')='peer') ORDER BY CASE WHEN json_extract(value_json,'$.trigger')='peer' THEN 0 ELSE 1 END,rowid LIMIT 1").get(JSON.stringify(excludedRooms),peerOnly?1:0);if(!row)return null;
  const job=JSON.parse(String(row.value_json));job.state='routing';this.save(job);return job;
 }
 reserveCall(job:any,team:TeamSettings,persistJob=true){
  const previousCalls=job.calls;
  this.db.exec('BEGIN IMMEDIATE');try{
   const day=calendarWindow().today+':'+team.roomId;const calls=Number(this.db.prepare('SELECT calls FROM team_call_budgets WHERE day=?').get(day)?.calls??0);
   if(job.calls>=team.maxRuns||calls>=team.dailyCalls)throw new KTeamError('team_budget_exhausted',409);
   this.db.prepare('INSERT INTO team_call_budgets VALUES(?,1) ON CONFLICT(day) DO UPDATE SET calls=calls+1').run(day);
   job.calls++;if(persistJob)this.save(job);this.db.exec('COMMIT');
  }catch(e){this.db.exec('ROLLBACK');job.calls=previousCalls;throw e;}
 }
 markSeen(roomId:string,sequences:number[]){const statement=this.db.prepare('INSERT OR IGNORE INTO team_seen VALUES(?,?)');for(const seq of sequences)statement.run(roomId,seq);}
 seen(roomId:string):number[]{return this.db.prepare('SELECT sequence FROM team_seen WHERE room_id=? ORDER BY sequence').all(roomId).map(row=>Number(row.sequence));}
 recover(){this.db.exec("UPDATE team_jobs SET state='unknown',value_json=json_set(value_json,'$.state','unknown','$.reason','host_restarted_result_unknown') WHERE state IN ('routing','running','stopping')");}
 close(){this.db.close();}
}
