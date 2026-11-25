import {localRequest} from './windows-transport.js';
import { KTeamError, record } from '../errors.js';
import { parseDataJson } from '../protocol/json.js';
import { clientToken, type ClientId } from './config.js';
import { versionHeaders } from './api-version.js';
import {artifactDownloadRoute,maxArtifactDownloadBytes,type ArtifactDownloadIdentity} from '../protocol/artifact-download.js';

/** Shared by KTeam main and the secondary KTeam companion client. Tokens never enter renderer. */
export async function hostRequest(root: string, client: ClientId, route: string, value?: unknown) {
  // Only the authenticated, receipt-scoped image preview can return a 4 MiB upload as base64.
  const maxResponseBytes=client==='kteam-main'&&route==='/v1/composer-attachments/preview'?6*1024*1024:2*1024*1024;
  const response=await hostResponse(root,client,route,value,maxResponseBytes);
  return hostJson(response.status,response.body,maxResponseBytes);
}

/** Full original bytes are for native desktop actions only. */
export async function hostArtifactDownload(root:string,source:ArtifactDownloadIdentity){
  const response=await hostResponse(root,'kteam-main',artifactDownloadRoute,source,maxArtifactDownloadBytes);
  if(response.status!==200||response.contentType!=='application/octet-stream'){
    hostJson(response.status,response.body,2*1024*1024);
    throw new KTeamError('artifact_download_failed');
  }
  return response.body;
}

function hostJson(status:number,body:Buffer,maxResponseBytes:number){
  const result=record(parseDataJson(body.toString('utf8'),maxResponseBytes));
  if(!status||status>=400||result.ok===false)throw new KTeamError(String(result.code??'host_request_failed'),status,result.details);
  return result;
}

function hostResponse(root:string,client:ClientId,route:string,value:unknown,maxResponseBytes:number){
  const token=clientToken(root,client);
  return new Promise<{status:number;contentType?:string;body:Buffer}>((resolve,reject)=>{
    const req = localRequest(root,{ path: route, agent: false, method: value === undefined ? 'GET' : 'POST',
      headers: { authorization: 'Bearer ' + token, ...versionHeaders(), ...(value !== undefined ? { 'content-type': 'application/json' } : {}) },
    }, res => {
      const status=res.statusCode??0;
      const cap=status>=400?Math.min(maxResponseBytes,2*1024*1024):maxResponseBytes;
      const chunks: Buffer[] = []; let size = 0;
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > cap) { res.destroy(new KTeamError('host_response_too_large')); return; }
        chunks.push(chunk);
      });
      res.on('error', reject);
      res.on('end',()=>resolve({status,contentType:res.headers['content-type'],body:Buffer.concat(chunks,size)}));
    });
    req.on('error', reject);
    req.setTimeout(20_000, () => req.destroy(new KTeamError(value === undefined ? 'host_timeout' : 'host_operation_unknown', 503)));
    if (value !== undefined) req.write(JSON.stringify(value));
    req.end();
  });
}
