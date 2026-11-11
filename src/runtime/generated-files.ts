import {backfillGeneratedFiles} from './generated-file-receipts.js';
import {generatedFileExtension} from './generated-file-policy.js';
export {generatedFileExtension} from './generated-file-policy.js';
import {createHash} from 'node:crypto';
import {hostname} from 'node:os';
import {basename,sep,resolve} from 'node:path';
import {openSync,closeSync,readFileSync,fstatSync,realpathSync,constants} from 'node:fs';
import {KTeamError} from '../errors.js';
import type {TeamStore} from '../service/team-store.js';

function inspect(path:string,privateRoot:string){
 if(!generatedFileExtension(path)||realpathSync(path)!==path||path===resolve(privateRoot)||path.startsWith(resolve(privateRoot)+sep))throw new KTeamError('generated_file_forbidden',403);
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|(constants.O_NONBLOCK??0));
 try{const stat=fstatSync(fd);if(!stat.isFile()||stat.nlink!==1||stat.size>20*1024*1024)throw new KTeamError('generated_file_invalid');return {bytes:stat.size,sha256:createHash('sha256').update(readFileSync(fd)).digest('hex')};}finally{closeSync(fd);}
}
export function captureGeneratedFile(path:string,privateRoot:string,roomId:string){return {path,name:basename(path),roomId,hostId:hostname(),...inspect(path,privateRoot)};}
// Only persisted successful tool receipts authorize opening; model-authored
// Markdown and renderer-supplied paths never grant native file access.
export function generatedFilePath(store:TeamStore,roomId:string,toolCallId:string){
 backfillGeneratedFiles(store);const records=store.generatedFilesForTool(roomId,toolCallId);if(records.length>1)throw new KTeamError('generated_file_receipt_changed',409);const file=records[0]?.facts.file;if(!file||file.roomId!==roomId||file.hostId!==hostname())throw new KTeamError('generated_file_not_found',404);
 try{const actual=inspect(file.path,store.root);if(actual.sha256!==file.sha256||actual.bytes!==file.bytes)throw Error();}catch{throw new KTeamError('generated_file_changed',409);}
 return file.path as string;
}
