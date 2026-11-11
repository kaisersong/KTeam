import {createServer,connect} from 'node:net';
import {join,dirname,resolve,sep} from 'node:path';
import {existsSync,writeFileSync,openSync,closeSync,renameSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {ensurePrivateRoot,initConfig,privateRead,CLIENTS,loadConfig,readRawConfig,isLegacySharedConfig,type Config} from '../service/config.js';
import {recordLegacySharedServicesDropped} from '../service/legacy-notice.js';
import {Upstreams} from '../adapters/upstream.js';
import {KTeamError} from '../errors.js';
import {writeServiceEndpoints,portOf} from '../service/service-endpoints.js';
export interface ServicePlan{version:1;broker:{cwd:string;env:Record<string,string>};kswarm:{cwd:string;env:Record<string,string>}}
const freePort=()=>new Promise<number>((accept,reject)=>{const server=createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const port=(server.address() as any).port;server.close(error=>error?reject(error):accept(port));});});
function clientCredentials(root:string){for(const name of CLIENTS){const file=join(root,name+'.token');if(existsSync(file)){if(privateRead(file).length<32)throw new KTeamError('client_credentials_invalid');}else writeFileSync(file,randomBytes(32).toString('base64url')+'\n',{mode:0o600,flag:'wx'});}}
export async function initStandalone(root:string){
 ensurePrivateRoot(root);const serviceRoot=join(root,'services');
 if(existsSync(join(root,'config.json'))){
  if(!legacySharedConfig(root,serviceRoot)){const config=loadConfig(root);clientCredentials(root);if(config.managedServiceConfig)recordEndpoints(root,config);return;}
  archiveLegacySharedConfig(root,serviceRoot);
 }
ensurePrivateRoot(serviceRoot);const brokerRoot=join(serviceRoot,'broker'),kswarmRoot=join(serviceRoot,'kswarm');ensurePrivateRoot(brokerRoot);ensurePrivateRoot(kswarmRoot);
 const brokerTokenFile=join(serviceRoot,'broker.token'),kswarmTokenFile=join(serviceRoot,'kswarm.token'),managedServiceConfig=join(serviceRoot,'config.json');let plan:ServicePlan;
 if(existsSync(managedServiceConfig)){plan=readServicePlan(managedServiceConfig);}else{
  if(existsSync(join(brokerRoot,'broker.sqlite')))throw new KTeamError('managed_services_history_unconfigured');
  const brokerPort=await freePort();let kswarmPort=await freePort();while(kswarmPort===brokerPort)kswarmPort=await freePort();
  const token=(path:string)=>{if(existsSync(path))return privateRead(path);const value=randomBytes(32).toString('base64url');writeFileSync(path,value,{mode:0o600,flag:'wx'});return value;};
  const brokerToken=token(brokerTokenFile),kswarmToken=token(kswarmTokenFile),brokerUrl='http://127.0.0.1:'+brokerPort;
  plan={version:1,broker:{cwd:brokerRoot,env:{PORT:String(brokerPort),INTENT_BROKER_DB:join(brokerRoot,'broker.sqlite'),INTENT_BROKER_SOCKET_PATH:join(brokerRoot,'broker.sock'),INTENT_BROKER_DESKTOP_TOKEN:brokerToken,INTENT_BROKER_KSWARM_TOKEN:kswarmToken,INTENT_BROKER_AIMP_ENABLED:'1',ENABLE_HUMAN_ESCALATION:'0'}},kswarm:{cwd:kswarmRoot,env:{KSWARM_PORT:String(kswarmPort),KSWARM_DATA_ROOT:kswarmRoot,BROKER_URL:brokerUrl,KSWARM_DESKTOP_MUTATION_TOKEN:kswarmToken,KSWARM_RUNTIME_TOKEN:kswarmToken,INTENT_BROKER_KSWARM_TOKEN:kswarmToken,ENABLE_HUMAN_ESCALATION:'0'}}};
  writeFileSync(managedServiceConfig,JSON.stringify(plan),{mode:0o600,flag:'wx'});
 }
 for(const [file,value]of [[brokerTokenFile,plan.broker.env.INTENT_BROKER_DESKTOP_TOKEN],[kswarmTokenFile,plan.kswarm.env.KSWARM_DESKTOP_MUTATION_TOKEN]] as [string,string][]){if(!value||value.length<32)throw new KTeamError('managed_services_config_invalid');if(!existsSync(file))writeFileSync(file,value,{mode:0o600,flag:'wx'});if(privateRead(file)!==value)throw new KTeamError('managed_services_config_invalid');}
 // Prepare all client credentials before the completion config; a crash remains retryable.
 const config:Config={version:1,brokerUrl:'http://127.0.0.1:'+plan.broker.env.PORT,kswarmUrl:'http://127.0.0.1:'+plan.kswarm.env.KSWARM_PORT,brokerTokenFile,kswarmTokenFile,managedServiceConfig};
 clientCredentials(root);initConfig(root,config);recordEndpoints(root,config);
}
/** A 0.2 config ran KTeam on services shared with xiaok (its plan lived outside KTeam's data dir and carried no
 * KTeam-owned credential files). It can never connect in 0.3, so it is detected here before anything else. */
