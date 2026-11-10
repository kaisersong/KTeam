import {join} from 'node:path';
import {existsSync,writeFileSync,renameSync,chmodSync} from 'node:fs';
import {dataRoot,ensurePrivateRoot,privateRead} from './config.js';
import {KTeamError} from '../errors.js';
/** Ports KTeam's own desktop services actually bound. Same file and format as runtime-core's
 * desktop-service-discovery: `{broker,kswarm}` in `<KTeam data dir>/service-endpoints.json`, mode 0600. */
export interface ServicePorts{broker:number;kswarm:number}
export const serviceEndpointsFile=(root=dataRoot())=>process.env.KTEAM_DESKTOP_DISCOVERY_FILE??join(root,'service-endpoints.json');
const port=(value:unknown)=>{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<1||value>65535)throw new KTeamError('service_endpoints_invalid');return value;};
function valid(value:any):ServicePorts{const ports={broker:port(value?.broker),kswarm:port(value?.kswarm)};if(ports.broker===ports.kswarm)throw new KTeamError('service_endpoints_invalid');return ports;}
export const portOf=(url:string)=>{const parsed=new URL(url);return Number(parsed.port||(parsed.protocol==='https:'?443:80));};
export function writeServiceEndpoints(root:string,ports:ServicePorts,file=serviceEndpointsFile(root)){
 const value=valid(ports);if(file===join(root,'service-endpoints.json'))ensurePrivateRoot(root);
 const temporary=file+'.'+process.pid+'.tmp';writeFileSync(temporary,JSON.stringify(value),{mode:0o600});chmodSync(temporary,0o600);renameSync(temporary,file);
}
export function readServiceEndpoints(root=dataRoot(),file=serviceEndpointsFile(root)):ServicePorts|undefined{
 if(!existsSync(file))return undefined;let value:unknown;try{value=JSON.parse(privateRead(file));}catch(error){if(error instanceof KTeamError)throw error;throw new KTeamError('service_endpoints_invalid');}return valid(value);
}
/** KTEAM_BROKER_URL / KTEAM_KSWARM_URL override; otherwise only what KTeam's desktop recorded. */
export function discoveredServiceUrls(root=dataRoot(),env:NodeJS.ProcessEnv=process.env){
 const ports=env.KTEAM_BROKER_URL&&env.KTEAM_KSWARM_URL?undefined:readServiceEndpoints(root);
 const url=(name:keyof ServicePorts,override?:string)=>{if(override)return override;if(!ports)throw new KTeamError('service_endpoints_missing');return 'http://127.0.0.1:'+ports[name];};
 return {brokerUrl:url('broker',env.KTEAM_BROKER_URL),kswarmUrl:url('kswarm',env.KTEAM_KSWARM_URL)};
}
