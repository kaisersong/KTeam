import {createHash,randomUUID} from 'node:crypto';
import {Upstreams} from '../adapters/upstream.js';
import {KTeamError,fields,record,text} from '../errors.js';
import {TeamStore,type Binding} from './team-store.js';
import {modelCatalog,modelIdentity} from '../runtime/native.js';
import {CollaborationService,LOCAL_HUMAN} from './collaboration.js';
import {intentHash} from '../protocol/aimp.js';

export function normalizeTeamTitle(value:string){return value.trim().replace(/^(?:请)?(?:帮我|给我)?(?:创建|组建|建立|新建)(?:一[个支])?\s*/,'').replace(/(?:的)?(?:创建|组建)$/,'').trim()||value.trim();}
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
type Identity={model:string;fingerprint:string};
type Models={catalog:()=>Promise<{defaultModelId:string}>;identity:(id:string)=>Promise<Identity>};
type Member={botId:string;name:string;modelId:string;model:string;fingerprint:string;existing:boolean;unbound?:boolean;external?:{driver:string};bindingRevision?:number};
export type Proposal={id:string;hash:string;roomId:string;threadId:string;originId:string;botId:string;runId:string;bindingRevision:number;fingerprint:string;expiresAt:number;title:string;goal:string;members:Member[];firstMessage:string;startDiscussion:boolean};
export type AgentContext={requestSource:'agent';roomId:string;threadId:string;originId:string;botId:string;runId:string;admission:Record<string,unknown>};
/** Coordinates existing owners. Every external mutation has a durable intent and a read-only recovery path. */
export class TeamCoordinator{
 private pending=new Map<string,Promise<any>>();
 constructor(private upstream:Upstreams,private store:TeamStore,private hostFence:number,private models:Models={catalog:modelCatalog,identity:modelIdentity},private now=Date.now){}
 private user(ctx:{requestSource:string}){if(ctx.requestSource!=='user')throw new KTeamError('user_action_required',403);}
 private single<T>(id:string,action:()=>Promise<T>):Promise<T>{const prior=this.pending.get(id);if(prior)return prior;const promise=action().finally(()=>{if(this.pending.get(id)===promise)this.pending.delete(id);});this.pending.set(id,promise);return promise;}
 private claim(id:string,data:unknown){const previous=this.store.operation(id);if(previous?.status==='complete')return previous;if(previous&&previous.ownerFence>this.hostFence)throw new KTeamError('operation_owner_changed',409);return this.store.saveOperation({...previous,id,data:previous?.data??data,ownerFence:this.hostFence,claimId:randomUUID(),stages:previous?.stages??{}},previous?.revision??0);}
 private check(op:any){const current=this.store.operation(op.id);if(current?.revision!==op.revision||current?.claimId!==op.claimId||current?.ownerFence!==this.hostFence)throw new KTeamError('operation_owner_changed',409);}
 private save(op:any){this.check(op);const next=this.store.saveOperation(op,op.revision);Object.assign(op,next);}
 private async stage(op:any,key:string,read:()=>Promise<any|null>,write:()=>Promise<any>,validate:()=>Promise<void>){
  this.check(op);if(op.stages[key]?.state==='done'){await validate();this.check(op);const current=await read();await validate();this.check(op);if(!current)throw new KTeamError('operation_receipt_missing',409,{stage:key});return current;}
  await validate();this.check(op);
  const found=await read();await validate();this.check(op);
  if(found){op.stages[key]={state:'done',receipt:found};this.save(op);return found;}
  if(op.stages[key])throw new KTeamError('operation_result_unknown',409,{stage:key});
  await this.upstream.requireReady();await validate();this.check(op);
  op.stages[key]={state:'intent'};this.save(op);
  let receipt;try{receipt=await write();}catch(error){throw new KTeamError('operation_result_unknown',503,{stage:key,cause:error instanceof KTeamError?error.code:'upstream_unavailable'});}
  this.check(op);op.stages[key]={state:'done',receipt};this.save(op);await validate();return receipt;
 }
 private async frozen(member:Member){if(member.unbound){if(this.store.binding(member.botId))throw new KTeamError('model_binding_changed',409);return;}const identity=await this.models.identity(member.modelId);if(identity.fingerprint!==member.fingerprint||identity.model!==member.model)throw new KTeamError('model_binding_changed',409);if(member.existing){const binding=this.store.binding(member.botId);if(!binding||binding.revision!==member.bindingRevision||binding.fingerprint!==member.fingerprint)throw new KTeamError('model_binding_changed',409);}}
 private async ensureMember(op:any,member:Member,index:number,validate:()=>Promise<void>){
  const verify=(agent:any)=>{if(!agent||agent.archivedAt||agent.name!==member.name||(!member.existing&&member.external&&(agent.runtimeType!==member.external.driver||agent.runtimeSource!=='kteam-external-agent'))||(!member.existing&&!member.unbound&&(agent.runtimeType!=='xiaok'||agent.runtimeSource!=='desktop-agent-runtime')))throw new KTeamError('member_identity_changed',409);if(!member.existing&&(agent.provisioning?.operationId!==op.id+':member:'+index))throw new KTeamError('member_identity_changed',409);return {botId:agent.id};};
  await this.stage(op,'member:'+index,async()=>{const agents=(await this.upstream.listBots()).agents as any[];const agent=agents.find(a=>a.id===member.botId);return agent?verify(agent):null;},async()=>{if(member.existing)throw new KTeamError('agent_not_found',404);return verify(record((await this.upstream.createBot({id:member.botId,name:member.name,description:'KTeam 团队成员',runtimeType:member.external?.driver??'xiaok',runtimeSource:member.external?'kteam-external-agent':'desktop-agent-runtime',capabilities:[],maxConcurrentTasks:1,provisioning:{operationId:op.id+':member:'+index,roleKey:'kteam-member'}})).agent));},validate);
  await validate();this.check(op);if(!member.existing&&!member.unbound){const prior=this.store.binding(member.botId);if(prior&&(prior.modelId!==member.modelId||prior.fingerprint!==member.fingerprint))throw new KTeamError('model_binding_changed',409);if(!prior)this.store.bind({botId:member.botId,modelId:member.modelId,fingerprint:member.fingerprint,model:member.model,revision:1,kind:'xiaok-hosted'});}
 }
 private verifyRoom(result:any,roomId:string,title:string,goal:string,members:Member[]){
  const room=result.room,active=result.members.filter((m:any)=>m.status==='active'),ids=active.filter((m:any)=>m.subject.kind==='agent').map((m:any)=>m.subject.logicalAgentId).sort();
  if(room?.roomId!==roomId||room.status!=='active'||room.title!==title||room.description!==goal||active.length!==members.length+1||JSON.stringify(ids)!==JSON.stringify(members.map(m=>m.botId).sort())||!active.some((m:any)=>m.role==='owner'&&m.subject.kind==='user'&&m.subject.userId==='user.local'))throw new KTeamError('conversation_identity_changed',409);
  return {roomId};
 }
 async guardConversation(roomId:string,snapshot?:any){
  const settings=this.store.settings(roomId);if(!settings||!['assistant','direct'].includes(settings.kind??''))return undefined;
  const frozen=this.store.state<any>('conversation:'+roomId);if(!frozen)throw new KTeamError('conversation_identity_changed',409);
  const actual=snapshot??await this.upstream.membership(roomId);
  this.verifyRoom(actual,roomId,frozen.title,frozen.goal,frozen.members);
  for(const member of frozen.members)await this.frozen(member);
  return Number(actual.room.revision);
 }
 private async room(op:any,title:string,goal:string,members:Member[],kind:'assistant'|'direct'|'group',validate:()=>Promise<void>){
  const key=kind==='direct'?'kteam:direct:'+members[0]!.botId:'kteam:'+op.id,roomId='room-'+hash(['user','user.local',key]).slice(0,32);
  const verify=(result:any)=>this.verifyRoom(result,roomId,title,goal,members);
  await this.stage(op,'room',async()=>{try{return verify(await this.upstream.membership(roomId));}catch(error){if(error instanceof KTeamError&&error.code==='room_not_found')return null;throw error;}},async()=>verify(await this.upstream.createTeam({title,description:goal,memberAgentIds:members.map(m=>m.botId),clientRequestKey:key})),validate);
  await this.stage(op,'contract',async()=>{const session=(await this.upstream.aimp(roomId,'session')).session as any;if(!session)return null;if(session.goal!==goal||session.maxRuns!==6||JSON.stringify(session.allowedActions)!==JSON.stringify(['discussion']))throw new KTeamError('conversation_contract_changed',409);return {roomId,revision:session.revision};},async()=>{const s=(await this.upstream.aimp(roomId,'configure',{goal,expectedRevision:0,allowedActions:['discussion'],maxRuns:6})).session as any;return {roomId,revision:s.revision};},validate);
  await validate();this.check(op);if(!this.store.settings(roomId))this.store.configure({roomId,goal,kind,...(kind==='group'?{goalConfirmed:false}:{}),...(kind!=='group'&&members.every(m=>m.external)?{delivery:'external-agent' as const}:{}),mode:'auto',paused:false,quiet:false,revision:0,maxRuns:6,dailyCalls:20},0);
  if(kind==='assistant'||kind==='direct')this.store.stateOnce('conversation:'+roomId,{title,goal,members,kind});
  if(kind==='direct')this.store.stateOnce('direct-room:'+members[0]!.botId,{roomId});
  return roomId;
 }
 async bootstrap(ctx:{requestSource:string},options?:{name:string;modelId?:string}):Promise<{roomId:string;botId:string}>{
  this.user(ctx);const operationId='assistant:'+this.store.installationId();return this.single(operationId,async()=>{
   let op=this.store.operation(operationId);if(op?.status==='complete'){await this.guardConversation(op.receipt.roomId);return op.receipt;}
   if(!op){const displayName=options?.name?.trim()??'小K';if(!displayName||displayName.length>60)throw new KTeamError('invalid_member_name');const modelId=options?.modelId??(await this.models.catalog()).defaultModelId,identity=await this.models.identity(modelId);op=this.claim(operationId,{member:{botId:'kteam-'+hash(operationId).slice(0,24),name:displayName+' · KTeam '+this.store.installationId().slice(0,6),modelId,model:identity.model,fingerprint:identity.fingerprint,existing:false},title:displayName});}else op=this.claim(operationId,op.data);
   const member:Member=op.data.member,validate=()=>this.frozen(member);await validate();await this.ensureMember(op,member,0,validate);const roomId=await this.room(op,op.data.title??'小K','理解你的目标，组织合适的成员，一起把事情向前推进。',[member],'assistant',validate);op.status='complete';op.receipt={roomId,botId:member.botId};this.save(op);return op.receipt;
  });
 }
 private async scope(proposal:Proposal){
  const assistant=this.store.operation('assistant:'+this.store.installationId())?.receipt;
  if(assistant?.roomId!==proposal.roomId||assistant?.botId!==proposal.botId||this.store.settings(proposal.roomId)?.kind!=='assistant')throw new KTeamError('proposal_scope_mismatch',403);
  const binding=this.store.binding(proposal.botId);if(!binding||binding.revision!==proposal.bindingRevision||binding.fingerprint!==proposal.fingerprint)throw new KTeamError('model_binding_changed',409);
  await this.frozen({...binding,name:'',existing:true,bindingRevision:binding.revision});
  const snapshot=await this.upstream.getTeam(proposal.roomId);await this.guardConversation(proposal.roomId,snapshot);const origin=(snapshot.messages as any[]).find(m=>m.messageId===proposal.originId);
  if(!origin||origin.sender?.kind!=='user'||origin.threadId!==proposal.threadId)throw new KTeamError('proposal_scope_mismatch',403);
  const member=(snapshot.members as any[]).find(m=>m.status==='active'&&m.subject?.logicalAgentId===proposal.botId);if(!member)throw new KTeamError('proposal_scope_mismatch',403);
 }
 async propose(value:unknown,ctx:AgentContext):Promise<Proposal>{
  if(ctx.requestSource!=='agent')throw new KTeamError('agent_context_required',403);
  const input=record(value);fields(input,['title','goal','members']);const title=normalizeTeamTitle(text(input.title,'title',80)),goal=typeof input.goal==='string'&&input.goal.length<=8192?input.goal.trim():'';
  if(!Array.isArray(input.members)||input.members.length<1||input.members.length>5)throw new KTeamError('invalid_members');
  const previous=this.store.proposalForRun(ctx.runId);if(previous)return previous;
  const binding=this.store.binding(ctx.botId);if(!binding)throw new KTeamError('proposal_scope_mismatch',403);
  const proposalId='proposal-'+hash([ctx.roomId,ctx.runId]).slice(0,32),operationId='accept:'+proposalId;
  const proposal:Proposal={id:proposalId,hash:'',roomId:ctx.roomId,threadId:ctx.threadId,originId:ctx.originId,botId:ctx.botId,runId:ctx.runId,bindingRevision:binding.revision,fingerprint:binding.fingerprint,expiresAt:this.now()+30*60*1000,title,goal,members:[],firstMessage:goal,startDiscussion:false};
  await this.scope(proposal);await this.upstream.aimp(ctx.roomId,'execution-check',ctx.admission);
  const agents=(await this.upstream.listBots()).agents as any[];
  for(const [index,item] of input.members.entries()){
   const value=record(item);fields(value,['name','existingBotId']);let name=text(value.name,'member_name',60).trim();const existing=value.existingBotId?agents.find(a=>a.id===value.existingBotId):agents.find(a=>a.name===name&&this.store.binding(a.id));
   if(existing){const b=this.store.binding(existing.id);if(!b||existing.archivedAt||existing.id===ctx.botId)throw new KTeamError('invalid_member');proposal.members.push({botId:existing.id,name:existing.name,modelId:b.modelId,model:b.model,fingerprint:b.fingerprint,bindingRevision:b.revision,existing:true});}
   else{if(value.existingBotId)throw new KTeamError('agent_not_found',404);if(agents.some(a=>a.name===name))name+=' · KTeam '+proposalId.slice(-6);proposal.members.push({botId:'kteam-'+hash(operationId+':member:'+index).slice(0,24),name,modelId:binding.modelId,model:binding.model,fingerprint:binding.fingerprint,existing:false});}
  }
  if(new Set(proposal.members.map(m=>m.name)).size!==proposal.members.length||new Set(proposal.members.map(m=>m.botId)).size!==proposal.members.length)throw new KTeamError('duplicate_member');
  await this.scope(proposal);for(const member of proposal.members)await this.frozen(member);await this.upstream.aimp(ctx.roomId,'execution-check',ctx.admission);proposal.hash=hash({...proposal,hash:undefined});return this.store.saveProposal(proposal);
 }
 async accept(input:{roomId:string;proposalId:string;expectedHash:string},ctx:{requestSource:string}):Promise<{roomId:string}>{
  this.user(ctx);fields(record(input),['roomId','proposalId','expectedHash']);const p=this.store.proposal(input.proposalId) as Proposal|null;if(!p)throw new KTeamError('proposal_not_found',404);if(p.roomId!==input.roomId)throw new KTeamError('proposal_scope_mismatch',403);if(p.hash!==input.expectedHash)throw new KTeamError('proposal_changed',409);
  return this.single('accept:'+p.id,async()=>{let op=this.store.operation('accept:'+p.id);if(op?.status==='complete')return op.receipt;
   const validate=async()=>{if(p.expiresAt<=this.now())throw new KTeamError('proposal_expired',409);await this.scope(p);for(const member of p.members)await this.frozen(member);};await validate();op=this.claim('accept:'+p.id,{proposalId:p.id,hash:p.hash});
   for(const [index,member] of p.members.entries())await this.ensureMember(op,member,index,validate);
   const roomId=await this.room(op,p.title,p.goal||'尚未设定目标',p.members,'group',validate);
   op.status='complete';op.receipt={roomId};this.save(op);return op.receipt;
  });
 }
 async direct(botId:string,ctx:{requestSource:string}){this.user(ctx);return this.single('direct:'+botId,async()=>{const canonical=this.store.state<any>('direct-room:'+botId);if(canonical){await this.guardConversation(canonical.roomId);return canonical;}const binding=this.store.binding(botId),agent=((await this.upstream.listBots()).agents as any[]).find(a=>a.id===botId);if(!binding||!agent||agent.archivedAt)throw new KTeamError('agent_not_found',404);let op=this.claim('direct:'+botId,{});if(op.status==='complete'){await this.guardConversation(op.receipt.roomId);return op.receipt;}const member:Member={...binding,name:agent.name,bindingRevision:binding.revision,existing:true};const validate=()=>this.frozen(member);const roomId=await this.room(op,agent.name,'与 '+agent.name+' 直接交流。',[member],'direct',validate);op.status='complete';op.receipt={roomId};this.save(op);return op.receipt;});}
 async createMember(value:unknown,ctx:{requestSource:string}){
  this.user(ctx);const input=record(value);fields(input,['name','modelId','requestId']);const name=text(input.name,'member_name',80).trim(),modelId=text(input.modelId,'model_id'),requestId=text(input.requestId,'request_id');const operationId='manual-member:'+requestId,requestHash=hash({name,modelId});
  return this.single(operationId,async()=>{let op=this.store.operation(operationId);if(op&&op.data.requestHash!==requestHash)throw new KTeamError('bot_create_request_conflict',409);if(op?.status==='complete'){await this.guardConversation(op.receipt.roomId);return op.receipt;}
   if(!op){const identity=await this.models.identity(modelId);const member:Member={botId:'kteam-'+createHash('sha256').update(requestId).digest('hex').slice(0,24),name,modelId,model:identity.model,fingerprint:identity.fingerprint,existing:false};op=this.claim(operationId,{requestHash,member,title:name});}else op=this.claim(operationId,op.data);
   const member:Member=op.data.member,validate=()=>this.frozen(member);await this.ensureMember(op,member,0,validate);const roomId=await this.room(op,name,'与 '+name+' 直接交流。',[member],'direct',validate);op.status='complete';op.receipt={ok:true,bot:{id:member.botId,name,binding:this.store.binding(member.botId)},roomId};this.save(op);return op.receipt;
  });
 }
 async createGroup(value:unknown,ctx:{requestSource:string}){
  this.user(ctx);const input=record(value);fields(input,['title','goal','memberAgentIds','requestId']);const title=text(input.title,'title',80).trim(),goal=typeof input.goal==='string'&&input.goal.length<=8192?input.goal.trim():'',requestId=text(input.requestId,'request_id');if(!Array.isArray(input.memberAgentIds)||input.memberAgentIds.length<1||input.memberAgentIds.length>5||input.memberAgentIds.some(id=>typeof id!=='string')||new Set(input.memberAgentIds).size!==input.memberAgentIds.length)throw new KTeamError('invalid_members');
  const memberIds=input.memberAgentIds as string[];
  const operationId='manual-group:'+requestId,requestHash=hash({title,goal,members:[...input.memberAgentIds].sort()});return this.single(operationId,async()=>{let op=this.store.operation(operationId);if(op&&op.data.requestHash!==requestHash)throw new KTeamError('room_create_request_conflict',409);if(op?.status==='complete')return op.receipt;
   if(!op){const bots=(await this.upstream.listBots()).agents as any[],members=memberIds.map(id=>{const b=this.store.binding(id as string),agent=bots.find(a=>a.id===id&&!a.archivedAt);if(!agent)throw new KTeamError('agent_not_found',404);return b?{...b,name:agent.name,existing:true,bindingRevision:b.revision}:{botId:agent.id,name:agent.name,modelId:'',model:'未绑定',fingerprint:'none',existing:true,unbound:true,...(this.store.state<any>('external-bot:'+agent.id)?{external:{driver:this.store.state<any>('external-bot:'+agent.id).driver}}:{})};});op=this.claim(operationId,{requestHash,title,goal,members});}else op=this.claim(operationId,op.data);
   const members:Member[]=op.data.members,validate=async()=>{for(const member of members)await this.frozen(member);};for(const [index,member] of members.entries())await this.ensureMember(op,member,index,validate);const roomId=await this.room(op,title,goal||'尚未设定目标',members,'group',validate);op.status='complete';op.receipt={ok:true,room:{roomId,title,description:goal}};this.save(op);return op.receipt;
  });
 }
 async createExternalMember(input:{name:string;driver:string;requestId:string;existingBotId?:string},assertCurrent:()=>Promise<void>){
  const operationId='external-member:'+input.requestId;return this.single(operationId,async()=>{
   await assertCurrent();if(input.existingBotId){const prior=this.store.state<any>('external-bot:'+input.existingBotId);if(!prior&&!this.store.binding(input.existingBotId))throw new KTeamError('external_binding_changed',409);const direct=this.store.state<any>('direct-room:'+input.existingBotId)??(await this.direct(input.existingBotId,{requestSource:'user'}));await this.guardConversation(direct.roomId);await assertCurrent();return {botId:input.existingBotId,roomId:direct.roomId};}
   let op=this.store.operation(operationId);if(op?.status==='complete'){await this.guardConversation(op.receipt.roomId);await assertCurrent();return op.receipt;}
   const member:Member={botId:'kteam-'+hash(operationId).slice(0,24),name:input.name,modelId:'',model:'原Agent会话',fingerprint:'none',existing:false,unbound:true,external:{driver:input.driver}};
   op=this.claim(operationId,{member});const validate=async()=>{await assertCurrent();await this.frozen(member);};await this.ensureMember(op,member,0,validate);const roomId=await this.room(op,member.name,'与 '+member.name+' 的原Agent会话协作。',[member],'direct',validate);op.status='complete';op.receipt={botId:member.botId,roomId};this.save(op);return op.receipt;
  });
 }
 async editGroup(value:unknown){
  const input=record(value);fields(input,['roomId','title','goal','start','requestId']);const roomId=text(input.roomId,'room_id'),requestId=text(input.requestId,'request_id'),settings=this.store.settings(roomId);if(!settings||settings.kind!=='group')throw new KTeamError('group_required');
  const snapshot=await this.upstream.membership(roomId),room=snapshot.room as any,title=input.title===undefined?room.title:text(input.title,'title',80).trim(),goal=input.goal===undefined?settings.goal:text(input.goal,'goal',8192).trim(),start=input.start===true;
  const contract=(await this.upstream.aimp(roomId,'session')).session as any;
  const operationId='group-edit:'+requestId,editHash=hash({roomId,title,goal,start});return this.single(operationId,async()=>{let op=this.store.operation(operationId);if(op&&op.data.intentHash!==editHash)throw new KTeamError('group_edit_conflict',409);if(op?.status==='complete')return op.receipt;
   op=this.claim(operationId,{roomId,title,goal,start,intentHash:editHash,settingsRevision:settings.revision,roomRevision:room.revision,contractRevision:contract?.revision??0,timestamp:new Date().toISOString(),memberIds:(snapshot.members as any[]).filter(m=>m.status==='active').map(m=>JSON.stringify(m.subject)).sort()});
   const validate=async()=>{const current=this.store.settings(roomId);if(!current||(current.revision!==op.data.settingsRevision&&current.lastGoalOperation!==op.id))throw new KTeamError('team_revision_conflict',409);const actual=await this.upstream.membership(roomId),members=(actual.members as any[]).filter(m=>m.status==='active');if((actual.room as any)?.status!=='active'||!members.some(m=>m.role==='owner'&&m.subject.kind==='user'&&m.subject.userId==='user.local')||JSON.stringify(members.map(m=>JSON.stringify(m.subject)).sort())!==JSON.stringify(op.data.memberIds))throw new KTeamError('team_scope_changed',409);};
   await validate();await this.stage(op,'metadata',async()=>{const actual=(await this.upstream.membership(roomId)).room as any;return actual.title===title&&actual.description===(start?goal:room.description??'')?{roomId}:null;},()=>this.upstream.updateTeam(roomId,{title,description:start?goal:room.description??'',expectedRoomRevision:op.data.roomRevision}),validate);
   if(start){await this.stage(op,'contract',async()=>{const session=(await this.upstream.aimp(roomId,'session')).session as any;return session?.goal===goal?{revision:session.revision}:null;},()=>this.upstream.aimp(roomId,'configure',{goal,expectedRevision:op.data.contractRevision,allowedActions:['discussion'],maxRuns:6}),validate);
    const envelope={aimp:'1.0',id:'msg_'+hash(op.id).slice(0,32),room_id:roomId,thread_id:'thread-'+roomId,from:LOCAL_HUMAN,to:[],mentions:[],ts:op.data.timestamp,act:'chat',source_level:'principal',body:goal};
    const receipt=await this.stage(op,'goal-message',async()=>{const messages=(await this.upstream.messages(roomId,0,100,undefined,true)).messages as any[];const m=messages.find(m=>m.sourceRef?.envelope?.id===envelope.id&&m.sourceRef.intentHash===intentHash(envelope as any));return m?{messageId:m.messageId}:null;},()=>new CollaborationService(this.upstream).send(envelope,e=>this.store.prepareSubmission(e.id,roomId,intentHash(e),e),actual=>{const members=(actual.members as any[]).filter(m=>m.status==='active');if(JSON.stringify(members.map(m=>JSON.stringify(m.subject)).sort())!==JSON.stringify(op.data.memberIds)||(actual.room as any)?.title!==title||(actual.room as any)?.description!==goal)throw new KTeamError('team_scope_changed',409);}),validate);
    const current=this.store.settings(roomId)!;if(current.lastGoalOperation!==op.id)this.store.configure({...current,goal,goalConfirmed:true,paused:false,lastGoalOperation:op.id},current.revision);this.store.completeSubmission(envelope.id,String(receipt.messageId));
   }
   op.status='complete';op.receipt={ok:true,roomId,title,settings:this.store.settings(roomId)};this.save(op);return op.receipt;
  });
 }
 pendingCreations(){return this.store.operations().filter(op=>op.status!=='complete'&&op.id.startsWith('manual-')).map(op=>({id:op.id,title:op.data.title,kind:op.id.startsWith('manual-member:')?'member':'group'}));}
 async resumeCreation(value:unknown,ctx:{requestSource:string}){this.user(ctx);const input=record(value);fields(input,['id']);const op=this.store.operation(text(input.id,'operation_id'));if(!op||!op.id.startsWith('manual-'))throw new KTeamError('operation_not_found',404);const requestId=op.id.slice(op.id.indexOf(':')+1);if(op.id.startsWith('manual-member:'))return this.createMember({name:op.data.member.name,modelId:op.data.member.modelId,requestId},ctx);return this.createGroup({title:op.data.title,goal:op.data.goal,memberAgentIds:op.data.members.map((m:Member)=>m.botId),requestId},ctx);}
 proposals(roomId?:string){return this.store.proposals(roomId).map(p=>({...p,operation:this.store.operation('accept:'+p.id)?.status==='complete'?this.store.operation('accept:'+p.id).receipt:null,partial:this.store.operation('accept:'+p.id)?.stages??null}));}
}
