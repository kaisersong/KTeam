import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {sharedRuntime} from '../runtime/native.js';
import {KTeamError,record,fields} from '../errors.js';
/** Services and credential ownership match xiaok; only authenticated main can call this owner. */
export class EnterpriseConnectors{
 private services?:Promise<Map<string,any>>;
 private get(){return this.services??=this.create();}
 private async create(){const core=await sharedRuntime(),root=core.getConfigDir(),runtime=new core.ManagedEnterpriseCliRuntime();runtime.configurePath();
 const openExternal=async(value:string)=>{const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password)throw new KTeamError('connector_url_invalid');const command=process.platform==='darwin'?'/usr/bin/open':process.platform==='win32'?'rundll32.exe':'xdg-open',args=process.platform==='win32'?['url.dll,FileProtocolHandler',url.href]:[url.href];await new Promise<void>((resolve,reject)=>execFile(command,args,{timeout:10000},error=>error?reject(error):resolve()));};
 const services=new Map<string,any>();services.set('yzj',new core.YzjCliAuthService({openExternal,connectionHistoryPath:join(root,'connectors/yzj-history.json')}));
 for(const provider of ['dingtalk','feishu','wecom'])services.set(provider,new core.EnterpriseCliConnectorService(provider,{runtime,openExternal,historyPath:join(root,'connectors/'+provider+'-history.json')}));return services;
 }
 async view(){return {ok:true,connectors:[...(await this.get())].map(([provider,service])=>({provider,...service.getState()}))};}
 async control(value:unknown){const input=record(value);fields(input,['provider','action','expectedRevision']);const service=(await this.get()).get(String(input.provider));if(!service)throw new KTeamError('connector_not_found',404);if(input.expectedRevision!==service.getState().revision)throw new KTeamError('connector_changed',409);if(!['install','login','setup','check','cancel'].includes(String(input.action))||input.provider==='yzj'&&!['login','check','cancel'].includes(String(input.action)))throw new KTeamError('connector_action_invalid');await service.control(input.action,'user');return this.view();}
 async close(){if(this.services)await Promise.all([...(await this.services).values()].map(service=>service.dispose()));}
}
