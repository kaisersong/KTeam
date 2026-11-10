import {DatabaseSync} from 'node:sqlite';
import {existsSync,lstatSync,realpathSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {KTeamError} from '../errors.js';

const layers=[['memory_l0_raw','content'],['memory_l1_extracted','summary'],['memory_l2_scenario','scenario'],['memory_l3_persona','trait']] as const;
/** Read the existing runtime store. Viewing settings never opens a new memory writer. */
export function readMemoryView(directory:string,layer:number,offset:number){
 const empty={ok:true,backend:'empty',stats:{l0:0,l1:0,l2:0,l3:0,dbSizeBytes:0},entries:[],hasMore:false};
 if(!existsSync(directory))return empty;
 if(realpathSync(directory)!==directory||lstatSync(directory).isSymbolicLink())throw new KTeamError('harness_storage_invalid');
 const file=join(directory,'memory.sqlite');if(!existsSync(file))return {...empty,backend:existsSync(join(directory,'memory'))?'files':'empty'};
 if(realpathSync(file)!==file||!lstatSync(file).isFile())throw new KTeamError('harness_storage_invalid');
 const db=new DatabaseSync(file,{readOnly:true});
 try{
  const counts=layers.map(([table])=>Number(db.prepare('SELECT count(*) AS count FROM '+table).get()?.count??0));
  const [table,column]=layers[layer]!,rows=db.prepare(`SELECT id,${column} AS content,created_at AS createdAt FROM ${table} ORDER BY created_at DESC,id DESC LIMIT 31 OFFSET ?`).all(offset);
  return {ok:true,backend:'layered',stats:{l0:counts[0],l1:counts[1],l2:counts[2],l3:counts[3],dbSizeBytes:statSync(file).size},entries:rows.slice(0,30).map(row=>({...row,content:String(row.content).slice(0,16000)})),hasMore:rows.length>30};
 }finally{db.close();}
}
