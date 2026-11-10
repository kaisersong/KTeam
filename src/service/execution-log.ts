import {mkdirSync,openSync,closeSync,writeSync,fstatSync,readdirSync,lstatSync,unlinkSync,constants} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {toolInputDisplay,toolResultDisplay} from '../runtime/tool-display.js';

/** Private diagnostic files: bounded independently of the conversation database. */
export class ExecutionLog{
 private directory:string;
 constructor(root:string){this.directory=join(root,'execution-logs');}
 append(jobId:string,event:any){
  try{
   mkdirSync(this.directory,{recursive:true,mode:0o700});
   const file=join(this.directory,createHash('sha256').update(jobId).digest('hex')+'.jsonl');
   const fd=openSync(file,constants.O_WRONLY|constants.O_APPEND|constants.O_CREAT|constants.O_NOFOLLOW,0o600);
   try{if(fstatSync(fd).size<2*1024*1024){const {id,name,type,state,startedAt,botId}=event;const record={id,name,type,state,startedAt,botId,code:event.code?String(event.code).slice(0,1024):undefined,input:toolInputDisplay(name,event.input),result:toolResultDisplay(name,event.result)};writeSync(fd,JSON.stringify(record)+'\n');}}finally{closeSync(fd);}
   const files=readdirSync(this.directory).filter(n=>/^[a-f0-9]{64}\.jsonl$/.test(n)).map(name=>({name,stat:lstatSync(join(this.directory,name))})).filter(f=>f.stat.isFile()).sort((a,b)=>b.stat.mtimeMs-a.stat.mtimeMs);
   for(const old of files.slice(50))unlinkSync(join(this.directory,old.name));
  }catch{/* Diagnostic storage must not turn a completed effect into a failure. */}
 }
}
