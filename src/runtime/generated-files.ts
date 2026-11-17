import {backfillGeneratedFiles} from './generated-file-receipts.js';
import {generatedFileExtension} from './generated-file-policy.js';
export {generatedFileExtension} from './generated-file-policy.js';
import {createHash} from 'node:crypto';
import {generatedFileHost,localGeneratedFileHost} from './generated-file-host.js';
import {basename,sep,resolve,extname} from 'node:path';
import {openSync,closeSync,readFileSync,fstatSync,realpathSync,constants} from 'node:fs';
import {KTeamError} from '../errors.js';
import type {TeamStore} from '../service/team-store.js';

function inspect(path:string,privateRoot:string){
 if(!generatedFileExtension(path)||realpathSync(path)!==path||path===resolve(privateRoot)||path.startsWith(resolve(privateRoot)+sep))throw new KTeamError('generated_file_forbidden',403);
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|(constants.O_NONBLOCK??0));
 try{const stat=fstatSync(fd);if(!stat.isFile()||stat.nlink!==1||stat.size>20*1024*1024)throw new KTeamError('generated_file_invalid');const content=readFileSync(fd);return {content,bytes:content.length,sha256:createHash('sha256').update(content).digest('hex')};}finally{closeSync(fd);}
}
export function captureGeneratedFile(path:string,privateRoot:string,roomId:string){const {content,...facts}=inspect(path,privateRoot);return {path,name:basename(path),roomId,hostId:generatedFileHost(privateRoot),...facts};}
// Only persisted successful tool receipts authorize opening; model-authored
// Markdown and renderer-supplied paths never grant native file access.
// The local receipt is the authority. hostId is a display-time network name,
// which macOS may change after a Bonjour collision; it is not machine identity.
// Every open still revalidates the canonical local path and exact saved bytes.
export function generatedFilePath(store:TeamStore,roomId:string,toolCallId:string){
 backfillGeneratedFiles(store);const records=store.generatedFilesForTool(roomId,toolCallId);if(records.length>1)throw new KTeamError('generated_file_receipt_changed',409);const file=records[0]?.facts.file;if(!file||file.roomId!==roomId||file.hostId?.startsWith('installation:')&&!localGeneratedFileHost(file.hostId,store.root))throw new KTeamError('generated_file_not_found',404);
 try{const actual=inspect(file.path,store.root);if(actual.sha256!==file.sha256||actual.bytes!==file.bytes)throw Error();}catch{throw new KTeamError('generated_file_changed',409);}
 return file.path as string;
}

/** Preview uses the same verified descriptor bytes, never a second renderer-directed read. */
export function generatedFilePreview(store:TeamStore,roomId:string,toolCallId:string){
 const path=generatedFilePath(store,roomId,toolCallId),file=store.generatedFilesForTool(roomId,toolCallId)[0]!.facts.file;
 let actual:ReturnType<typeof inspect>;try{actual=inspect(path,store.root);}catch{throw new KTeamError('generated_file_changed',409);}
 if(actual.sha256!==file.sha256||actual.bytes!==file.bytes)throw new KTeamError('generated_file_changed',409);
 const extension=extname(path).toLowerCase();
 const kind=extension==='.html'?'html':extension==='.md'?'markdown':['.txt','.csv','.json','.log'].includes(extension)?'text':['.png','.jpg','.jpeg','.gif','.webp'].includes(extension)?'image':'unsupported';
 const mime:Record<string,string>={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp'};
 const result={ok:true,name:basename(path),bytes:actual.bytes,kind,mediaType:mime[extension],content:kind==='unsupported'?'':kind==='image'?actual.content.toString('base64'):actual.content.toString('utf8')};
 // Leave room for the authenticated host response envelope (2 MiB limit).
 if(Buffer.byteLength(JSON.stringify(result))>1536*1024)return {...result,kind:'unsupported',content:'',reason:'preview_too_large'};
 return result;
}
