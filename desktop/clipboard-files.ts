import {execFile} from 'node:child_process';
import {constants} from 'node:fs';
import {open,lstat} from 'node:fs/promises';
import {basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {KTeamError} from '../src/errors.js';

const maxPathPayload=128*1024;
/** Read only file URLs supplied by the OS clipboard, never paths supplied by renderer. */
export function clipboardFileURLs(text:string){
 const urls=text.replace(/\0/g,'\n').split(/[\r\n]+/).map(s=>s.trim()).filter(s=>s.startsWith('file:'));
 return [...new Set(urls.map(url=>fileURLToPath(url)))];
}
export async function clipboardFileBytes(paths:string[]){
 if(paths.length>4)throw new KTeamError('attachment_limit');
 const files=[];
 for(const path of paths){const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{const stat=await handle.stat();if(!stat.isFile())throw new KTeamError('attachment_invalid');if(stat.size>4*1024*1024)throw new KTeamError('library_file_too_large');const buffer=Buffer.alloc(stat.size+1),read=await handle.read(buffer,0,buffer.length,0),after=await handle.stat();if(read.bytesRead!==stat.size||after.size!==stat.size||after.mtimeMs!==stat.mtimeMs)throw new KTeamError('attachment_changed');files.push({name:basename(path),data:buffer.subarray(0,read.bytesRead).toString('base64')});}finally{await handle.close();}}
 return files;
}

export async function macClipboardPaths(bytes:Buffer):Promise<string[]>{
 if(!bytes.length)return [];
 if(bytes.length>maxPathPayload)throw new KTeamError('clipboard_paths_too_large');
 const output=await new Promise<string>((resolve,reject)=>{const child=execFile('/usr/bin/plutil',['-convert','json','-o','-','-'],{timeout:5000,maxBuffer:128*1024},(error,stdout)=>error?reject(error):resolve(stdout));child.stdin!.on('error',reject);child.stdin!.end(bytes);});
 const paths:unknown=JSON.parse(output);if(!Array.isArray(paths)||paths.some(path=>typeof path!=='string'||!path.startsWith('/')))throw new KTeamError('attachment_invalid');return [...new Set(paths as string[])];
}

/** Electron 44+ returns a lazy MIME snapshot; keep OS paths and bytes in main. */
export async function clipboardPaste(items:ReadonlyArray<{types:readonly string[];getType(type:string):Promise<unknown>}>,platform=process.platform,allowFiles=true){
 const payload=async(item:typeof items[number],type:string,limit:number,limitCode:string)=>{
  const blob=await item.getType(type);
  if(!(blob instanceof Blob))throw new KTeamError('attachment_invalid');
  if(blob.size>limit)throw new KTeamError(limitCode);
  return Buffer.from(await blob.arrayBuffer());
 };
 const raw=(item:typeof items[number],format:string)=>item.types.find(type=>type===`electron application/osclipboard;format="${format}"`||type===`electron application/osclipboard;format=${format}`);
 const pathPayload=(item:typeof items[number],type:string)=>payload(item,type,maxPathPayload,'clipboard_paths_too_large');
 const paths:string[]=[];
 // Electron's URI list contains all native Finder items in selection order.
 for(const item of items){
  if(item.types.includes('text/uri-list'))paths.push(...clipboardFileURLs((await pathPayload(item,'text/uri-list')).toString('utf8')));
 }
 if(!paths.length&&platform==='darwin')for(const item of items){
  const finder=raw(item,'NSFilenamesPboardType');
  if(finder)paths.push(...await macClipboardPaths(await pathPayload(item,finder)));
 }
 if(!paths.length&&platform==='darwin')for(const item of items){
  const type=raw(item,'public.file-url');
  if(type)paths.push(...clipboardFileURLs((await pathPayload(item,type)).toString('utf8')));
 }
 if(!paths.length&&platform==='win32')for(const item of items){
  const type=raw(item,'FileNameW');
  if(type)paths.push(...(await pathPayload(item,type)).toString('utf16le').split('\0').filter(Boolean));
 }
 const directories:string[]=[],regular:string[]=[];
 for(const path of new Set(paths)){
  const stat=await lstat(path);
  if(stat.isDirectory())directories.push(path);
  else if(stat.isFile())regular.push(path);
  else throw new KTeamError('attachment_invalid');
 }
 if(regular.length&&!allowFiles)throw new KTeamError('attachment_owner_required');
 const files=await clipboardFileBytes(regular);
 if(!paths.length)for(const item of items)if(item.types.includes('image/png')){
  if(!allowFiles)throw new KTeamError('attachment_owner_required');
  const bytes=await payload(item,'image/png',4*1024*1024,'library_file_too_large');
  if(bytes.length)files.push({name:'粘贴图片.png',data:bytes.toString('base64')});
  break;
 }
 return {files,directories};
}

/** Compatibility for consumers that only need uploaded file bytes. */
export async function clipboardAttachments(items:Parameters<typeof clipboardPaste>[0],platform=process.platform){return (await clipboardPaste(items,platform)).files;}
