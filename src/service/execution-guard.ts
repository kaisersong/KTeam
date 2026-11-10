import {setTimeout as delay} from 'node:timers/promises';
import {KTeamError} from '../errors.js';

/** Only current-scope observations may be retried, before admitting any effect.
 * No cached grant: every retry rechecks cancellation, membership and the lease.
 */
export async function verifyExecutionScope(check:()=>Promise<void>,signal:AbortSignal):Promise<void>{
 for(let attempt=0;;attempt++){
  signal.throwIfAborted();
  try{await check();signal.throwIfAborted();return;}
  catch(error){
   signal.throwIfAborted();
   if(attempt||!(error instanceof KTeamError)||!['broker_unavailable','kswarm_unavailable'].includes(error.code))throw error;
   await delay(200,undefined,{signal});
  }
 }
}
