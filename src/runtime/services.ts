import {type Config,upstreamOptions,dataRoot} from '../service/config.js';
import {ensureManagedServices} from './managed-services.js';
export async function ensureSharedServices(config:Config,root=dataRoot()){
 if(config.managedServiceConfig)return ensureManagedServices(config,upstreamOptions(config),root);
 // Explicitly configured external services remain external; no new history database is substituted.
}
