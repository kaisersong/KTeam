import {randomUUID} from 'node:crypto';
import {TeamStore} from './team-store.js';
import {TeamCoordinator} from './coordination.js';
import {Upstreams} from '../adapters/upstream.js';
import {KTeamError,record,fields,text} from '../errors.js';
const ID='onboarding:v1';
export class OnboardingService{
 private pending:Promise<any>|undefined;
 constructor(private store:TeamStore,private coordinator:TeamCoordinator,private upstream:Upstreams){}
 snapshot(){const op=this.store.operation(ID);return op??{id:ID,revision:0,status:'new',step:'welcome',name:'小K',requestId:'onboarding:'+this.store.installationId()};}
 update(value:unknown){const input=record(value);fields(input,['step','name','inviteId','restart']);const current=this.snapshot();if(current.status==='creating')throw new KTeamError('onboarding_creation_pending',409);if(!['welcome','create','connect'].includes(String(input.step)))throw new KTeamError('onboarding_input_invalid');const next={...current,status:'new',step:input.step,...(typeof input.name==='string'?{name:text(input.name,'name',60)}:{}),...(typeof input.inviteId==='string'?{inviteId:text(input.inviteId,'invite_id')}:{}),...(input.restart===true?{requestId:'onboarding:'+randomUUID(),inviteId:undefined}: {})};return this.store.saveOperation(next,current.revision);}
 async create(value:unknown){
  const input=record(value);fields(input,['name','modelId','expectedFingerprint']);const proof=input.expectedFingerprint===undefined?{}:{expectedFingerprint:text(input.expectedFingerprint,'fingerprint',256)};const name=text(input.name,'name',60).trim(),modelId=text(input.modelId,'model_id');const current=this.snapshot();
  if(current.status==='done'&&current.result)return current.result;
  if(current.status==='creating'&&(current.name!==name||current.modelId!==modelId))throw new KTeamError('onboarding_creation_pending',409);
  if(this.pending)return this.pending;
  if(current.status!=='creating')this.store.saveOperation({...current,status:'creating',step:'create',name,modelId},current.revision);
  this.pending=(async()=>{const frozen=this.snapshot(),hasAssistant=this.store.operation('assistant:'+this.store.installationId())?.status==='complete';
   const result=hasAssistant?await this.coordinator.createMember({name,modelId,...proof,requestId:frozen.requestId},{requestSource:'user'}):await this.coordinator.bootstrap({requestSource:'user'},{name,modelId,...proof});
   const now=this.snapshot();this.store.saveOperation({...now,status:'done',step:'done',result,roomId:result.roomId,completedAt:new Date().toISOString()},now.revision);return result;
  })().finally(()=>{this.pending=undefined;});return this.pending;
 }
 async finish(value:unknown){const input=record(value);fields(input,['roomId','skipped']);const current=this.snapshot();if(current.status==='creating')throw new KTeamError('onboarding_creation_pending',409);if(typeof input.roomId==='string'){if(!this.store.settings(input.roomId))throw new KTeamError('onboarding_room_invalid');await this.upstream.membership(input.roomId);await this.coordinator.guardConversation(input.roomId);}else if(input.skipped!==true)throw new KTeamError('onboarding_input_invalid');return this.store.saveOperation({...current,status:'done',step:'done',...(typeof input.roomId==='string'?{roomId:input.roomId}:{}),skipped:input.skipped===true,completedAt:new Date().toISOString()},current.revision);}
}
