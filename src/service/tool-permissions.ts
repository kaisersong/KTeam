import {directoryAccess,directoryAccessCurrent,sensitiveFileInvocation,fileTarget,canonicalFile,insideDirectory,type DirectoryAccess} from './directory-access.js';
import {createHash,randomUUID} from 'node:crypto';
import {realpathSync} from 'node:fs';
import {TeamStore} from './team-store.js';
import {KTeamError,record,fields,text} from '../errors.js';
export type PermissionScope={botId:string;cwd:string;bindingRevision?:number};
export function persistentToolEligible(core:any,name:string,input:Record<string,unknown>){return !sensitiveFileInvocation(core,name,input,String(input.workdir??process.cwd()))&&!['send_mail','install_skill','uninstall_skill'].includes(name)&&!core.isSensitiveToolInvocation(name,input)&&!(name==='bash'&&core.requiresAlwaysCommandConfirmation(String(input.command??'')));}
/** Human grants only: creation is private to the live approval decision path. */
export class ToolPermissions{
 constructor(private store:TeamStore){}
 private scope(value:PermissionScope){return {botId:value.botId,cwd:value.cwd,bindingRevision:value.bindingRevision??null};}
 private key(scope:PermissionScope,name:string){return 'tool-permission:'+createHash('sha256').update(JSON.stringify([this.scope(scope),name])).digest('hex');}
 private epochKey(scope:PermissionScope){return 'tool-permission-epoch:'+createHash('sha256').update(JSON.stringify(this.scope(scope))).digest('hex');}
 private directoryEpoch(scope:PermissionScope){return 'directory-permission-epoch:'+JSON.stringify([scope.botId,scope.bindingRevision??null]);}
 revision(scope:PermissionScope){return (this.store.state<number>(this.epochKey(scope))??0)+(this.store.state<number>(this.directoryEpoch(scope))??0);}
 find(scope:PermissionScope,name:string,input?:Record<string,unknown>,core?:any){if(input&&core){const target=fileTarget(name,input,scope.cwd);if(target){const actual=canonicalFile(target),root=canonicalFile(scope.cwd);if(!actual||!root||!insideDirectory(root,actual)||sensitiveFileInvocation(core,name,input,scope.cwd))return null;}}const grant=this.store.state<any>(this.key(scope,name));return grant&&!grant.revokedAt?grant:null;}
 remember(scope:PermissionScope,name:string){scope={...scope,cwd:realpathSync(scope.cwd)};const key=this.key(scope,name),old=this.find(scope,name);if(old)return old;const grant={id:randomUUID(),...this.scope(scope),toolName:name,createdAt:new Date().toISOString()};this.store.setState(key,grant);return grant;}
 private directoryKey(scope:PermissionScope,directory:string){return 'tool-directory-permission:'+createHash('sha256').update(JSON.stringify([scope.botId,scope.bindingRevision??null,directory])).digest('hex');}
 rememberDirectory(scope:PermissionScope,access:DirectoryAccess){if(!directoryAccessCurrent(access))throw new KTeamError('tool_directory_changed',409);const key=this.directoryKey(scope,access.directory),old=this.store.state<any>(key);if(old&&!old.revokedAt&&directoryAccessCurrent(old.access))return old;const grant={id:randomUUID(),...this.scope(scope),kind:'directory',toolName:'files',directory:access.directory,access,createdAt:new Date().toISOString()};this.store.setState(key,grant);return grant;}
 findDirectory(scope:PermissionScope,name:string,input:Record<string,unknown>,core:any){const candidate=directoryAccess(core,name,input,scope.cwd);if(!candidate)return null;return this.list().find(grant=>grant.kind==='directory'&&grant.botId===scope.botId&&grant.bindingRevision===(scope.bindingRevision??null)&&insideDirectory(grant.directory,candidate.target)&&directoryAccessCurrent(grant.access))??null;}
 list(){return [...this.store.stateEntries('tool-permission:'),...this.store.stateEntries('tool-directory-permission:')].map(row=>row.value).filter(v=>v&&!v.revokedAt);}
 revoke(value:unknown){const input=record(value);fields(input,['id']);const id=text(input.id,'permission_id'),grant=this.list().find(v=>v.id===id);if(!grant)throw new KTeamError('tool_permission_changed',409);const scope={...grant,bindingRevision:grant.bindingRevision??undefined};this.store.transaction(()=>{this.store.setState(grant.kind==='directory'?this.directoryKey(scope,grant.directory):this.key(scope,grant.toolName),{...grant,revokedAt:new Date().toISOString()});const epoch=grant.kind==='directory'?this.directoryEpoch(scope):this.epochKey(scope);this.store.setState(epoch,(this.store.state<number>(epoch)??0)+1);});return {ok:true,permissions:this.list()};}
}
