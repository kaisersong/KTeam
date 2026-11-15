import {createRequire} from 'node:module';
import {gzipSync,gunzipSync} from 'node:zlib';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {privateTempDir} from './helpers/private-temp.js';
import {readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import http from 'node:http';
import {IntegrationSettings,integrationDefaults,readIntegrations} from '../src/service/integration-settings.js';
import {transcribeAudio} from '../src/service/voice.js';
import {encodeMonoWav} from '../desktop/renderer/src/voice-audio.js';

const clean=(voice:any)=>{const copy=structuredClone(voice);delete copy.hasApiKey;for(const row of Object.values(copy.profiles) as any[])for(const key of ['hasApiKey','hasAppKey','hasAccessKey'])delete row[key];return copy;};
const wav=Buffer.from(encodeMonoWav(new Float32Array(1600))).toString('base64');
async function fixture(){
 const root=privateTempDir(join(tmpdir(),'kteam-asr-')),before=process.env.KTEAM_MODEL_CONFIG_DIR;process.env.KTEAM_MODEL_CONFIG_DIR=join(root,'config');
 const calls:{url:string;headers:http.IncomingHttpHeaders;body:any}[]=[];let status=200,providerCode='20000000',response:any={result:{text:'豆包测试'}};
 const server=http.createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;calls.push({url:req.url!,headers:req.headers,body:JSON.parse(body)});res.writeHead(status,{'Content-Type':'application/json','X-Api-Status-Code':providerCode});res.end(JSON.stringify(response));});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 return {root,server,calls,settings:new IntegrationSettings(),baseUrl:'http://127.0.0.1:'+(server.address() as any).port,setResponse:(value:any,code='20000000',httpStatus=200)=>{response=value;providerCode=code;status=httpStatus;},close:async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));if(before===undefined)delete process.env.KTEAM_MODEL_CONFIG_DIR;else process.env.KTEAM_MODEL_CONFIG_DIR=before;rmSync(root,{recursive:true,force:true});}};
}
test('豆包和千问 use their native protocols and only the selected protected credentials; edits and restart preserve them',async()=>{
 const f=await fixture();try{
  let state=await f.settings.view();state=await f.settings.save({expectedRevision:state.revision,section:'voice',value:{...integrationDefaults().voice,asrEnabled:true,defaultProfileId:'doubao',profiles:{doubao:{name:'豆包',provider:'volcengine',authMode:'app-access-key',appKey:'FICTIONAL_APP',accessKey:'FICTIONAL_ACCESS',baseUrl:f.baseUrl+'/flash',model:'bigmodel',resourceId:'volc.bigasr.auc_turbo'},qwen:{name:'千问',provider:'qwen',baseUrl:f.baseUrl+'/compatible-mode/v1',model:'qwen3-asr-flash',apiKey:'FICTIONAL_QWEN'}}}});
  assert(!JSON.stringify(state).includes('FICTIONAL_'));assert(!readFileSync(join(f.root,'config/integrations.json'),'utf8').includes('FICTIONAL_'));
  assert.equal(state.settings.voice.profiles.doubao.hasAppKey,true);assert.equal(state.settings.voice.profiles.doubao.hasAccessKey,true);assert.equal((await readIntegrations('voice')).voice.profiles.qwen.apiKey,undefined);
  const audio={audioBase64:wav,mimeType:'audio/wav',expectedRevision:state.revision};assert.equal((await transcribeAudio(audio)).text,'豆包测试');
  const first=f.calls[0]!;assert.equal(first.url,'/flash');assert.equal(first.headers['x-api-app-key'],'FICTIONAL_APP');assert.equal(first.headers['x-api-access-key'],'FICTIONAL_ACCESS');assert.equal(first.headers['x-api-key'],undefined);assert.equal(first.headers['x-api-resource-id'],'volc.bigasr.auc_turbo');assert.equal(first.headers['x-api-sequence'],'-1');assert.equal(first.body.audio.data,wav);assert.equal(first.body.request.model_name,'bigmodel');
  const voice=clean(state.settings.voice);voice.profiles.doubao.name='改名';state=await f.settings.save({expectedRevision:state.revision,section:'voice',value:voice});
  const restarted=new IntegrationSettings();assert.equal((await restarted.view()).settings.voice.profiles.doubao.hasAccessKey,true);await transcribeAudio({...audio,expectedRevision:state.revision});assert.equal(f.calls.at(-1)!.headers['x-api-access-key'],'FICTIONAL_ACCESS');
  voice.defaultProfileId='qwen';state=await f.settings.save({expectedRevision:state.revision,section:'voice',value:voice});f.setResponse({choices:[{message:{content:'千问测试'}}]});
  await assert.rejects(transcribeAudio(audio),/integration_changed/);const before=f.calls.length;assert.equal((await transcribeAudio({...audio,expectedRevision:state.revision})).text,'千问测试');assert.equal(f.calls.length,before+1);
  const last=f.calls.at(-1)!;assert.equal(last.url,'/compatible-mode/v1/chat/completions');assert.equal(last.headers.authorization,'Bearer FICTIONAL_QWEN');assert.equal(last.headers['x-api-app-key'],undefined);assert.equal(last.body.model,'qwen3-asr-flash');assert.deepEqual(last.body.asr_options,{language:'zh',enable_itn:true});assert.equal(last.body.messages[0].content[0].input_audio.data,'data:audio/wav;base64,'+wav);
  assert.equal((await readIntegrations('voice')).voice.profiles.doubao.accessKey,undefined);
  const copy=clean(state.settings.voice);copy.language='';state=await f.settings.save({expectedRevision:state.revision,section:'voice',value:copy});await transcribeAudio({...audio,expectedRevision:state.revision});assert.equal(f.calls.at(-1)!.body.asr_options.language,undefined);
  delete copy.profiles.doubao;state=await f.settings.save({expectedRevision:state.revision,section:'voice',value:copy});assert.equal(state.settings.voice.profiles.doubao,undefined);assert(!readFileSync(join(f.root,'config/integrations.json'),'utf8').includes('"accessKey"'));
 }finally{await f.close();}
});
test('豆包新版 API Key, failures, disabled input and invalid provider settings never upload to a fallback',async()=>{
 const f=await fixture();try{
  let state=await f.settings.view();const voice={...integrationDefaults().voice,asrEnabled:true,defaultProfileId:'new',profiles:{new:{name:'新版豆包',provider:'volcengine',authMode:'api-key',apiKey:'FICTIONAL_NEW_KEY',baseUrl:f.baseUrl,model:'bigmodel',resourceId:'volc.bigasr.auc_turbo'}}};
  state=await f.settings.save({expectedRevision:state.revision,section:'voice',value:voice});const audio={audioBase64:wav,mimeType:'audio/wav'};
  await transcribeAudio(audio);assert.equal(f.calls[0]!.headers['x-api-key'],'FICTIONAL_NEW_KEY');assert.equal(f.calls[0]!.headers['x-api-access-key'],undefined);
  for(const [payload,code,status,error]of [[{},'20000003',200,'voice_no_speech'],[{},'45000001',200,'voice_transcription_failed'],[{result:{text:''}},'20000000',200,'voice_no_speech'],[{},'20000000',401,'voice_auth_failed'],[{},'20000000',429,'voice_quota_exceeded'],[{error:{message:'FICTIONAL_SECRET_ECHO'}},'20000000',200,'voice_transcription_failed']] as const){f.setResponse(payload,code,status);const before=f.calls.length;await assert.rejects(transcribeAudio(audio),new RegExp(error));assert.equal(f.calls.length,before+1);}
  f.setResponse({result:{text:'恢复成功'}});await transcribeAudio(audio);
  let before=f.calls.length;await assert.rejects(transcribeAudio({...audio,mimeType:'audio/webm'}),/voice_audio_unsupported/);assert.equal(f.calls.length,before);
  await assert.rejects(transcribeAudio({...audio,baseUrl:'http://example.invalid'}),/unknown_field/);
  const broken=clean(state.settings.voice);broken.profiles.new.provider='qwen';await assert.rejects(f.settings.save({expectedRevision:state.revision,section:'voice',value:broken}),/integration_input_invalid/);
  await assert.rejects(f.settings.save({expectedRevision:state.revision,section:'voice',value:{...voice,profiles:{other:{name:'未配置千问',provider:'qwen',baseUrl:f.baseUrl,model:'qwen3-asr-flash'}}}}),/voice_credentials_required/);
  assert.equal((await f.settings.view()).revision,state.revision);
  const disabled=clean(state.settings.voice);disabled.asrEnabled=false;state=await f.settings.save({expectedRevision:state.revision,section:'voice',value:disabled});before=f.calls.length;await assert.rejects(transcribeAudio(audio),/voice_asr_unconfigured/);assert.equal(f.calls.length,before);assert.equal((await readIntegrations('voice')).voice.profiles.new.apiKey,undefined);
 }finally{await f.close();}
});
test('WAV encoding writes mono PCM16 with correct duration and clamps samples',()=>{
 const encoded=Buffer.from(encodeMonoWav(new Float32Array([-2,-1,0,1,2])));assert.equal(encoded.toString('ascii',0,4),'RIFF');assert.equal(encoded.toString('ascii',8,12),'WAVE');assert.equal(encoded.readUInt16LE(22),1);assert.equal(encoded.readUInt32LE(24),16000);assert.equal(encoded.readUInt32LE(40),10);assert.equal(encoded.readInt16LE(44),-32768);assert.equal(encoded.readInt16LE(52),32767);
});

