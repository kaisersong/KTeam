import {mkdtemp,rename,rm,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {KTeamError} from '../src/errors.js';
import {artifactDownloadRoute,type ArtifactDownloadIdentity} from '../src/protocol/artifact-download.js';
import {hostArtifactDownload,hostRequest} from '../src/service/client.js';

export async function saveArtifact(root:string,source:ArtifactDownloadIdentity,choosePath:(name:string)=>Promise<string|undefined>){
 const metadata=await hostRequest(root,'kteam-main',artifactDownloadRoute+'?metadata=1',source);
 if(typeof metadata.name!=='string')throw new KTeamError('artifact_download_failed');
 const filePath=await choosePath(metadata.name);
 if(!filePath)return {ok:true as const,cancelled:true};

 // Revalidate the current Room and the original bytes after the chooser returns.
 const bytes=await hostArtifactDownload(root,source);
 let temporary:string|undefined;
 try{
  temporary=await mkdtemp(join(dirname(filePath),'.kteam-download-'));
  const staged=join(temporary,'artifact');
  await writeFile(staged,bytes,{mode:0o600,flag:'wx'});
  await rename(staged,filePath);
 }catch{
  throw new KTeamError('artifact_save_failed');
 }finally{
  if(temporary)await rm(temporary,{recursive:true,force:true}).catch(()=>{});
 }
 return {ok:true as const,cancelled:false};
}

export function artifactSaveName(name:string,platform=process.platform){
 const basename=name.replace(/[/\\\u0000-\u001f\u007f]/g,'_');
 if(platform!=='win32')return basename&&basename!=='.'&&basename!=='..'?basename:'KTeam-产物';
 const clean=basename.replace(/[<>:"|?*]/g,'_').replace(/[. ]+$/,'');
 if(/^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/i.test(clean))return '_'+clean;
 return clean||'KTeam-产物';
}
