import {dialog,shell,type BrowserWindow} from 'electron';
import {spawn,type ChildProcess} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {hostRequest} from '../src/service/client.js';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {record,fields} from '../src/errors.js';

/** File locations and canonical speech content stay in main; renderer supplies only Room IDs. */
export function nativeActions(root:string,getWindow:()=>BrowserWindow|undefined){
 let speech:ChildProcess|undefined,speakingId:string|undefined;
 const fail=(code:string):never=>{throw Object.assign(Error(code),{code});};
 const field=(value:unknown)=>typeof value==='string'&&value.length>0&&value.length<=256?value:fail('invalid_input');
 const scope=(input:any)=>'/v1/teams/'+encodeURIComponent(field(input?.roomId));
 const stop=async()=>{const old=speech;if(old&&old.exitCode===null&&old.signalCode===null){old.kill('SIGTERM');await Promise.race([new Promise<void>(resolve=>old.once('close',()=>resolve())),new Promise<void>(resolve=>setTimeout(resolve,1500))]);if(old.exitCode===null&&old.signalCode===null)fail('speech_stop_unconfirmed');}speech=undefined;speakingId=undefined;return {ok:true};};
 return {
  openSettingsLocation:async(input:any)=>{const value=record(input);fields(value,['location']);const config=process.env.KTEAM_MODEL_CONFIG_DIR??join(root,'runtime');const locations:Record<string,string>={data:root,config,skills:join(config,'skills'),logs:join(root,'host.log')};if(typeof value.location!=='string'||!Object.hasOwn(locations,value.location))fail('desktop_location_forbidden');const error=await shell.openPath(locations[value.location as string]!);if(error)fail('desktop_location_unavailable');return {ok:true};},
  openLibrary:async(input:any)=>{const value=await hostRequest(root,'kteam-main',scope(input)+'/library-open?fileId='+encodeURIComponent(field(input.fileId)));const error=await shell.openPath(String(value.path));if(error)fail('library_open_failed');return {ok:true};},
  readAloud:async(input:any)=>{if(process.platform!=='darwin')fail('speech_unavailable');const value=await hostRequest(root,'kteam-main',scope(input)+'/message?messageId='+encodeURIComponent(field(input.messageId))),message=value.message as any;await stop();if(typeof message?.text!=='string'||!message.text.trim())fail('speech_unavailable');const child=spawn('/usr/bin/say',['--',message.text.slice(0,32768)],{stdio:'ignore'});await new Promise<void>((resolve,reject)=>{child.once('spawn',resolve);child.once('error',()=>reject(Object.assign(Error('speech_unavailable'),{code:'speech_unavailable'})));});speech=child;speakingId=message.messageId;child.once('close',()=>{if(speech===child){speech=undefined;speakingId=undefined;}});return {ok:true,speakingId};},
  stopSpeech:stop,
  speechStatus:async()=>({ok:true,speakingId:speech?speakingId:null}),
  chooseWorkspace:async()=>{const window=getWindow();if(!window)fail('desktop_window_closed');const value=await dialog.showOpenDialog(window!,{title:'选择 Bot 的资料目录',properties:['openDirectory']});return {ok:true,cancelled:value.canceled,path:value.canceled?null:value.filePaths[0]};},
  exportConversation:async(input:any)=>{const route=scope(input),initial=await hostRequest(root,'kteam-main',route+'/shared');void initial;const window=getWindow();if(!window)fail('desktop_window_closed');const saved=await dialog.showSaveDialog(window!,{title:'导出会话',defaultPath:'KTeam-会话.md',filters:[{name:'Markdown',extensions:['md']}]});if(saved.canceled||!saved.filePath)return {ok:true,cancelled:true};const output=['# KTeam 会话\n'];let after=0,complete=false;for(let i=0;i<100;i++){const result=await hostRequest(root,'kteam-main',route+'/messages?after='+after+'&limit=100'),messages=result.messages as any[];for(const m of messages){output.push('## '+(m.sender?.kind==='user'?'我':m.sender?.logicalAgentId??'Bot')+' · '+(m.createdAt??'')+'\n\n'+(m.replyToMessageId?'> 回复 '+m.replyToMessageId+'\n\n':'')+String(m.text??'')+'\n');after=Math.max(after,m.roomSequence);}if(messages.length<100){complete=true;break;}}if(!complete)fail('conversation_export_limit');await hostRequest(root,'kteam-main',route+'/shared');await writeFile(saved.filePath,output.join('\n'),{mode:0o600});return {ok:true,cancelled:false};},
 };
}
