import {DatabaseSync,backup} from 'node:sqlite';
import {randomUUID,createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {constants,openSync,closeSync,readFileSync,chmodSync,linkSync,unlinkSync,realpathSync,statSync} from 'node:fs';
import {KTeamError,record,fields,text} from '../errors.js';
/** A consistent private snapshot, never a raw live-file copy or an automatic writer switch. */
export async function snapshotDatabase(input:unknown,cwd:string,guard:()=>Promise<void>,assertPath:(name:string,args:Record<string,unknown>,cwd:string)=>void){
 const value=record(input);fields(value,['source','destination']);const requestedSource=resolve(cwd,text(value.source,'source',4096)),source=realpathSync(requestedSource),requested=resolve(cwd,text(value.destination,'destination',4096));
 await guard();assertPath('read',{file_path:source},cwd);assertPath('write',{file_path:requested},cwd);
 if(realpathSync(source)!==source||!statSync(source).isFile())throw new KTeamError('database_source_changed',409);
 const parent=realpathSync(dirname(requested)),destination=resolve(parent,requested.split(/[\\/]/).at(-1)!),stage=destination+'.snapshot-'+randomUUID();
 const parentIdentity=statSync(parent),sourceIdentity=statSync(source);assertPath('read',{file_path:source},cwd);assertPath('write',{file_path:destination},cwd);
 const fd=openSync(stage,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY,0o600);closeSync(fd);
 const db=new DatabaseSync(source,{readOnly:true});
 try{
  await backup(db,stage);chmodSync(stage,0o600);await guard();assertPath('read',{file_path:source},cwd);assertPath('write',{file_path:destination},cwd);
  if(realpathSync(dirname(requested))!==parent||statSync(parent).ino!==parentIdentity.ino||statSync(parent).dev!==parentIdentity.dev||realpathSync(requestedSource)!==source||statSync(source).ino!==sourceIdentity.ino||statSync(source).dev!==sourceIdentity.dev)throw new KTeamError('database_target_changed',409);
  const target=new DatabaseSync(stage,{readOnly:true});let tables:any[],integrity:any[];
  try{integrity=target.prepare('PRAGMA integrity_check').all();if(integrity.length!==1||Object.values(integrity[0] as any)[0]!=='ok')throw new KTeamError('database_integrity_failed',409);tables=target.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row:any)=>({name:row.name,rows:(target.prepare('SELECT count(*) AS n FROM "'+row.name.replaceAll('"','""')+'"').get() as any).n}));}finally{target.close();}
  const sha256=createHash('sha256').update(readFileSync(stage)).digest('hex');
  // Atomic no-overwrite publish. A retry may not replace an existing snapshot.
  linkSync(stage,destination);
  return {ok:true,source,destination,sha256,integrity:'ok',tables,snapshotCompletedAt:new Date().toISOString(),visibility:'private',writerSwitched:false,notice:'一致性快照已验证；快照可能含敏感业务数据，不能直接作为可分享证据。源仍是唯一写入位置；切换前须停止源写入并核对选定快照边界和关键数据。'};
 }finally{db.close();try{unlinkSync(stage);}catch{}}
}
