import {createHash} from 'node:crypto';
import {constants,openSync,closeSync,fstatSync,readSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {KTeamError,record,fields,text} from '../errors.js';
import type {Upstreams} from '../adapters/upstream.js';
import type {TeamStore} from './team-store.js';
import {BotCapabilities} from './bot-capabilities.js';
import {profile} from './bot-profile.js';
import {harnessWorkspace} from '../runtime/harness.js';
import {harnessLocation} from '../runtime/harness-storage.js';
import {sharedRuntime,modelIdentity} from '../runtime/native.js';
const MAX_BYTES=32*1024*1024;
const sha=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
/** Read only original runtime spills with host-recorded provenance, never a model path. */
export class ToolOutput {
 constructor(private upstream:Upstreams,private store:TeamStore){}
 private async scope(job:any,event:any){
  const botId=text(event.botId,'bot_id'),selected=await new BotCapabilities(this.upstream,this.store).scope(botId,job.roomId),binding=this.store.binding(botId);
  const bot=((await this.upstream.listBots()).agents as any[]).find(bot=>bot.id===botId&&!bot.archivedAt);
  if(!bot||binding?.kind!=='xiaok-hosted')throw new KTeamError('tool_output_scope_changed',409);
  const p=profile(bot),cwd=harnessWorkspace(p.workspace),location=harnessLocation({...selected.scope,bindingRevision:binding.revision,fingerprint:binding.fingerprint},cwd);
  if(location.identity!==event.output.scopeId||p.revision!==event.output.profileRevision||(await modelIdentity(binding.modelId)).fingerprint!==binding.fingerprint)throw new KTeamError('tool_output_scope_changed',409);
  return {...location,basis:JSON.stringify([selected.room.revision,binding.revision,binding.fingerprint,p.revision,cwd])};
 }
 async read(value:unknown){
  const input=record(value);fields(input,['roomId','jobId','eventId','offset']);
  const roomId=text(input.roomId,'room_id'),job=this.store.job(text(input.jobId,'job_id')),offset=input.offset??0;
  if(!Number.isSafeInteger(offset)||Number(offset)<0)throw new KTeamError('tool_output_invalid');
  if(!job||job.roomId!==roomId)throw new KTeamError('work_record_not_found',404);
  const event=(job.toolTrace??[]).find((event:any)=>event.id===text(input.eventId,'event_id')),ref=event?.output;
  if(event?.type!=='tool_output_saved'||ref?.v!==1||!sha(ref.scopeId)||!sha(ref.key)||!sha(ref.sha256)||ref.sessionId!=='kteam_'+ref.scopeId||!Number.isSafeInteger(ref.bytes)||ref.bytes<1||ref.bytes>MAX_BYTES||!Number.isSafeInteger(ref.profileRevision))throw new KTeamError('tool_output_not_saved',404);
  const initial=await this.scope(job,event),version=this.store.workRecordVersion(job.id);
  let content:string;
  try{
   const directory=join(initial.directory,'spill',ref.sessionId);
   if(realpathSync(directory)!==directory)throw new Error('linked');
   const fd=openSync(join(directory,ref.key+'.txt'),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
   try{
    const before=fstatSync(fd);if(!before.isFile()||before.nlink!==1||before.size!==ref.bytes)throw new Error('changed');
    const buffer=Buffer.alloc(before.size);let count=0;
    while(count<buffer.length){const size=readSync(fd,buffer,count,buffer.length-count,count);if(size===0)throw new Error('short');count+=size;}
    const after=fstatSync(fd);
    if(after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs||after.nlink!==1||createHash('sha256').update(buffer).digest('hex')!==ref.sha256)throw new Error('changed');
    content=new TextDecoder('utf-8',{fatal:true}).decode(buffer);
   }finally{closeSync(fd);}
  }catch{throw new KTeamError('tool_output_changed',409);}
  const core=await sharedRuntime(),safe=core.redactSecrets(content).text as string,start=Number(offset);
  if(start>safe.length||start>0&&start<safe.length&&/[\uDC00-\uDFFF]/.test(safe.charAt(start))&&/[\uD800-\uDBFF]/.test(safe.charAt(start-1)))throw new KTeamError('tool_output_invalid');
  let end=Math.min(safe.length,start+8192);if(end<safe.length&&/[\uD800-\uDBFF]/.test(safe.charAt(end-1)))end--;
  const current=await this.scope(job,event);
  if(current.basis!==initial.basis||this.store.workRecordVersion(job.id)!==version)throw new KTeamError('tool_output_scope_changed',409);
  return {ok:true,jobId:job.id,eventId:event.id,text:safe.slice(start,end),offset:start,nextOffset:end,hasMore:end<safe.length,totalCharacters:safe.length,originalBytes:ref.bytes,redacted:safe!==content};
 }
}
