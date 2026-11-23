import {defaultMessageChannel} from '../runtime/message-channel.js';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {join} from 'node:path';
import {EnterpriseCliConnectorService} from './enterprise-cli-service.js';
import {YzjCliAuthService} from './yzj-cli-auth-service.js';
import {ManagedEnterpriseCliRuntime} from '../runtime/enterprise-cli-runtime.js';
import {ensureBundledYzjCli,getYzjCliLaunchArgs,configureBundledYzjCli} from '../runtime/bundled-yzj-cli.js';
import {getConfigDir} from '../runtime/connector-paths.js';
import {connectorCommand} from '../runtime/connector-command.js';
import {record,fields,KTeamError} from '../errors.js';
import type {EnterpriseCliProvider} from '../protocol/enterprise-cli.js';
const working=new Set(['installing','checking','opening','waiting','cancelling','stopPending']);
export class EnterpriseConnectors{
 private readonly enterprise=new Map<string,EnterpriseCliConnectorService>();private readonly cloud:YzjCliAuthService;
 private cloudBinary='';private cloudVersion='';private update?:{controller:AbortController;done:Promise<void>};private updateError=false;private closed=false;private loading?:Promise<void>;private existingCloudConnection?:Promise<boolean|undefined>;
 private initialStatusCheck?:Promise<void>;
 constructor(private readonly options:{configRoot?:string;packageRoot?:string;openExternal?:(url:string)=>Promise<void>}={}){
  const root=options.configRoot??getConfigDir(),openExternal=options.openExternal??(async(value:string)=>{const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password)throw Error('connector_url_invalid');const windows=process.platform==='win32';await new Promise<void>((resolve,reject)=>execFile(windows?'rundll32.exe':process.platform==='darwin'?'/usr/bin/open':'xdg-open',windows?['url.dll,FileProtocolHandler',url.href]:[url.href],{timeout:10000},error=>error?reject(error):resolve()));});
  const runtime=new ManagedEnterpriseCliRuntime({rootDir:join(root,'tools/enterprise-cli')});runtime.configurePath();for(const provider of ['dingtalk','feishu','wecom'] as const)this.enterprise.set(provider,new EnterpriseCliConnectorService(provider,{runtime,openExternal,historyPath:join(root,'connectors',provider+'-history.json')}));
  this.cloud=new YzjCliAuthService({openExternal,resolveBinary:()=>this.seed(),connectionHistoryPath:join(root,'connectors/yzj-history.json')});
 }
 private seed(){return this.cloudBinary=ensureBundledYzjCli({configDir:this.options.configRoot,packageRoot:this.options.packageRoot}).binaryPath;}
 private async load(){if(this.closed)throw new KTeamError('connector_closed',409);return this.loading??=(async()=>{try{this.seed();const r=await connectorCommand(this.cloudBinary,['--version']);this.cloudVersion=/^yzj-cli (\d+\.\d+\.\d+)\s*$/.exec(r.stdout)?.[1]??'';}catch{this.cloudBinary='';} })();}
 private cloudState(){return {provider:'yzj',defaultMessageChannel:true,...this.cloud.getState(),...(this.update?{phase:'updating'}:{}),installed:!!this.cloudBinary,version:this.cloudVersion||undefined,bundled:true,updateError:this.updateError};}
 // The first authorized settings read starts the same read-only checks as Refresh.
 // Do not display the initial idle/ready states as a signed-out account.
 private checkInitialStatus():Promise<void>{
  return this.initialStatusCheck??=Promise.all([
   ...(this.cloudBinary?[this.cloud.control('check','user')]:[]),
   ...[...this.enterprise.values()].filter(service=>service.getState().installed).map(service=>service.control('check','user')),
  ]).then(()=>{});
 }
 async view(){await this.load();if(this.closed)throw new KTeamError('connector_closed',409);await this.checkInitialStatus();return {ok:true,messageChannel:defaultMessageChannel,connectors:[this.cloudState(),...[...this.enterprise].map(([,service])=>({...service.getState(),bundled:false}))].map(row=>({...row,revision:createHash('sha256').update(JSON.stringify(row)).digest('hex')}))};}
 async control(value:unknown){const input=record(value);fields(input,['provider','action','expectedRevision']);await this.load();const row=(await this.view()).connectors.find(r=>r.provider===input.provider);if(!row)throw new KTeamError('connector_not_found',404);if(row.revision!==input.expectedRevision)throw new KTeamError('connector_changed',409);const action=String(input.action);if(input.provider!=='yzj'){if(!['install','login','setup','check','cancel'].includes(action))throw new KTeamError('connector_action_invalid');await this.enterprise.get(String(input.provider))!.control(action as never,'user');return this.view();}
  if(action==='cancel'){if(this.update){this.update.controller.abort();await this.update.done;}else await this.cloud.control('cancel','user');return this.view();}
  if(!['login','check','update'].includes(action))throw new KTeamError('connector_action_invalid');
  if(this.update||working.has(this.cloud.getState().phase))throw new KTeamError('connector_busy',409);
  if(action==='update'){
   if(!this.cloudBinary)throw new KTeamError('connector_cli_unavailable');this.updateError=false;const controller=new AbortController(),op={controller,done:Promise.resolve()};this.update=op;op.done=(async()=>{try{const cli=ensureBundledYzjCli({configDir:this.options.configRoot,packageRoot:this.options.packageRoot});const result=await connectorCommand(process.execPath,[...getYzjCliLaunchArgs(cli,this.options.packageRoot),'update'],controller.signal,450000);if(result.code!==0)throw Error('update_failed');const version=await connectorCommand(cli.binaryPath,['--version'],controller.signal);this.cloudVersion=/^yzj-cli (\d+\.\d+\.\d+)\s*$/.exec(version.stdout)?.[1]??this.cloudVersion;if(!this.options.configRoot)configureBundledYzjCli();}catch{if(!controller.signal.aborted)this.updateError=true;}finally{if(this.update===op)this.update=undefined;}})();return this.view();
  }
  await this.cloud.control(action as 'login'|'check','user');return this.view();
 }
 async hasSavedConnection(){
  if(this.closed)return undefined;
  if(this.cloud.hasSavedConnection()||[...this.enterprise.values()].some(service=>service.hasSavedConnection()))return true;
  try{if(!this.cloudBinary)this.seed();}catch{return false;}
  return this.existingCloudConnection??=connectorCommand(this.cloudBinary,['whoami'],undefined,3000).then(result=>{
   if(result.code===3)return false;
   if(result.code!==0)return undefined;
   const identity=JSON.parse(result.stdout);
   return identity?.success===true&&identity.data?.openId&&identity.data?.orgId?true:undefined;
  }).catch(()=>undefined);
 }
 async dailyYzj(args:readonly string[],signal?:AbortSignal){
  const binary=this.seed();
  const result=await connectorCommand(binary,[...args],signal);
  if(result.code!==0)throw new KTeamError('daily_source_unavailable',503);
  const envelope=JSON.parse(result.stdout);
  if(envelope?.success!==true||typeof envelope.data!=='object'||envelope.data===null)throw new KTeamError('daily_source_unavailable',503);
  return envelope.data as unknown;
 }
 async dailyEnterpriseIdentity(provider:EnterpriseCliProvider,signal?:AbortSignal){
  return this.enterprise.get(provider)?.dailyIdentity(signal);
 }
 async dailyEnterpriseRead(provider:EnterpriseCliProvider,args:readonly string[],signal:AbortSignal){
  const service=this.enterprise.get(provider);
  if(!service)throw new KTeamError('daily_source_unavailable',503);
  const result=await service.dailyRead(args,signal);
  return JSON.parse(result.stdout) as unknown;
 }
 async close(){this.closed=true;if(this.update){this.update.controller.abort();await this.update.done;}await Promise.all([this.cloud.dispose(),...[...this.enterprise.values()].map(service=>service.dispose())]);}
}
