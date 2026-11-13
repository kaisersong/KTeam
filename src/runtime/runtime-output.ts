import {constants,openSync,closeSync,fstatSync,readSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {KTeamError} from '../errors.js';
/** Original model read tool: current private spill directory only, byte cursor on UTF-8 boundaries. */
export function runtimeOutputPage(directory:string,key:string,offset=0,bytes=16000){
 if(!/^[a-zA-Z0-9_-]{1,256}$/.test(key)||!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(bytes)||bytes<1||bytes>32000||realpathSync(directory)!==directory)throw new KTeamError('runtime_output_invalid');
 const fd=openSync(join(directory,key+'.txt'),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const before=fstatSync(fd);if(!before.isFile()||before.nlink!==1||before.size>32*1024*1024||offset>before.size)throw new KTeamError('runtime_output_invalid');
  const buffer=Buffer.alloc(Math.min(bytes,before.size-offset)),read=readSync(fd,buffer,0,buffer.length,offset);let count=read,content:string|undefined;
  for(let trimmed=0;trimmed<=3&&count>=0;trimmed++,count--){try{content=new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,count));break;}catch{}}
  if(content===undefined||count===0&&read>0)throw new KTeamError('runtime_output_invalid');
  const after=fstatSync(fd);if(after.nlink!==1||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)throw new KTeamError('runtime_output_invalid');
  return {text:content,offset,nextOffset:offset+count,hasMore:offset+count<before.size};
 }finally{closeSync(fd);}
}
