import {createRequire} from 'node:module';
import type {IncomingMessage,ClientRequest} from 'node:http';
const WebSocket=createRequire(import.meta.url)('ws');
import {gzipSync,gunzipSync} from 'node:zlib';
import {randomUUID} from 'node:crypto';
import {KTeamError} from '../errors.js';

/** Send a completed recording to the native SAUC endpoint, returning only its final full transcript. */
export function transcribeVolcengineSocket(audio:Buffer,settings:any,headers:Record<string,string>):Promise<string>{
 // Renderer normalizes browser containers to mono 16kHz PCM16 WAV before this call.
 if(audio.length<44||audio.toString('ascii',0,4)!=='RIFF'||audio.toString('ascii',8,12)!=='WAVE')throw new KTeamError('voice_audio_unsupported');
 let rate=0,channels=0,bits=0,pcm:Buffer|undefined;
 for(let offset=12;offset+8<=audio.length;){const size=audio.readUInt32LE(offset+4),start=offset+8;if(start+size>audio.length)throw new KTeamError('voice_audio_invalid');const tag=audio.toString('ascii',offset,offset+4);if(tag==='fmt '&&size>=16){if(audio.readUInt16LE(start)!==1)throw new KTeamError('voice_audio_unsupported');channels=audio.readUInt16LE(start+2);rate=audio.readUInt32LE(start+4);bits=audio.readUInt16LE(start+14);}if(tag==='data')pcm=audio.subarray(start,start+size);offset=start+size+(size%2);}
 if(!pcm?.length||channels!==1||rate!==16000||bits!==16||pcm.length%2||pcm.length>16000*2*60)throw new KTeamError('voice_audio_unsupported');
 const bytes=pcm;
 const frame=(type:number,flags:number,payload:Buffer,json=false)=>{const compressed=gzipSync(payload),size=Buffer.alloc(4);size.writeUInt32BE(compressed.length);return Buffer.concat([Buffer.from([0x11,type<<4|flags,json?0x11:0x01,0]),size,compressed]);};
 return new Promise((resolve,reject)=>{
  const socket=new WebSocket(settings.baseUrl,{headers:{...headers,'X-Api-Connect-Id':randomUUID()},handshakeTimeout:15000,maxPayload:1024*1024,followRedirects:false});let settled=false;
  const finish=(error?:KTeamError,text?:string)=>{if(settled)return;settled=true;clearTimeout(timer);socket.terminate();if(error)reject(error);else resolve(text!);};
  const timer=setTimeout(()=>finish(new KTeamError('voice_request_timeout',504)),60000);
  socket.on('open',()=>{
   socket.send(frame(1,0,Buffer.from(JSON.stringify({user:{uid:'kteam-desktop'},audio:{format:'pcm',codec:'raw',rate,bits,channel:channels},request:{model_name:settings.model,enable_itn:true,enable_punc:true,result_type:'full'}})),true));
   // 200ms packets with a final marker; this is an upload of a completed recording, not UI streaming.
   for(let offset=0;offset<bytes.length;offset+=6400){const end=Math.min(offset+6400,bytes.length);socket.send(frame(2,end===bytes.length?2:0,bytes.subarray(offset,end)));}
  });
  socket.on('message',(raw:Buffer,binary:boolean)=>{
   if(settled)return;
   try{
    const data=Buffer.isBuffer(raw)?raw:Buffer.from(raw as ArrayBuffer);
    if(!binary||data.length<8||data[0]!>>4!==1)throw Error();
    const header=(data[0]!&15)*4,type=data[1]!>>4,flags=data[1]!&15,compression=data[2]!&15;
    if(header<4||header>data.length||![0,1].includes(compression))throw Error();
    if(type===15){finish(new KTeamError('voice_transcription_failed',502));return;}
    if(type!==9)throw Error();let offset=header+(flags&1?4:0);if(offset+4>data.length)throw Error();const length=data.readUInt32BE(offset);offset+=4;if(offset+length!==data.length)throw Error();
    const encoded=data.subarray(offset),decoded=compression?gunzipSync(encoded,{maxOutputLength:1024*1024}):encoded,value=JSON.parse(decoded.toString('utf8'));
    if(flags&2){const text=value.result?.text;if(typeof text!=='string'||text.length>32000)throw Error();finish(text.trim()?undefined:new KTeamError('voice_no_speech',502),text);}
   }catch{finish(new KTeamError('voice_transcription_failed',502));}
  });
  socket.on('unexpected-response',(_req:ClientRequest,response:IncomingMessage)=>{response.resume();finish(new KTeamError(response.statusCode===401||response.statusCode===403?'voice_auth_failed':response.statusCode===429?'voice_quota_exceeded':'voice_transcription_failed',502));});
  socket.on('error',()=>finish(new KTeamError('voice_transcription_failed',502)));
  socket.on('close',()=>finish(new KTeamError('voice_transcription_failed',502)));
 });
}
