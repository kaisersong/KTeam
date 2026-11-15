/** PCM16 WAV is accepted by both Chinese ASR services regardless of MediaRecorder's container. */
export function encodeMonoWav(samples:Float32Array,sampleRate=16000):ArrayBuffer {
 const buffer=new ArrayBuffer(44+samples.length*2),view=new DataView(buffer);
 const text=(offset:number,value:string)=>{for(let i=0;i<value.length;i++)view.setUint8(offset+i,value.charCodeAt(i));};
 text(0,'RIFF');view.setUint32(4,36+samples.length*2,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,samples.length*2,true);
 for(let i=0;i<samples.length;i++){const value=Math.max(-1,Math.min(1,samples[i]??0));view.setInt16(44+i*2,value<0?value*32768:value*32767,true);}return buffer;
}
export async function prepareVoiceAudio(blob:Blob,provider:string){
 if(blob.size===0||blob.size>8*1024*1024)throw Error('voice_audio_invalid');
 let audio=blob;
 if(provider==='volcengine'){
  const context=new AudioContext();
  try{
   const decoded=await context.decodeAudioData(await blob.arrayBuffer());
   if(!decoded.duration||decoded.duration>60)throw Error('voice_audio_invalid');
   const renderer=new OfflineAudioContext(1,Math.ceil(decoded.duration*16000),16000),source=renderer.createBufferSource();source.buffer=decoded;source.connect(renderer.destination);source.start();
   const pcm=await renderer.startRendering();audio=new Blob([encodeMonoWav(pcm.getChannelData(0))],{type:'audio/wav'});
  }catch{throw Error('voice_audio_conversion_failed');}finally{await context.close();}
 }
 const audioBase64=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(Error('voice_audio_invalid'));reader.onload=()=>resolve(String(reader.result).split(',')[1]??'');reader.readAsDataURL(audio);});
 return {audioBase64,mimeType:audio.type};
}
