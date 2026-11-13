import {execFile} from 'node:child_process';
import {constants} from 'node:fs';
import {open} from 'node:fs/promises';
import {basename} from 'node:path';
import {fileURLToPath} from 'node:url';
/** Read only file URLs supplied by the OS clipboard, never paths supplied by renderer. */
export function clipboardFileURLs(text:string){
 const urls=text.replace(/\0/g,'\n').split(/[\r\n]+/).map(s=>s.trim()).filter(s=>s.startsWith('file:'));
 return [...new Set(urls.map(url=>fileURLToPath(url)))];
}
export async function clipboardFileBytes(paths:string[]){
 if(paths.length>4)throw Error('attachment_limit');
 const files=[];
 for(const path of paths){const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{const stat=await handle.stat();if(!stat.isFile())throw Error('attachment_invalid');if(stat.size>4*1024*1024)throw Error('library_file_too_large');const buffer=Buffer.alloc(stat.size+1),read=await handle.read(buffer,0,buffer.length,0),after=await handle.stat();if(read.bytesRead!==stat.size||after.size!==stat.size||after.mtimeMs!==stat.mtimeMs)throw Error('attachment_changed');files.push({name:basename(path),data:buffer.subarray(0,read.bytesRead).toString('base64')});}finally{await handle.close();}}
 return files;
}

export async function macClipboardPaths(bytes:Buffer):Promise<string[]>{
 if(!bytes.length)return [];if(bytes.length>128*1024)throw Error('attachment_limit');
 const output=await new Promise<string>((resolve,reject)=>{const child=execFile('/usr/bin/plutil',['-convert','json','-o','-','-'],{timeout:5000,maxBuffer:128*1024},(error,stdout)=>error?reject(error):resolve(stdout));child.stdin!.on('error',reject);child.stdin!.end(bytes);});
 const paths:unknown=JSON.parse(output);if(!Array.isArray(paths)||paths.some(path=>typeof path!=='string'||!path.startsWith('/')))throw Error('attachment_invalid');return [...new Set(paths as string[])];
}
