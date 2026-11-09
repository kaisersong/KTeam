import {sharedRuntime} from './native.js';
import {privateRead,type Config} from '../service/config.js';
import {parseJson} from '../protocol/json.js';
import {record,KTeamError} from '../errors.js';
/** Attach to the existing xiaok owner; never start competing service writers. */
export async function ensureSharedServices(config:Config){
 if(!config.xiaokActivityConfig)return;
 const source=record(parseJson(privateRead(config.xiaokActivityConfig)));
 if(typeof source.dataRoot!=='string')throw new KTeamError('xiaok_service_owner_unavailable');
 const {ConversationActivityOwnerClient}=await sharedRuntime();
 const client=new ConversationActivityOwnerClient(source.dataRoot,'producer','kteam-shared-services');
 try{
  await client.connect();
  for(const name of ['broker','kswarm'])await client.request('sourceEnsure',{name,ownerEpoch:client.ownerEpoch});
 }finally{client.close();}
}
