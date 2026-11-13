import {createHash} from 'node:crypto';
import {mkdirSync,realpathSync,existsSync,openSync,closeSync,fstatSync,readSync,writeFileSync,constants} from 'node:fs';
import {join} from 'node:path';
import {KTeamError,fields,record,text} from '../errors.js';
import type {Upstreams} from '../adapters/upstream.js';
import type {TeamStore} from './team-store.js';
import {BotCapabilities} from './bot-capabilities.js';
import {profile} from './bot-profile.js';
import {sharedRuntime} from '../runtime/native.js';
import {skillBindingRoot,withSkillMutation,type SkillScope} from '../runtime/skill-library.js';

const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
interface Source {botId:string;roomId:string;jobId:string;originId:string}
/** Drafts and file-effect receipts over the existing work/asset owners. */
export class SkillLearning {
 private capabilities:BotCapabilities;
 constructor(private upstream:Upstreams,private store:TeamStore){this.capabilities=new BotCapabilities(upstream,store);}
 private async method(value:unknown){
  const input=record(value);fields(input,['name','description','body']);
  const name=text(input.name,'skill_name',64),description=text(input.description,'skill_description',256).trim(),body=text(input.body,'skill_body',12000).trim();
  if(!/^[a-z][a-z0-9-]{2,63}$/.test(name)||/[\r\n\x00-\x1f]/.test(description)||!description||!body||body.includes('\0'))throw new KTeamError('skill_learning_input_invalid');
  const core=await sharedRuntime();if(core.redactSecrets(description+'\n'+body).text!==description+'\n'+body)throw new KTeamError('skill_learning_secret',403);
  return {name,description,body,raw:'---\nname: '+name+'\ndescription: '+JSON.stringify(description)+'\n---\n'+body+'\n'};
 }
 private async source(source:Source,requireDelivery=false,context?:{loaded:any;message:(id:string)=>Promise<any>;tasks:()=>Promise<any[]>}){
  const loaded=context?.loaded??await this.capabilities.catalog(source.botId,source.roomId),binding=this.store.binding(source.botId),job=this.store.job(source.jobId);
  if(binding?.kind!=='xiaok-hosted')throw new KTeamError('bot_skills_external',409);
  if(!job||job.roomId!==source.roomId||job.originId!==source.originId||job.trigger||!((job.members??[]).includes(source.botId)||job.activeBotId===source.botId))throw new KTeamError('skill_learning_source_changed',409);
  const origin=(context?await context.message(source.originId):(await this.upstream.conversationMessage(source.roomId,source.originId)).message) as any;
  if(origin.sender?.kind!=='user')throw new KTeamError('skill_learning_source_changed',409);
  const result=job.results?.find((result:any)=>result.botId===source.botId);let message:any;
  if(job.state==='delivered'&&result){
   message=context?await context.message(result.messageId):(await this.upstream.conversationMessage(source.roomId,result.messageId)).message;
   const tasks=context?await context.tasks():(await this.upstream.aimp(source.roomId,'tasks')).tasks as any[],task=tasks.find(task=>task.taskRef===result.taskRef);
   if(!task?.artifactVerification?.verified||!['delivered','accepted'].includes(task.state)||message.sender?.logicalAgentId!==source.botId||message.sourceRef?.taskRef!==result.taskRef)throw new KTeamError('skill_learning_source_changed',409);
  }
  if(requireDelivery&&!message)throw new KTeamError('skill_learning_source_pending',409);
  const version=hash(JSON.stringify([source,loaded.room.revision,profile(loaded.bot).revision,binding.revision,binding.fingerprint,job.state,result?.messageId,result?.taskRef]));
  return {...loaded,version,job,message,originMessageId:source.originId,resultMessageId:message?.messageId,sourceState:job.state};
 }
 private entry(botId:string,roomId:string,id:unknown){const key=text(id,'learning_id',256),op=this.store.operation(key);if(!key.startsWith('skill-learning:')||!op||op.botId!==botId||op.roomId!==roomId)throw new KTeamError('skill_learning_not_found',404);return op;}
 private directory(scope:SkillScope){const root=skillBindingRoot(scope);mkdirSync(root,{recursive:true,mode:0o700});if(realpathSync(root)!==root)throw new KTeamError('skill_learning_path_invalid',403);const skills=join(root,'skills');mkdirSync(skills,{recursive:true,mode:0o700});if(realpathSync(skills)!==skills)throw new KTeamError('skill_learning_path_invalid',403);return root;}
 private file(path:string){try{if(realpathSync(path)!==path)throw new KTeamError('skill_learning_file_changed',409);const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{const stat=fstatSync(fd);if(!stat.isFile()||stat.nlink!==1||stat.size>64*1024)throw new KTeamError('skill_learning_file_changed',409);const buffer=Buffer.alloc(stat.size+1),count=readSync(fd,buffer,0,buffer.length,0),after=fstatSync(fd);if(count!==stat.size||stat.ino!==after.ino||stat.dev!==after.dev||stat.size!==after.size||stat.mtimeMs!==after.mtimeMs||after.nlink!==1||realpathSync(path)!==path)throw new KTeamError('skill_learning_file_changed',409);return hash(buffer.subarray(0,count));}finally{closeSync(fd);}}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;if(error instanceof KTeamError)throw error;throw new KTeamError('skill_learning_file_changed',409);}}
 private settle(op:any,scope:SkillScope){
  if(!['applying','reverting','unknown'].includes(op.status))return op;
  const actual=this.file(join(this.directory(scope),'skills',op.reviewed.name+'.md'));
  if(actual===op.fileSha256)return this.store.saveOperation({...op,status:'saved',reconciledAt:Date.now()},op.revision);
  if(actual===undefined)return this.store.saveOperation({...op,status:op.action==='undo'?'undone':'not_saved',reconciledAt:Date.now()},op.revision);
  return {...op,status:'unknown'};
 }
 async propose(source:Source,value:unknown,assertCurrent:()=>Promise<void>){
  await assertCurrent();await this.source(source);const method=await this.method(value),id='skill-learning:'+hash(JSON.stringify([source,method.name])),old=this.store.operation(id),intent=hash(method.raw);
  if(old){if(old.intent!==intent)throw new KTeamError('skill_learning_conflict',409);return {ok:true,candidateId:id,status:old.status,reused:true};}
  if(this.store.learningPendingCount(source.botId,source.roomId)>=20||this.store.learningRecords(source.botId,source.roomId).filter(op=>op.jobId===source.jobId).length>=2)throw new KTeamError('skill_learning_limit',409);
  await assertCurrent();this.store.saveOperation({...source,id,status:'proposed',intent,method:{name:method.name,description:method.description,body:method.body},createdAt:Date.now()},0);
  return {ok:true,candidateId:id,status:'proposed',reviewRequired:true,message:'已保存方法候选；原工作有可核实答复后，本人可在成员的学习候选页审阅保存。候选未安装、未授予权限。'};
 }
 tools(source:Source,assertCurrent:()=>Promise<void>){return [{permission:'safe',definition:{name:'propose_skill',description:'把本轮形成的可复用工作方法提出为待本人审阅的技能候选。只保存当前 Bot/会话的草稿，不安装、不改权限。仅保留方法与验收步骤，不含凭据或私人原文。原工作交付后本人可编辑、保存或忽略。',inputSchema:{type:'object',additionalProperties:false,required:['name','description','body'],properties:{name:{type:'string',pattern:'^[a-z][a-z0-9-]{2,63}$'},description:{type:'string',maxLength:256},body:{type:'string',maxLength:12000}}}},execute:(value:unknown)=>this.propose(source,value,assertCurrent)}];}
 async list(botId:string,roomId?:string){
  await this.capabilities.scope(botId,roomId);if(this.store.binding(botId)?.kind!=='xiaok-hosted')return {ok:true,supported:false,items:[],reason:'请在原 Agent 中管理学习方法。'};const loaded=await this.capabilities.catalog(botId,roomId);
  return withSkillMutation(loaded.scope,async()=>{const items=[],messages=new Map<string,Promise<any>>();let tasks:Promise<any[]>|undefined;const context={loaded,message:(id:string)=>{let value=messages.get(id);if(!value){value=this.upstream.conversationMessage(loaded.scope.roomId,id).then(result=>result.message);messages.set(id,value);}return value;},tasks:()=>tasks??=(this.upstream.aimp(loaded.scope.roomId,'tasks').then(result=>result.tasks as any[]))};for(const recorded of this.store.learningRecords(botId,loaded.scope.roomId)){
   const op=this.settle(recorded,loaded.scope);let source:any,sourceError:string|undefined;try{source=await this.source(op,false,context);}catch(error){sourceError=error instanceof KTeamError?error.code:'skill_learning_source_unavailable';}
   items.push({id:op.id,revision:op.revision,status:op.status,createdAt:op.createdAt,method:op.reviewed??op.method,fileSha256:op.fileSha256,source:source?{version:source.version,state:source.sourceState,originMessageId:source.originMessageId,resultMessageId:source.resultMessageId}:undefined,sourceError,canSave:!!source?.message&&['proposed','not_saved'].includes(op.status),canUndo:op.status==='saved'});
  }await this.capabilities.scope(botId,loaded.scope.roomId);return {ok:true,supported:true,roomId:loaded.scope.roomId,roomTitle:loaded.room.title,items};});
 }
 async save(value:unknown){
  const input=record(value);fields(input,['botId','roomId','id','expectedRevision','expectedSourceVersion','name','description','body']);const botId=text(input.botId,'bot_id'),roomId=text(input.roomId,'room_id'),selected=await this.capabilities.scope(botId,roomId);
  return withSkillMutation(selected.scope,async()=>{
   let op=this.entry(botId,roomId,input.id);const method=await this.method({name:input.name,description:input.description,body:input.body}),intent=hash(method.raw);
   op=this.settle(op,selected.scope);if(op.status==='saved'&&op.fileSha256===intent&&this.file(join(this.directory(selected.scope),'skills',method.name+'.md'))===intent)return {ok:true,reused:true,status:'saved',id:op.id};
   if(op.revision!==input.expectedRevision||!['proposed','not_saved'].includes(op.status))throw new KTeamError('skill_learning_changed',409);
   const source=await this.source(op,true);if(source.version!==input.expectedSourceVersion)throw new KTeamError('skill_learning_source_changed',409);if(source.catalog.get(method.name))throw new KTeamError('skill_learning_name_exists',409);
   const root=this.directory(source.scope),target=join(root,'skills',method.name+'.md');if(existsSync(target))throw new KTeamError('skill_learning_name_exists',409);
   const payloads=join(root,'learning-payloads');mkdirSync(payloads,{mode:0o700,recursive:true});if(realpathSync(payloads)!==payloads)throw new KTeamError('skill_learning_path_invalid',403);const payload=join(payloads,intent+'.md');if(this.file(payload)!==undefined){if(this.file(payload)!==intent)throw new KTeamError('skill_learning_file_changed',409);}else writeFileSync(payload,method.raw,{flag:'wx',mode:0o600});
   const core=await sharedRuntime(),latest=await this.source(op,true);if(latest.version!==source.version)throw new KTeamError('skill_learning_source_changed',409);if(latest.catalog.get(method.name)||existsSync(target))throw new KTeamError('skill_learning_name_exists',409);
   op=this.store.saveOperation({...op,status:'applying',action:'save',reviewed:{name:method.name,description:method.description,body:method.body},fileSha256:intent},op.revision);
   try{await core.createInstallSkillTool({cwd:root,configDir:root}).execute({source:payload,scope:'global'},{});if(this.file(target)!==intent)throw new KTeamError('skill_learning_install_unknown',409);op=this.store.saveOperation({...op,status:'saved',savedAt:Date.now()},op.revision);return {ok:true,id:op.id,status:'saved',fileSha256:intent};}
   catch(error){this.settle(op,source.scope);throw error;}
  });
 }
 async dismiss(value:unknown){const input=record(value);fields(input,['botId','roomId','id','expectedRevision']);const botId=text(input.botId,'bot_id'),roomId=text(input.roomId,'room_id'),selected=await this.capabilities.scope(botId,roomId);return withSkillMutation(selected.scope,async()=>{const op=this.entry(botId,roomId,input.id);if(op.status==='dismissed')return {ok:true,reused:true};if(op.revision!==input.expectedRevision||!['proposed','not_saved'].includes(op.status))throw new KTeamError('skill_learning_changed',409);this.store.saveOperation({...op,status:'dismissed'},op.revision);return {ok:true};});}
 async undo(value:unknown){
  const input=record(value);fields(input,['botId','roomId','id','expectedRevision']);const botId=text(input.botId,'bot_id'),roomId=text(input.roomId,'room_id'),selected=await this.capabilities.scope(botId,roomId);
  return withSkillMutation(selected.scope,async()=>{let op=this.entry(botId,roomId,input.id);op=this.settle(op,selected.scope);if(op.status==='undone')return {ok:true,reused:true};if(op.revision!==input.expectedRevision||op.status!=='saved')throw new KTeamError('skill_learning_changed',409);const root=this.directory(selected.scope),target=join(root,'skills',op.reviewed.name+'.md');if(this.file(target)!==op.fileSha256)throw new KTeamError('skill_learning_file_changed',409);
   const core=await sharedRuntime(),issues:any[]=[],discovered=await core.discoverSkills(root,root,{builtinRoots:[],onDiscoveryIssue:(issue:any)=>issues.push(issue)}),matches=discovered.filter((skill:any)=>skill.source==='global'&&skill.name===op.reviewed.name);if(issues.length||matches.length!==1||matches[0].path!==target)throw new KTeamError('skill_learning_file_changed',409);
   await this.capabilities.scope(botId,roomId);op=this.store.saveOperation({...op,status:'reverting',action:'undo'},op.revision);try{await core.createUninstallSkillTool({cwd:root,configDir:root}).execute({name:op.reviewed.name,scope:'global'},{});if(this.file(target)!==undefined)throw new KTeamError('skill_learning_install_unknown',409);this.store.saveOperation({...op,status:'undone',undoneAt:Date.now()},op.revision);return {ok:true,status:'undone'};}catch(error){this.settle(op,selected.scope);throw error;}
  });
 }
}
