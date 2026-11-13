import {computerPermissionSettingsUrl} from './computer-permissions.js';
import {clipboardFileURLs,clipboardFileBytes,macClipboardPaths} from './clipboard-files.js';
import {randomBytes} from 'node:crypto';
import {messageDisplayText,attachmentMessageView} from '../src/protocol/message-attachments.js';
import {parseSystemVoices} from './system-voices.js';
import {promisify} from 'node:util';
import {clipboard,dialog,shell,type BrowserWindow} from 'electron';
import {execFile,spawn,type ChildProcess} from 'node:child_process';
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
 const voiceSettings=async()=>{const value=await hostRequest(root,'kteam-main','/v1/app/integrations');return (value.settings as any).voice;};
 const speak=async(text:string,id:string)=>{if(process.platform!=='darwin')fail('speech_unavailable');const config=await voiceSettings();await stop();const child=spawn('/usr/bin/say',[...(config.voice?['-v',config.voice]:[]),'-r',String(config.rate),'--',text.slice(0,32768)],{stdio:'ignore'});await new Promise<void>((resolve,reject)=>{child.once('spawn',resolve);child.once('error',()=>reject(Object.assign(Error('speech_unavailable'),{code:'speech_unavailable'})));});speech=child;speakingId=id;child.once('close',()=>{if(speech===child){speech=undefined;speakingId=undefined;}});return {ok:true,speakingId};};
 return {
  openComputerPermissionSettings:async(input:unknown)=>{await shell.openExternal(computerPermissionSettingsUrl(input));return {ok:true};},
  pasteAttachments:async(input:any)=>{const value=record(input);fields(value,['roomId']);const roomId=field(value.roomId),view=await hostRequest(root,'kteam-main','/v1/composer-attachments?roomId='+encodeURIComponent(roomId));if(!view.canAttach)fail('attachment_owner_required');
   let paths=process.platform==='darwin'?await macClipboardPaths(clipboard.readBuffer('NSFilenamesPboardType')):[];if(!paths.length)paths=clipboardFileURLs(clipboard.read('public.file-url')||clipboard.read('text/uri-list'));
   if(!paths.length&&process.platform==='win32'){const file=clipboard.readBuffer('FileNameW').toString('utf16le').split('\0')[0];if(file)paths=[file];}
   const files=await clipboardFileBytes(paths);if(!files.length){const image=clipboard.readImage();if(!image.isEmpty()){const bytes=image.toPNG();if(bytes.length>4*1024*1024)fail('library_file_too_large');files.push({name:'粘贴图片.png',data:bytes.toString('base64')});}}
   if((view.uploads as any[]).length+files.length>4)fail('attachment_limit');
   for(const file of files)await hostRequest(root,'kteam-main','/v1/composer-attachments/upload',{roomId,id:'upload_'+randomBytes(16).toString('hex'),...file});return {ok:true,count:files.length};
  },
  openMemberWorkspace:async(input:any)=>{const value=record(input);fields(value,['botId','roomId','expectedProfileRevision']);if(!Number.isSafeInteger(value.expectedProfileRevision))fail('member_workspace_changed');const result=await hostRequest(root,'kteam-main','/v1/member-workspace/folder?botId='+encodeURIComponent(field(value.botId))+'&roomId='+encodeURIComponent(field(value.roomId))+'&expectedProfileRevision='+String(value.expectedProfileRevision));const error=await shell.openPath(String(result.path));if(error)fail('member_workspace_unavailable');return {ok:true};},
  voiceOptions:async()=>{if(process.platform!=='darwin')return {ok:true,voices:[],available:false};const result=await promisify(execFile)('/usr/bin/say',['-v','?'],{timeout:5000,maxBuffer:512*1024});return {ok:true,available:true,voices:parseSystemVoices(result.stdout)};},
  previewVoice:async()=>speak('你好，我是小K，准备和你一起工作。','settings-preview'),
  openSettingsLocation:async(input:any)=>{const value=record(input);fields(value,['location']);const config=process.env.KTEAM_MODEL_CONFIG_DIR??join(root,'runtime');const locations:Record<string,string>={data:root,config,skills:join(config,'skills'),logs:join(root,'host.log')};if(typeof value.location!=='string'||!Object.hasOwn(locations,value.location))fail('desktop_location_forbidden');const error=await shell.openPath(locations[value.location as string]!);if(error)fail('desktop_location_unavailable');return {ok:true};},
  openGeneratedFile:async(input:any)=>{const value=record(input);fields(value,['roomId','toolCallId']);const result=await hostRequest(root,'kteam-main',scope(value)+'/generated-file-open?toolCallId='+encodeURIComponent(field(value.toolCallId)));const error=await shell.openPath(String(result.path));if(error)fail('generated_file_open_failed');return {ok:true};},
  openLibrary:async(input:any)=>{const value=await hostRequest(root,'kteam-main',scope(input)+'/library-open?fileId='+encodeURIComponent(field(input.fileId)));const error=await shell.openPath(String(value.path));if(error)fail('library_open_failed');return {ok:true};},
  readAloud:async(input:any)=>{const value=await hostRequest(root,'kteam-main',scope(input)+'/message?messageId='+encodeURIComponent(field(input.messageId))),message=value.message as any;if(typeof message?.text!=='string'||!message.text.trim())fail('speech_unavailable');const payload=attachmentMessageView(message),spoken=messageDisplayText(message)+(payload?'\n'+payload.attachments.map(file=>file.name).join('\n'):'');return speak(spoken,message.messageId);},
  stopSpeech:stop,
  speechStatus:async()=>({ok:true,speakingId:speech?speakingId:null}),
  chooseWorkspace:async()=>{const window=getWindow();if(!window)fail('desktop_window_closed');const value=await dialog.showOpenDialog(window!,{title:'选择 Bot 的资料目录',properties:['openDirectory']});return {ok:true,cancelled:value.canceled,path:value.canceled?null:value.filePaths[0]};},
  exportConversation:async(input:any)=>{const route=scope(input),initial=await hostRequest(root,'kteam-main',route+'/shared');void initial;const window=getWindow();if(!window)fail('desktop_window_closed');const saved=await dialog.showSaveDialog(window!,{title:'导出会话',defaultPath:'KTeam-会话.md',filters:[{name:'Markdown',extensions:['md']}]});if(saved.canceled||!saved.filePath)return {ok:true,cancelled:true};const user=await hostRequest(root,'kteam-main','/v1/app/preferences'),displayName=(user.preferences as any).displayName??'我';const output=['# KTeam 会话\n'];let after=0,complete=false;for(let i=0;i<100;i++){const result=await hostRequest(root,'kteam-main',route+'/messages?after='+after+'&limit=100'),messages=result.messages as any[];for(const m of messages){output.push('## '+(m.sender?.kind==='user'?displayName:m.sender?.logicalAgentId??'Bot')+' · '+(m.createdAt??'')+'\n\n'+(m.replyToMessageId?'> 回复 '+m.replyToMessageId+'\n\n':'')+messageDisplayText(m)+(attachmentMessageView(m)?'\n\n'+attachmentMessageView(m)!.attachments.map(file=>'[file] '+file.name+' ('+file.bytes+' bytes)').join('\n'):'')+'\n');after=Math.max(after,m.roomSequence);}if(messages.length<100){complete=true;break;}}if(!complete)fail('conversation_export_limit');await hostRequest(root,'kteam-main',route+'/shared');await writeFile(saved.filePath,output.join('\n'),{mode:0o600});return {ok:true,cancelled:false};},
 };
}