test('豆包 native WebSocket sends PCM packets and accepts only final bounded results; malformed replies and disconnects settle without retry',async()=>{
 const {WebSocketServer}=createRequire(import.meta.url)('ws');const f=await fixture(),wss=new WebSocketServer({server:f.server});let mode='ok',connections=0,request:any,headers:any;const packets:Buffer[]=[];
 const response=(text:string,final:boolean)=>{const body=gzipSync(Buffer.from(JSON.stringify({result:{text}}))),prefix=Buffer.alloc(12);prefix.set([0x11,final?0x93:0x91,0x11,0]);prefix.writeInt32BE(final?-1:1,4);prefix.writeUInt32BE(body.length,8);return Buffer.concat([prefix,body]);};
 wss.on('connection',(socket:any,req:any)=>{connections++;headers=req.headers;socket.on('message',(raw:Buffer)=>{
  if(mode==='drop'){socket.close();return;}if(mode==='invalid'){socket.send(Buffer.from([0x11]));return;}
  const type=raw[1]!>>4,payload=gunzipSync(raw.subarray(8));if(type===1){request=JSON.parse(payload.toString());socket.send(response('未完成结果',false));}else{packets.push(payload);if(raw[1]!&2)socket.send(response('最终完整文字',true));}
 });});
 try{
  let state=await f.settings.view();state=await f.settings.save({expectedRevision:state.revision,section:'voice',value:{...integrationDefaults().voice,asrEnabled:true,defaultProfileId:'socket',profiles:{socket:{name:'豆包流式',provider:'volcengine',authMode:'api-key',apiKey:'FICTIONAL_WS_KEY',baseUrl:f.baseUrl.replace('http:','ws:')+'/sauc/bigmodel_async',model:'bigmodel',resourceId:'volc.seedasr.sauc.duration'}}}});
  const recording=Buffer.from(encodeMonoWav(new Float32Array(16000))),audio={audioBase64:recording.toString('base64'),mimeType:'audio/wav'};
  assert.equal((await transcribeAudio(audio)).text,'最终完整文字');assert.equal(connections,1);assert.equal(headers['x-api-key'],'FICTIONAL_WS_KEY');assert.equal(headers['x-api-resource-id'],'volc.seedasr.sauc.duration');assert(headers['x-api-connect-id']);assert.deepEqual(request.audio,{format:'pcm',codec:'raw',rate:16000,bits:16,channel:1});assert.equal(request.request.result_type,'full');assert(Buffer.concat(packets).equals(recording.subarray(44)));assert.equal(packets.length,5);
  mode='drop';await assert.rejects(transcribeAudio(audio),/voice_transcription_failed/);assert.equal(connections,2);
  mode='invalid';await assert.rejects(transcribeAudio(audio),/voice_transcription_failed/);assert.equal(connections,3);
  await assert.rejects(transcribeAudio({...audio,audioBase64:'YWJj'}),/voice_audio_unsupported/);assert.equal(connections,3);
 }finally{for(const socket of wss.clients)socket.terminate();await new Promise<void>(r=>wss.close(()=>r()));await f.close();}
});
