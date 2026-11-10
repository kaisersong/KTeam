import {createHash,randomUUID} from 'node:crypto';
import {realpathSync} from 'node:fs';
import {TeamStore} from './team-store.js';
import {KTeamError,record,fields,text} from '../errors.js';
export type PermissionScope={botId:string;cwd:string;bindingRevision?:number};
export function persistentToolEligible(core:any,name:string,input:Record<string,unknown>){return !['send_mail','install_skill','uninstall_skill'].includes(name)&&!core.isSensitiveToolInvocation(name,input)&&!(name==='bash'&&core.requiresAlwaysCommandConfirmation(String(input.command??'')));}
/** Human grants only: creation is private to the live approval decision path. */
export class ToolPermissions{
 constructor(private store:TeamStore){}
 private scope(value:PermissionScope){return {botId:value.botId,cwd:value.cwd,bindingRevision:value.bindingRevision??null};}
 private key(scope:PermissionScope,name:string){return 'tool-permission:'+createHash('sha256').update(JSON.stringify([this.scope(scope),name])).digest('hex');}
 private epochKey(scope:PermissionScope){return 'tool-permission-epoch:'+createHash('sha256').update(JSON.stringify(this.scope(scope))).digest('hex');}
 revision(scope:PermissionScope){return this.store.state<number>(this.epochKey(scope))??0;}
 find(scope:PermissionScope,name:string){const grant=this.store.state<any>(this.key(scope,name));return grant&&!grant.revokedAt?grant:null;}
 remember(scope:PermissionScope,name:string){scope={...scope,cwd:realpathSync(scope.cwd)};const key=this.key(scope,name),old=this.find(scope,name);if(old)return old;const grant={id:randomUUID(),...this.scope(scope),toolName:name,createdAt:new Date().toISOString()};this.store.setState(key,grant);return grant;}
 list(){return this.store.stateEntries('tool-permission:').map(row=>row.value).filter(v=>v&&!v.revokedAt);}
 revoke(value:unknown){const input=record(value);fields(input,['id']);const id=text(input.id,'permission_id'),grant=this.list().find(v=>v.id===id);if(!grant)throw new KTeamError('tool_permission_changed',409);const scope={...grant,bindingRevision:grant.bindingRevision??undefined};this.store.transaction(()=>{this.store.setState(this.key(scope,grant.toolName),{...grant,revokedAt:new Date().toISOString()});this.store.setState(this.epochKey(scope),this.revision(scope)+1);});return {ok:true,permissions:this.list()};}
}
