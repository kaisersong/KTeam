import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {existsSync,writeFileSync,renameSync,readFileSync} from 'node:fs';
import {privateRead,type Config,upstreamOptions,ensurePrivateRoot,dataRoot} from '../service/config.js';
import {record,KTeamError} from '../errors.js';
import {ensureManagedServices,type ServicePlan} from './managed-services.js';
/** Upgrade keeps the same service tokens and databases; only the executable owner changes when needed. */
function adoptShared(config:Config,root:string):Config{
 const source=record(JSON.parse(privateRead(config.xiaokActivityConfig!))),managed=source.managedSources;if(!Array.isArray(managed))throw new KTeamError('shared_service_plan_missing');const broker=managed.find(s=>s.name==='broker'),kswarm=managed.find(s=>s.name==='kswarm');if(!broker?.env||!kswarm?.env||typeof broker.env.INTENT_BROKER_DB!=='string')throw new KTeamError('shared_service_plan_missing');const kswarmRoot=kswarm.env.KSWARM_DATA_ROOT??join(kswarm.env.HOME??homedir(),'.kswarm');if(!existsSync(broker.env.INTENT_BROKER_DB)||!existsSync(kswarmRoot))throw new KTeamError('shared_service_history_missing');
 const serviceRoot=join(root,'services');ensurePrivateRoot(serviceRoot);const env={...broker.env};for(const key of ['INTENT_BROKER_CONFIG','INTENT_BROKER_LOCAL_CONFIG']){if(env[key]&&existsSync(env[key])){const target=join(serviceRoot,key.toLowerCase()+'.json');writeFileSync(target,readFileSync(env[key]),{mode:0o600});env[key]=target;}else delete env[key];}delete env.INTENT_BROKER_REPO_ROOT;
 const plan:ServicePlan={version:1,broker:{cwd:broker.cwd,env},kswarm:{cwd:kswarmRoot,env:{...kswarm.env,KSWARM_DATA_ROOT:kswarmRoot}}};
 const managedServiceConfig=join(serviceRoot,'config.json'),connection=join(serviceRoot,'shared-connection.json');writeFileSync(managedServiceConfig,JSON.stringify(plan),{mode:0o600});writeFileSync(connection,JSON.stringify({kswarm:source.kswarm}),{mode:0o600});const next={...config,xiaokActivityConfig:connection,managedServiceConfig};const temporary=join(root,'config.json.upgrade');writeFileSync(temporary,JSON.stringify(next,null,2),{mode:0o600});renameSync(temporary,join(root,'config.json'));return next;
}
export async function ensureSharedServices(config:Config,root=dataRoot()){
 if(config.xiaokActivityConfig&&!config.managedServiceConfig)config=adoptShared(config,root);
 if(config.managedServiceConfig)return ensureManagedServices(config,upstreamOptions(config),root);
 // Explicitly configured external services remain external; no new history database is substituted.
}