function legacySharedConfig(root:string,serviceRoot:string){
 const raw=readRawConfig(root);if(isLegacySharedConfig(raw))return true;
 const planFile=(raw as {managedServiceConfig?:unknown}).managedServiceConfig;if(typeof planFile!=='string'||!existsSync(planFile))return false;
 // An unreadable plan is not evidence of a 0.2 config: leave it for the normal path to report.
 let plan:ServicePlan;try{plan=readServicePlan(planFile);}catch{return false;}return [plan.broker.cwd,plan.kswarm.cwd].some(cwd=>!resolve(cwd).startsWith(serviceRoot+sep));
}
/** Move the 0.2 shared-service config (and the plan/connection files 0.2 kept in KTeam's services dir) into
 * backups/, untouched, so a fresh KTeam-owned setup can be created. Nothing outside KTeam's data dir is read,
 * moved or modified. Client credentials stay in place. The one-time 0.3 notice is recorded before the move. */
function archiveLegacySharedConfig(root:string,serviceRoot:string){
 recordLegacySharedServicesDropped(root);
 const backups=join(root,'backups');ensurePrivateRoot(backups);
 const target=join(backups,'legacy-0.2-shared-'+new Date().toISOString().replace(/[:.]/g,'-'));ensurePrivateRoot(target);
 for(const [from,name] of [[join(serviceRoot,'config.json'),'services-config.json'],[join(serviceRoot,'shared-connection.json'),'services-shared-connection.json'],[join(root,'service-endpoints.json'),'service-endpoints.json']] as [string,string][])if(existsSync(from))renameSync(from,join(target,name));
 // config.json moves last: until it is gone, a crash re-runs this same detection on the next start.
 renameSync(join(root,'config.json'),join(target,'config.json'));
 process.emitWarning('KTeam moved a 0.2 shared-service config to '+target+' and is creating its own services.',{code:'KTEAM_LEGACY_SHARED_CONFIG_ARCHIVED'});
}
/** Publish the ports KTeam's own services use to KTeam's discovery file for the CLI and clients. */
function recordEndpoints(root:string,config:Config){writeServiceEndpoints(root,{broker:portOf(config.brokerUrl),kswarm:portOf(config.kswarmUrl)});}
export function readServicePlan(path:string):ServicePlan{const plan=JSON.parse(privateRead(path));if(plan?.version!==1||!plan.broker||!plan.kswarm)throw new KTeamError('managed_services_config_invalid');for(const part of [plan.broker,plan.kswarm])if(typeof part.cwd!=='string'||!part.cwd.startsWith('/')||!part.env||Object.values(part.env).some(v=>typeof v!=='string'))throw new KTeamError('managed_services_config_invalid');return plan;}
export async function portOccupied(url:string){const address=new URL(url);return new Promise<boolean>(accept=>{const socket=connect({host:address.hostname,port:Number(address.port)});socket.setTimeout(700);socket.once('connect',()=>{socket.destroy();accept(true);});socket.once('error',()=>accept(false));socket.once('timeout',()=>{socket.destroy();accept(true);});});}
export async function ensureManagedServices(config:Config,options:ConstructorParameters<typeof Upstreams>[0],root:string){
 if((await new Upstreams(options).probe()).ready)return;
 if(!config.managedServiceConfig)throw new KTeamError('managed_services_config_missing');
 const entry=process.env.KTEAM_SERVICE_OWNER_ENTRY??resolve(dirname(process.argv[1]??'build/host.cjs'),'service-owner.cjs');if(!existsSync(entry))throw new KTeamError('managed_services_bundle_missing');
 const output=openSync(join(root,'services.log'),'a',0o600);try{const child=spawn(process.execPath,[entry],{detached:true,stdio:['ignore',output,output],env:{...process.env,ELECTRON_RUN_AS_NODE:'1',KTEAM_DATA_DIR:root}});child.unref();child.once('error',()=>{});}finally{closeSync(output);}
 const deadline=Date.now()+12000;while(Date.now()<deadline){if((await new Upstreams(options).probe()).ready)return;await new Promise(r=>setTimeout(r,150));}throw new KTeamError('managed_services_start_timeout');
}
