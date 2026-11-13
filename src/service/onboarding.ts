import {modelCatalog} from '../runtime/native.js';
import {randomUUID} from 'node:crypto';
import {TeamStore} from './team-store.js';
import {TeamCoordinator} from './coordination.js';
import {Upstreams} from '../adapters/upstream.js';
import {KTeamError,record,fields,text} from '../errors.js';
const ID='onboarding:v1';
export class OnboardingService{
 private pending:Promise<any>|undefined;
 constructor(private store:TeamStore,private coordinator:TeamCoordinator,private upstream:Upstreams,private catalog:()=>Promise<{defaultModelId:string;models:{id:string}[]}>=modelCatalog){}
 private receipt(){const op=this.store.operation('assistant:'+this.store.installationId());return op?.status==='complete'?op.receipt:undefined;}
 snapshot(){const op=this.store.operation(ID),assistant=this.receipt();return {...(op??{id:ID,revision:0,status:'new',step:'welcome',name:'小K助理',requestId:'onboarding:'+this.store.installationId()}),...(assistant?{status:'done',step:'done',roomId:assistant.roomId,result:assistant}:{}),assistantConfigured:!!assistant};}
 private async completed(){const result=await this.coordinator.ensureAssistantConversation({requestSource:'user'}),op=this.store.operation(ID),now=this.snapshot();if(op?.status!=='done'||op.roomId!==result.roomId||op.result?.botId!==result.botId)this.store.saveOperation({...now,status:'done',step:'done',result,roomId:result.roomId,completedAt:new Date().toISOString()},now.revision);return result;}
 async ensureConfigured(){
  if(this.receipt()){const result=await this.completed();return {ok:true,state:'ready',...result,onboarding:this.snapshot()};}
  const frozen=this.store.operation('assistant:'+this.store.installationId())?.data?.member?.modelId;
  const models=await this.catalog(),selected=frozen??(models.models.some(model=>model.id===models.defaultModelId)?models.defaultModelId:undefined);
  if(!selected)return {ok:true,state:models.models.length?'needs_selection':'needs_model',onboarding:this.snapshot()};
  const result=await this.create({modelId:selected});return {ok:true,state:'ready',...result,onboarding:this.snapshot()};
 }

 update(value:unknown){const input=record(value);fields(input,['step','name','inviteId','restart']);const current=this.snapshot();if(current.status==='creating')throw new KTeamError('onboarding_creation_pending',409);if(!['welcome','models','create','connect'].includes(String(input.step)))throw new KTeamError('onboarding_input_invalid');const next={...current,status:'new',step:input.step,...(typeof input.name==='string'?{name:text(input.name,'name',60)}:{}),...(typeof input.inviteId==='string'?{inviteId:text(input.inviteId,'invite_id')}:{}),...(input.restart===true?{requestId:'onboarding:'+randomUUID(),inviteId:undefined}: {})};return this.store.saveOperation(next,current.revision);}
 async create(value:unknown){
  const input=record(value);fields(input,['name','modelId','expectedFingerprint']);const proof=input.expectedFingerprint===undefined?{}:{expectedFingerprint:text(input.expectedFingerprint,'fingerprint',256)};const name='小K助理',modelId=text(input.modelId,'model_id');if(this.receipt())return this.completed();const current=this.snapshot();
  if(current.status==='creating'&&current.modelId!==modelId&&(this.pending||this.store.operation('assistant:'+this.store.installationId())))throw new KTeamError('onboarding_creation_pending',409);
  if(this.pending)return this.pending;
  if(current.status!=='creating'||current.modelId!==modelId)this.store.saveOperation({...current,status:'creating',step:'create',name,modelId},current.revision);
  this.pending=(async()=>{const result=await this.coordinator.bootstrap({requestSource:'user'},{name,modelId,...proof});
   const now=this.snapshot();this.store.saveOperation({...now,status:'done',step:'done',result,roomId:result.roomId,completedAt:new Date().toISOString()},now.revision);return result;
  })().finally(()=>{this.pending=undefined;});return this.pending;
 }
 async finish(value:unknown){const input=record(value);fields(input,['roomId','skipped']);const current=this.snapshot();if(current.status==='creating')throw new KTeamError('onboarding_creation_pending',409);if(typeof input.roomId==='string'){if(!this.store.settings(input.roomId))throw new KTeamError('onboarding_room_invalid');await this.upstream.membership(input.roomId);await this.coordinator.guardConversation(input.roomId);}else if(input.skipped!==true)throw new KTeamError('onboarding_input_invalid');return this.store.saveOperation({...current,status:'done',step:'done',...(typeof input.roomId==='string'?{roomId:input.roomId}:{}),skipped:input.skipped===true,completedAt:new Date().toISOString()},current.revision);}
}
