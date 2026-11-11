import type {DatabaseSync} from 'node:sqlite';
/** Invalidation counters derived atomically from the existing owners, never domain state. */
export function installViewRevisions(db:DatabaseSync){
 db.exec('CREATE INDEX IF NOT EXISTS team_job_view_scope ON team_jobs(room_id); CREATE TABLE IF NOT EXISTS view_revisions(scope TEXT PRIMARY KEY,revision INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS job_view_revisions(job_id TEXT PRIMARY KEY,revision INTEGER NOT NULL)');
 const bump=(scope:string)=>`INSERT INTO view_revisions VALUES(${scope},1) ON CONFLICT(scope) DO UPDATE SET revision=revision+1;`;
 for(const table of ['team_jobs','team_settings','team_outbox','team_proposals','team_seen','product_operations','product_state','bot_bindings'])for(const event of ['INSERT','UPDATE','DELETE']){
  const row=event==='DELETE'?'OLD':'NEW';let sql=bump("'global'");
  if(['team_jobs','team_settings','team_outbox','team_proposals','team_seen'].includes(table))sql+=bump("'room:'||"+row+'.room_id');
  if(table==='team_jobs')sql+=event==='DELETE'?`DELETE FROM job_view_revisions WHERE job_id=OLD.id;`:`INSERT INTO job_view_revisions VALUES(NEW.id,1) ON CONFLICT(job_id) DO UPDATE SET revision=revision+1;`;
  if(table==='product_operations')for(const field of ['roomId','displayRoomId','sourceRoomId'])sql+=`INSERT INTO view_revisions SELECT 'room:'||json_extract(${row}.value_json,'$.${field}'),1 WHERE json_type(${row}.value_json,'$.${field}')='text' ON CONFLICT(scope) DO UPDATE SET revision=revision+1;`;
  if(table==='product_state')sql+=`INSERT INTO view_revisions SELECT 'room:'||substr(${row}.key,18),1 WHERE ${row}.key GLOB 'team-role-policy:*' ON CONFLICT(scope) DO UPDATE SET revision=revision+1;`;
  db.exec(`CREATE TRIGGER IF NOT EXISTS view_${table}_${event.toLowerCase()} AFTER ${event} ON ${table} BEGIN ${sql} END`);
 }
}
