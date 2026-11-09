import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {KTeamError} from '../errors.js';
import {randomUUID} from 'node:crypto';

export interface Binding {botId:string;modelId:string;fingerprint:string;model:string;revision:number;kind:'xiaok-hosted'}
export interface TeamSettings {roomId:string;goal:string;mode:'auto'|'mentions';paused:boolean;quiet:boolean;revision:number;maxRuns:number;dailyCalls:number;kind?:'assistant'|'direct'|'group'}
export class TeamStore {
 private db:DatabaseSync;
 constructor(root:string){
  this.db=new DatabaseSync(join(root,'team-extensions.sqlite'));
  this.db.exec(`CREATE TABLE IF NOT EXISTS bot_bindings(bot_id TEXT PRIMARY KEY,value_json TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS team_settings(room_id TEXT PRIMARY KEY,value_json TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS team_jobs(id TEXT PRIMARY KEY,room_id TEXT NOT NULL,origin_id TEXT NOT NULL,state TEXT NOT NULL,value_json TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS team_call_budgets(day TEXT PRIMARY KEY,calls INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS team_seen(room_id TEXT NOT NULL,sequence INTEGER NOT NULL,PRIMARY KEY(room_id,sequence));
   CREATE TABLE IF NOT EXISTS team_outbox(id TEXT PRIMARY KEY,room_id TEXT NOT NULL,intent_hash TEXT NOT NULL,envelope_json TEXT,state TEXT NOT NULL,origin_id TEXT);
   CREATE TABLE IF NOT EXISTS product_state(key TEXT PRIMARY KEY,value_json TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS product_operations(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,value_json TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS team_proposals(id TEXT PRIMARY KEY,room_id TEXT NOT NULL,run_id TEXT NOT NULL,reply_id TEXT,value_json TEXT NOT NULL);`);
 }
 state<T=any>(key:string):T|null{const row=this.db.prepare('SELECT value_json FROM product_state WHERE key=?').get(key);return row?JSON.parse(String(row.value_json)):null;}
 stateOnce(key:string,value:unknown){this.db.prepare('INSERT OR IGNORE INTO product_state VALUES(?,?)').run(key,JSON.stringify(value));return this.state(key);}
 installationId():string{return this.stateOnce('installation-id',randomUUID()) as string;}
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
 binding(botId:string):Binding|null{const row=this.db.prepare('SELECT value_json FROM bot_bindings WHERE bot_id=?').get(botId);return row?JSON.parse(String(row.value_json)):null;}
 bind(value:Binding){this.db.prepare('INSERT INTO bot_bindings VALUES(?,?) ON CONFLICT(bot_id) DO UPDATE SET value_json=excluded.value_json').run(value.botId,JSON.stringify(value));return value;}
 settings(roomId:string):TeamSettings|null{const row=this.db.prepare('SELECT value_json FROM team_settings WHERE room_id=?').get(roomId);return row?JSON.parse(String(row.value_json)):null;}
 configure(value:TeamSettings,expectedRevision:number){const previous=this.settings(value.roomId);if((previous?.revision??0)!==expectedRevision)throw new KTeamError('team_revision_conflict',409);const next={...value,revision:expectedRevision+1};this.db.prepare('INSERT INTO team_settings VALUES(?,?) ON CONFLICT(room_id) DO UPDATE SET value_json=excluded.value_json').run(value.roomId,JSON.stringify(next));return next;}
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
 jobs(roomId?:string){return this.db.prepare('SELECT value_json FROM team_jobs '+(roomId?'WHERE room_id=? ':'')+'ORDER BY rowid DESC LIMIT 100').all(...(roomId?[roomId]:[])).map(row=>JSON.parse(String(row.value_json)));}
 prepareSubmission(id:string,roomId:string,intentHash:string,envelope:unknown){
  const prior=this.db.prepare('SELECT intent_hash FROM team_outbox WHERE id=?').get(id);
  if(prior&&prior.intent_hash!==intentHash)throw new KTeamError('aimp_id_conflict',409);
  this.db.prepare("INSERT OR IGNORE INTO team_outbox VALUES(?,?,?,?,'pending',NULL)").run(id,roomId,intentHash,JSON.stringify(envelope));
 }
 pendingSubmissions(roomId?:string){return this.db.prepare("SELECT id,room_id AS roomId,intent_hash AS intentHash FROM team_outbox WHERE state='pending' "+(roomId?'AND room_id=? ':'')+'ORDER BY rowid LIMIT 100').all(...(roomId?[roomId]:[])) as {id:string;roomId:string;intentHash:string}[];}
 completeSubmission(id:string,originId:string){
  this.db.exec('BEGIN IMMEDIATE');try{
   const row=this.db.prepare('SELECT room_id FROM team_outbox WHERE id=?').get(id);if(!row)throw new KTeamError('submission_not_found');
   this.enqueue('job-'+originId,String(row.room_id),originId);
   this.db.prepare("UPDATE team_outbox SET state='sent',origin_id=?,envelope_json=NULL WHERE id=?").run(originId,id);
   this.db.exec('COMMIT');
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 save(job:any){this.db.prepare('UPDATE team_jobs SET state=?,value_json=? WHERE id=?').run(job.state,JSON.stringify(job),job.id);}
 claim(){
  const row=this.db.prepare("SELECT value_json FROM team_jobs WHERE state='queued' ORDER BY rowid LIMIT 1").get();if(!row)return null;
  const job=JSON.parse(String(row.value_json));job.state='routing';this.save(job);return job;
 }
 reserveCall(job:any,team:TeamSettings){
  const previousCalls=job.calls;
  this.db.exec('BEGIN IMMEDIATE');try{
   const day=new Date().toISOString().slice(0,10);const calls=Number(this.db.prepare('SELECT calls FROM team_call_budgets WHERE day=?').get(day)?.calls??0);
   if(job.calls>=team.maxRuns||calls>=team.dailyCalls)throw new KTeamError('team_budget_exhausted',409);
   this.db.prepare('INSERT INTO team_call_budgets VALUES(?,1) ON CONFLICT(day) DO UPDATE SET calls=calls+1').run(day);
   job.calls++;this.save(job);this.db.exec('COMMIT');
  }catch(e){this.db.exec('ROLLBACK');job.calls=previousCalls;throw e;}
 }
 markSeen(roomId:string,sequences:number[]){const statement=this.db.prepare('INSERT OR IGNORE INTO team_seen VALUES(?,?)');for(const seq of sequences)statement.run(roomId,seq);}
 seen(roomId:string):number[]{return this.db.prepare('SELECT sequence FROM team_seen WHERE room_id=? ORDER BY sequence').all(roomId).map(row=>Number(row.sequence));}
 recover(){this.db.exec("UPDATE team_jobs SET state='unknown',value_json=json_set(value_json,'$.state','unknown','$.reason','host_restarted_result_unknown') WHERE state IN ('routing','running','stopping')");}
 close(){this.db.close();}
}
