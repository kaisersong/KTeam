import {transcribeVolcengineSocket} from './voice-volcengine.js';
import {randomUUID} from 'node:crypto';
import {KTeamError,fields,record} from '../errors.js';
import {readIntegrations,integrationRevision} from './integration-settings.js';

const mimeFormats:Record<string,string>={'audio/webm':'webm','audio/ogg':'ogg','audio/mp4':'m4a','audio/wav':'wav','audio/mpeg':'mp3'};
function failure(status:number,code?:string):never {
 if(status===401||status===403||['InvalidApiKey','Unauthorized','AuthenticationError'].includes(code??''))throw new KTeamError('voice_auth_failed',502);
 if(status===429||['Throttling','Throttling.RateQuota','QuotaExhausted','Arrearage'].includes(code??''))throw new KTeamError('voice_quota_exceeded',502);
 throw new KTeamError('voice_transcription_failed',502);
}
/** Only the saved default profile supplies the endpoint and credentials. No fallback or retry uploads audio elsewhere. */
export async function transcribeAudio(input:unknown){
 const v=record(input);fields(v,['audioBase64','mimeType','expectedRevision']);
 if(typeof v.audioBase64!=='string'||v.audioBase64.length>12*1024*1024||!/^[-A-Za-z0-9+/=]+$/.test(v.audioBase64)||!Object.hasOwn(mimeFormats,String(v.mimeType)))throw new KTeamError('voice_audio_invalid');
 const bytes=Buffer.from(v.audioBase64,'base64');
 if(bytes.length>8*1024*1024||!bytes.length||bytes.toString('base64')!==v.audioBase64)throw new KTeamError('voice_audio_invalid');
 if(v.expectedRevision!==undefined&&v.expectedRevision!==await integrationRevision())throw new KTeamError('integration_changed',409);
 const voice=(await readIntegrations('voice')).voice,settings=voice.defaultProfileId?voice.profiles[voice.defaultProfileId]:voice;
 const provider=settings?.provider??'whisper';
 if(!voice.asrEnabled||!settings?.baseUrl||!settings?.model)throw new KTeamError('voice_asr_unconfigured');
 if(v.expectedRevision!==undefined&&v.expectedRevision!==await integrationRevision())throw new KTeamError('integration_changed',409);
 const headers:Record<string,string>={};let body:string|FormData,url=settings.baseUrl;
 if(provider==='volcengine'){
  if(!['audio/wav','audio/ogg','audio/mpeg'].includes(String(v.mimeType)))throw new KTeamError('voice_audio_unsupported');
  if(settings.authMode==='app-access-key'){
   if(!settings.appKey||!settings.accessKey)throw new KTeamError('voice_asr_unconfigured');
   headers['X-Api-App-Key']=settings.appKey;headers['X-Api-Access-Key']=settings.accessKey;
  }else {if(!settings.apiKey)throw new KTeamError('voice_asr_unconfigured');headers['X-Api-Key']=settings.apiKey;}
  Object.assign(headers,{'Content-Type':'application/json','X-Api-Resource-Id':settings.resourceId,'X-Api-Request-Id':randomUUID(),'X-Api-Sequence':'-1'});
  if(/^wss?:/.test(settings.baseUrl)){if(v.mimeType!=='audio/wav')throw new KTeamError('voice_audio_unsupported');const text=await transcribeVolcengineSocket(bytes,settings,headers);return {ok:true,text};}
  body=JSON.stringify({user:{uid:'kteam-desktop'},audio:{data:v.audioBase64},request:{model_name:settings.model,enable_itn:true,enable_punc:true}});
 }else if(provider==='qwen'){
  if(!settings.apiKey)throw new KTeamError('voice_asr_unconfigured');
  url+='/chat/completions';Object.assign(headers,{'Content-Type':'application/json',Authorization:'Bearer '+settings.apiKey});
  body=JSON.stringify({model:settings.model,messages:[{role:'user',content:[{type:'input_audio',input_audio:{data:`data:${v.mimeType};base64,${v.audioBase64}`}}]}],stream:false,asr_options:{enable_itn:true,...(voice.language?{language:voice.language}:{})}});
 }else if(provider==='whisper'){
  url+='/audio/transcriptions';const form=new FormData();form.append('file',new Blob([bytes],{type:String(v.mimeType)}),'speech.'+mimeFormats[String(v.mimeType)]);form.append('model',settings.model);if(voice.language)form.append('language',voice.language);if(settings.apiKey)headers.Authorization='Bearer '+settings.apiKey;body=form;
 }else throw new KTeamError('voice_asr_unconfigured');
 try{
  const result=await fetch(url,{method:'POST',headers,body,redirect:'error',signal:AbortSignal.timeout(60000)});
  if(!result.ok)failure(result.status);
  const status=result.headers.get('X-Api-Status-Code');
  if(provider==='volcengine'&&status!=='20000000'){
   if(status==='20000003')throw new KTeamError('voice_no_speech',502);
   failure(502);
  }
  const data:any=await result.json();if(data.error||data.code)failure(502,data.error?.code??data.code);
  const text=provider==='volcengine'?data.result?.text:provider==='qwen'?data.choices?.[0]?.message?.content:data.text;
  if(typeof text!=='string'||text.length>32000)failure(502);
  if(!text.trim())throw new KTeamError('voice_no_speech',502);
  return {ok:true,text};
 }catch(error){
  if(error instanceof KTeamError)throw error;
  if((error as Error)?.name==='TimeoutError'||(error as Error)?.name==='AbortError')throw new KTeamError('voice_request_timeout',504);
  throw new KTeamError('voice_transcription_failed',502);
 }
}
