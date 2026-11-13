import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,realpathSync,lstatSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {KTeamError} from '../errors.js';
import type {HarnessSessionScope} from './harness-session.js';
const reviews=new Map<string,Set<string>>();
export function harnessLocation(scope:Pick<HarnessSessionScope,'root'|'botId'|'roomId'|'bindingRevision'|'fingerprint'>,cwd:string){const identity=createHash('sha256').update(JSON.stringify([scope.botId,scope.roomId,scope.bindingRevision,scope.fingerprint,cwd])).digest('hex');return {identity,directory:join(scope.root,'harness',identity)};}
/** The original runtime and memory reviewer share an OS-backed lock; a crash releases it. */
export function acquireHarnessStorage(directory:string){mkdirSync(directory,{recursive:true,mode:0o700});if(realpathSync(directory)!==directory||lstatSync(directory).isSymbolicLink())throw new KTeamError('harness_storage_invalid');const path=join(directory,'access-lock.sqlite');if(existsSync(path)){const stat=lstatSync(path);if(!stat.isFile()||stat.nlink!==1)throw new KTeamError('harness_storage_invalid');}const db=new DatabaseSync(path);try{db.exec('PRAGMA busy_timeout=0; BEGIN IMMEDIATE');}catch{db.close();throw new KTeamError('harness_session_busy',409);}let closed=false;return ()=>{if(!closed){closed=true;db.exec('ROLLBACK');db.close();}};}
export function beginMemoryReview(root:string,roomId:string){const rooms=reviews.get(root)??new Set<string>();if(rooms.has(roomId))throw new KTeamError('memory_review_busy',409);rooms.add(roomId);reviews.set(root,rooms);return ()=>{rooms.delete(roomId);if(!rooms.size)reviews.delete(root);};}
export const memoryReviewRooms=(root:string)=>[...(reviews.get(root)??[])];
