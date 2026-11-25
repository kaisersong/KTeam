import {ConversationSidebar} from '../src/service/sidebar.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join,resolve} from 'node:path';
import {mkdirSync,existsSync,readFileSync,readdirSync,writeFileSync,linkSync,unlinkSync} from 'node:fs';
import {realUpstreams} from './helpers/real-upstreams.js';
import {TeamStore} from '../src/service/team-store.js';
import {TeamCoordinator} from '../src/service/coordination.js';
import {TeamAutomation} from '../src/service/automation.js';
import {ConversationService,libraryFileIdentity} from '../src/service/conversation.js';
import {ComposerAttachments} from '../src/service/composer-attachments.js';
import {parseAttachmentMessage,attachmentMessageView,messageDisplayText,messagePreviewText} from '../src/protocol/message-attachments.js';
import {CollaborationService} from '../src/service/collaboration.js';
import {intentHash,validateL0} from '../src/protocol/aimp.js';
import {initConfig} from '../src/service/config.js';
import {startHost} from '../src/service/server.js';
import {hostRequest} from '../src/service/client.js';
import {createDesktopAPI,dispatchDesktop} from '../desktop/semantic-api.js';
import {KTeamError} from '../src/errors.js';
import {artifactSaveName,saveArtifact} from '../desktop/artifact-download.js';
import {artifactDownloadRoute} from '../src/protocol/artifact-download.js';
async function fixture(){process.env.KTEAM_RUNTIME_ENTRY=resolve('build/shared/kteam-runtime.mjs');const f=await realUpstreams(),root=join(f.root,'host'),config=join(f.root,'config'),previous=process.env.KTEAM_MODEL_CONFIG_DIR;mkdirSync(root,{mode:0o700});mkdirSync(config);process.env.KTEAM_MODEL_CONFIG_DIR=config;const store=new TeamStore(root),coordinator=new TeamCoordinator(f.upstream,store,1,{catalog:async()=>({defaultModelId:'fixture'}),identity:async()=>({model:'fixture',fingerprint:'fixture'})}),conversations=new ConversationService(root,f.upstream,store);try{const a=await coordinator.createMember({name:'附件验收员',modelId:'fixture',requestId:'attachment-a'},{requestSource:'user'}),b=await coordinator.createMember({name:'另一合成成员',modelId:'fixture',requestId:'attachment-b'},{requestSource:'user'}),automation=new TeamAutomation(f.upstream,store,1,undefined,coordinator),attachments=new ComposerAttachments(root,f.upstream,store,conversations,room=>automation.reconcileSubmissions(room));store.setState('assistant-proactivity',{enabled:false});return {...f,root,store,coordinator,conversations,a,b,automation,attachments,async close(){await automation.close();store.close();if(previous===undefined)delete process.env.KTEAM_MODEL_CONFIG_DIR;else process.env.KTEAM_MODEL_CONFIG_DIR=previous;await f.close();}};}catch(error){store.close();if(previous===undefined)delete process.env.KTEAM_MODEL_CONFIG_DIR;else process.env.KTEAM_MODEL_CONFIG_DIR=previous;await f.close();throw error;}}
const upload=(roomId:string,letter='a',extra={})=>({roomId,id:'upload_'+letter.repeat(32),name:'fictional-'+letter+'.txt',data:Buffer.from('FICTIONAL_ATTACHMENT_'+letter).toString('base64'),...extra});
const send=(roomId:string,ids:string[],extra={})=>({roomId,id:'msg_'+'e'.repeat(32),text:'请核对这些合成附件。',uploadIds:ids,...extra});
test('a staged attachment keeps its identity across a hostname change and previews only verified local bytes',async()=>{
 const f=await fixture();
 try{
  const roomId=f.a.roomId,input=upload(roomId),staged=await f.attachments.stage(input),id=staged.upload!.id;
  const op=f.store.operation('composer-upload:'+id),hostId='fixture-before-rename.local';
  const file={...staged.upload!.file,hostId,fileId:libraryFileIdentity(roomId,staged.upload!.file.name,staged.upload!.file.sha256,hostId)};
  f.store.saveOperation({...op,file},op.revision);
  const message=await f.attachments.send(send(roomId,[id],{text:''}));
  const attachment={roomId,messageId:message.messageId,fileId:file.fileId};
  assert.equal((await f.attachments.preview(attachment)).preview,'FICTIONAL_ATTACHMENT_a');
  const path=join(f.conversations.libraryDirectory(roomId),file.fileId+'.txt');
  writeFileSync(path,Buffer.alloc(file.bytes,1));
  await assert.rejects(f.attachments.preview(attachment),/library_file_changed/);
  unlinkSync(path);
  await assert.rejects(f.attachments.preview(attachment),/library_file_other_host/);
 }finally{await f.close();}
});
test('only an unsent message can be stopped; already registered public files remain while private bytes and the original pending outbox are cancelled',async()=>{const f=await fixture();try{const first=await f.attachments.stage(upload(f.a.roomId)),second=await f.attachments.stage(upload(f.a.roomId,'b')),original=f.upstream.updateConversation.bind(f.upstream);let posts=0;f.upstream.updateConversation=async(roomId:string,input:any,...rest:any[])=>{if(input.operation==='library.register'&&++posts===2)throw new KTeamError('upstream_operation_unknown',503);return original(roomId,input,...rest);};const input=send(f.a.roomId,[first.upload!.id,second.upload!.id]);await assert.rejects(f.attachments.send(input));assert.equal(((await f.conversations.data(f.a.roomId)).library as any[]).length,1);assert.equal((await f.attachments.cancelSend({roomId:f.a.roomId,id:input.id})).cancelled,true);assert.equal(f.store.submission(input.id).state,'cancelled');assert.equal(f.store.submissionEnvelope(input.id),undefined);assert.equal((await f.attachments.cancelSend({roomId:f.a.roomId,id:input.id})).reused,true);await assert.rejects(f.attachments.send(input),/attachment_send_cancelled/);await f.automation.reconcileSubmissions(f.a.roomId);assert.equal(f.store.jobs().length,0);assert.equal((await f.upstream.messages(f.a.roomId,0,100)).messages.length,0);assert.equal(((await f.conversations.data(f.a.roomId)).library as any[]).length,1);assert.equal(readdirSync(join(f.root,'composer-uploads')).filter(name=>name.endsWith('.bin')).length,0);assert.equal(posts,2);}finally{await f.close();}});
test('unknown message delivery cannot be cancelled or posted again; cancellation and resume share the same in-flight exclusion',async()=>{const f=await fixture();let release!:()=>void;try{const staged=await f.attachments.stage(upload(f.a.roomId)),gate=new Promise<void>(resolve=>release=resolve);let posts=0;f.upstream.sendMessage=async()=>{posts++;await gate;throw new KTeamError('upstream_operation_unknown',503);};const input=send(f.a.roomId,[staged.upload!.id]),pending=assert.rejects(f.attachments.send(input));while(posts===0)await new Promise(resolve=>setTimeout(resolve,5));await assert.rejects(f.attachments.cancelSend({roomId:f.a.roomId,id:input.id}),/attachment_send_busy/);release();await pending;await assert.rejects(f.attachments.send(input),/attachment_delivery_unknown/);await assert.rejects(f.attachments.cancelSend({roomId:f.a.roomId,id:input.id}),/attachment_delivery_unknown/);assert.equal(posts,1);assert.equal(f.store.jobs().length,0);assert.equal((await f.attachments.view(f.a.roomId)).sends[0]!.status,'message_sending');}finally{release?.();await f.close();}});
test('restart recovery verifies private bytes and a changed or hard-linked pending file cannot be published',async()=>{const f=await fixture();try{const staged=await f.attachments.stage(upload(f.a.roomId)),id=staged.upload!.id,operation=f.store.operation('composer-upload:'+id);f.store.saveOperation({...operation,status:'writing'},operation.revision);const restored=new ComposerAttachments(f.root,f.upstream,f.store,f.conversations);assert.equal((await restored.view(f.a.roomId)).uploads[0]!.status,'staged');const path=join(f.root,'composer-uploads',id+'.bin');linkSync(path,path+'.linked');await assert.rejects(restored.send(send(f.a.roomId,[id])),/attachment_changed/);assert.equal(((await f.conversations.data(f.a.roomId)).library as any[]).length,0);unlinkSync(path+'.linked');writeFileSync(path,'changed private bytes');await assert.rejects(restored.send(send(f.a.roomId,[id])),/attachment_changed/);assert.equal((await f.upstream.messages(f.a.roomId,0,100)).messages.length,0);}finally{await f.close();}});
test('two upload IDs for the same bytes cannot create duplicate attachments and HTML is previewed as inert text',async()=>{const f=await fixture();try{const content='<script>throw new Error("must remain text")</script>',first=await f.attachments.stage(upload(f.a.roomId,'a',{name:'fictional.html',data:Buffer.from(content).toString('base64')})),second=await f.attachments.stage(upload(f.a.roomId,'b',{name:'fictional.html',data:Buffer.from(content).toString('base64')}));await assert.rejects(f.attachments.send(send(f.a.roomId,[first.upload!.id,second.upload!.id])),/attachment_duplicate/);assert.equal(((await f.conversations.data(f.a.roomId)).library as any[]).length,0);const result=await f.attachments.send(send(f.a.roomId,[first.upload!.id]));assert.equal((await f.attachments.preview({roomId:f.a.roomId,messageId:result.messageId,fileId:first.upload!.file.fileId})).preview,content);await assert.rejects(f.attachments.preview({roomId:f.b.roomId,messageId:result.messageId,fileId:first.upload!.file.fileId}));}finally{await f.close();}});
test('pending bytes are private until an explicit send; the immutable L0 body binds actual Room files and original outbox deduplicates the queued work',async()=>{const f=await fixture();try{const staged=await f.attachments.stage(upload(f.a.roomId));assert.equal(((await f.conversations.data(f.a.roomId)).library as any[]).length,0);assert.equal((await f.upstream.messages(f.a.roomId,0,100)).messages.length,0);assert.equal(f.store.jobs().length,0);assert.equal((await f.attachments.stage(upload(f.a.roomId))).reused,true);let completions=0;const complete=f.store.completeSubmission.bind(f.store);f.store.completeSubmission=(...args:Parameters<TeamStore['completeSubmission']>)=>{completions++;return complete(...args);};const input=send(f.a.roomId,[staged.upload!.id]),sent=await f.attachments.send(input);assert.ok(sent.messageId);const source=(await f.upstream.conversationMessage(f.a.roomId,sent.messageId!)).message,payload=parseAttachmentMessage(source.text)!;assert.equal(payload.text,input.text);const row=(await f.upstream.messages(f.a.roomId,0,100)).messages.find((value:any)=>value.messageId===sent.messageId);assert.equal(attachmentMessageView(row)?.attachments[0]?.fileId,staged.upload!.file.fileId);assert.equal(messageDisplayText(row),input.text);assert.equal(messageDisplayText(source),input.text);assert.equal(payload.attachments[0]!.fileId,staged.upload!.file.fileId);assert.equal(validateL0(source.sourceRef.envelope).act,'chat');assert.equal(((await f.conversations.data(f.a.roomId)).library as any[]).length,1);assert.equal(f.store.jobs(f.a.roomId).length,1);assert.equal((await f.attachments.send(input)).reused,true);await f.attachments.view(f.a.roomId);assert.equal(completions,1);assert.equal(f.store.jobs(f.a.roomId).length,1);assert.equal((await f.attachments.preview({roomId:f.a.roomId,messageId:sent.messageId,fileId:payload.attachments[0]!.fileId})).preview,'FICTIONAL_ATTACHMENT_a');assert.equal(readdirSync(join(f.root,'composer-uploads')).filter(name=>name.endsWith('.bin')).length,0);}finally{await f.close();}});
test('cancelling a pending or not-yet-arrived upload leaves no public library entry and a cancelled upload ID cannot be revived',async()=>{const f=await fixture();try{const input=upload(f.a.roomId),staged=await f.attachments.stage(input);await f.attachments.cancel({roomId:f.a.roomId,id:input.id});assert.equal((await f.attachments.stage(input)).cancelled,true);const delayed=upload(f.a.roomId,'b');await f.attachments.cancel({roomId:f.a.roomId,id:delayed.id});assert.equal((await f.attachments.stage(delayed)).cancelled,true);assert.equal((await f.attachments.view(f.a.roomId)).uploads.length,0);assert.equal(((await f.conversations.data(f.a.roomId)).library as any[]).length,0);assert.equal(existsSync(join(f.root,'composer-uploads',staged.upload!.id+'.bin')),false);assert.equal(f.store.jobs().length,0);}finally{await f.close();}});
test('a lost Room file registration receipt is reconciled from actual metadata and never reposted; a lost message receipt only reads the original outbox fact',async()=>{const f=await fixture();try{const first=await f.attachments.stage(upload(f.a.roomId)),update=f.upstream.updateConversation.bind(f.upstream);let registers=0,sends=0;f.upstream.updateConversation=async(roomId:string,input:any,...rest:any[])=>{const result=await update(roomId,input,...rest);if(input.operation==='library.register'){registers++;throw new KTeamError('upstream_operation_unknown',503);}return result;};const original=f.upstream.sendMessage.bind(f.upstream);f.upstream.sendMessage=async(...args:any[])=>{sends++;await original(...args);throw new KTeamError('upstream_operation_unknown',503);};const input=send(f.a.roomId,[first.upload!.id]);await assert.rejects(f.attachments.send(input),/upstream_operation_unknown/);assert.equal(registers,1);assert.equal(sends,1);const view=await f.attachments.view(f.a.roomId);assert.equal(view.sends[0]!.status,'complete');assert.equal((await f.attachments.send(input)).reused,true);assert.equal(registers,1);assert.equal(sends,1);assert.equal(f.store.jobs(f.a.roomId).length,1);assert.equal((await f.upstream.messages(f.a.roomId,0,100)).messages.filter((m:any)=>m.sender.kind==='user').length,1);}finally{await f.close();}});
test('unconfirmed registration is frozen instead of repeated and conflicting, foreign and reused upload identities have no message effect',async()=>{const f=await fixture();try{const first=await f.attachments.stage(upload(f.a.roomId));await assert.rejects(f.attachments.stage(upload(f.a.roomId,'a',{data:Buffer.from('changed').toString('base64')})),/attachment_id_conflict/);await assert.rejects(f.attachments.send(send(f.b.roomId,[first.upload!.id])),/attachment_not_found/);const update=f.upstream.updateConversation.bind(f.upstream);let registers=0;f.upstream.updateConversation=async(roomId:string,input:any,...rest:any[])=>{if(input.operation==='library.register'){registers++;throw new KTeamError('upstream_operation_unknown',503);}return update(roomId,input,...rest);};const input=send(f.a.roomId,[first.upload!.id]);await assert.rejects(f.attachments.send(input));await assert.rejects(f.attachments.send(input),/attachment_registration_unknown/);assert.equal(registers,1);assert.equal((await f.upstream.messages(f.a.roomId,0,100)).messages.length,0);assert.equal(f.store.jobs().length,0);}finally{await f.close();}});
test('upload limits, path/type validation, duplicate files and foreign replies fail before publishing a message',async()=>{const f=await fixture();try{for(const extra of [{name:'../escape.txt'},{name:'run.exe'},{data:'not-base64'}])await assert.rejects(f.attachments.stage(upload(f.a.roomId,'a',extra)));for(const letter of ['a','b','c','d'])await f.attachments.stage(upload(f.a.roomId,letter));await assert.rejects(f.attachments.stage(upload(f.a.roomId,'f')),/attachment_limit/);await assert.rejects(f.attachments.send(send(f.a.roomId,['upload_'+'a'.repeat(32)],{replyToMessageId:'foreign'})));assert.equal(((await f.conversations.data(f.a.roomId)).library as any[]).length,0);assert.equal((await f.upstream.messages(f.a.roomId,0,100)).messages.length,0);assert.equal(f.store.jobs().length,0);}finally{await f.close();}});
test('the original semantic bridge keeps attachment mutations on the main client and normal L0 cannot repurpose a reserved attachment message ID',async()=>{const f=await fixture();let host:Awaited<ReturnType<typeof startHost>>|undefined;try{initConfig(f.root,{version:1,brokerUrl:f.upstream.options.brokerUrl,kswarmUrl:f.upstream.options.kswarmUrl});host=await startHost({root:f.root,upstream:f.upstream.options});const api=createDesktopAPI((route,value)=>hostRequest(f.root,'kteam-main',route,value)),staged:any=await dispatchDesktop(api,'stageAttachment',[upload(f.a.roomId)]);assert.equal(staged.upload.status,'staged');const readback:any=await dispatchDesktop(api,'attachmentContent',[{roomId:f.a.roomId,id:staged.upload.id}]);assert.equal(readback.name,'fictional-a.txt');assert.equal(readback.data,Buffer.from('FICTIONAL_ATTACHMENT_a').toString('base64'));for(const route of ['/v1/composer-attachments?roomId='+f.a.roomId,'/v1/composer-attachments/content?roomId='+f.a.roomId+'&id='+staged.upload.id,'/v1/composer-attachments/upload','/v1/composer-attachments/send','/v1/composer-attachments/cancel','/v1/composer-attachments/preview'])await assert.rejects(hostRequest(f.root,'kteam-companion',route,route.includes('?')?undefined:{}),/attachment_client_forbidden/);f.store.saveOperation({id:'composer-send:msg_'+'b'.repeat(32),status:'message_sending',roomId:f.a.roomId},0);await assert.rejects(api.send({roomId:f.a.roomId,id:'msg_'+'b'.repeat(32),text:'must not bypass reserved send'}),/attachment_id_conflict/);assert.equal((await f.upstream.messages(f.a.roomId,0,100)).messages.length,0);}finally{await host?.close();await f.close();}});

test('staged preview bytes round-trip only for the owning room and stop being readable after send or cancel',async()=>{const f=await fixture();try{
 const png=Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001','hex');
 const staged=await f.attachments.stage(upload(f.a.roomId,'a',{name:'fictional.png',data:png.toString('base64')}));
 const content=await f.attachments.content({roomId:f.a.roomId,id:staged.upload!.id});
 assert.equal(content.ok,true);assert.equal(content.name,'fictional.png');assert.equal(content.extension,'png');assert.equal(content.bytes,png.length);assert.equal(content.data,png.toString('base64'));
 await assert.rejects(f.attachments.content({roomId:f.b.roomId,id:staged.upload!.id}),/attachment_not_found/);
 const sent=await f.attachments.send(send(f.a.roomId,[staged.upload!.id]));assert.ok(sent.messageId);
 await assert.rejects(f.attachments.content({roomId:f.a.roomId,id:staged.upload!.id}),/attachment_not_found/);
 const second=await f.attachments.stage(upload(f.a.roomId,'b',{name:'fictional-b.png',data:png.toString('base64')}));
 await f.attachments.cancel({roomId:f.a.roomId,id:second.upload!.id});
 await assert.rejects(f.attachments.content({roomId:f.a.roomId,id:second.upload!.id}),/attachment_not_found/);
 }finally{await f.close();}});

test('selected mentions persist with attachments and cannot change under an existing send ID',async()=>{const f=await fixture();try{
 const staged=await f.attachments.stage(upload(f.a.roomId));const mentions=['agent://kteam.local/'+encodeURIComponent(f.a.bot.id)],input=send(f.a.roomId,[staged.upload!.id],{mentions});
 await assert.rejects(f.attachments.send({...input,mentions:['agent://kteam.local/not-a-member']}),/recipient_not_member/);assert.equal(((await f.conversations.data(f.a.roomId)).library as any[]).length,0);
 const result=await f.attachments.send(input);const message=(await f.upstream.conversationMessage(f.a.roomId,result.messageId!)).message;assert.deepEqual(message.sourceRef.envelope.mentions,mentions);
 assert.deepEqual((await f.attachments.view(f.a.roomId)).sends[0]!.mentions,mentions);assert.equal((await f.attachments.send(input)).reused,true);
 await assert.rejects(f.attachments.send({...input,mentions:[]}),/attachment_id_conflict/);assert.equal((await f.upstream.messages(f.a.roomId,0,100)).messages.filter((m:any)=>m.sender.kind==='user').length,1);
 }finally{await f.close();}});

test('desktop semantic send persists stable member identities and rejects a foreign target or changed retry',async()=>{const f=await fixture();try{
 const collaboration=new CollaborationService(f.upstream),api=createDesktopAPI((route,value)=>{assert.equal(route,'/v1/messages');return collaboration.send(value,envelope=>f.store.prepareSubmission(envelope.id,envelope.room_id,intentHash(envelope),envelope));}),input={roomId:f.a.roomId,id:'msg_'+'a'.repeat(32),text:'@附件验收员 请核对',mentions:['agent://kteam.local/'+encodeURIComponent(f.a.bot.id)]};
 await assert.rejects(api.send({...input,mentions:['agent://kteam.local/foreign']}),/recipient_not_member/);
 const sent=await api.send(input),message=(await f.upstream.conversationMessage(f.a.roomId,sent.messageId)).message;assert.deepEqual(message.sourceRef.envelope.mentions,input.mentions);
 await api.send(input);await assert.rejects(api.send({...input,mentions:[]}),/aimp_id_conflict/);assert.equal((await f.upstream.messages(f.a.roomId,0,100)).messages.filter((m:any)=>m.sender.kind==='user').length,1);
 }finally{await f.close();}});


test('real image messages provide verified image bytes and human sidebar summaries, including image-only and mixed attachments',async()=>{const f=await fixture();try{
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3XcAAAAASUVORK5CYII=','base64');
 const staged=await f.attachments.stage(upload(f.a.roomId,'a',{name:'pasted.png',data:png.toString('base64')}));const result=await f.attachments.send(send(f.a.roomId,[staged.upload!.id],{text:'请看截图'})),identity={roomId:f.a.roomId,messageId:result.messageId,fileId:staged.upload!.file.fileId};
 const preview=await f.attachments.preview(identity);assert.equal(preview.preview,null);assert.equal('path'in preview,false);assert.ok('image'in preview&&preview.image);if('image'in preview&&preview.image){assert.equal(preview.image.mediaType,'image/png');assert.deepEqual(Buffer.from(preview.image.base64,'base64'),png);}
 const sidebar=new ConversationSidebar(f.upstream,f.store,async()=>{});assert.equal((await sidebar.preview(f.a.roomId))?.text,'请看截图 [图片]');assert.doesNotMatch((await sidebar.preview(f.a.roomId))!.text,/kteam_message_with_attachments|fileId|sha256/);
 const source=(await f.upstream.conversationMessage(f.a.roomId,result.messageId!)).message;assert.equal(messagePreviewText(source),'请看截图 [图片]');assert.equal(messagePreviewText({...source,sender:{kind:'agent'}}),source.text);
 await assert.rejects(f.attachments.preview({...identity,roomId:f.b.roomId}));await assert.rejects(f.attachments.preview({...identity,fileId:'0'.repeat(64)}),/attachment_not_found/);
 const stagedOnly=await f.attachments.stage(upload(f.a.roomId,'b',{name:'only.png',data:png.toString('base64')}));await f.attachments.send(send(f.a.roomId,[stagedOnly.upload!.id],{id:'msg_'+'1'.repeat(32),text:''}));assert.equal((await sidebar.preview(f.a.roomId))?.text,'[图片]');
 const actual=f.conversations.libraryDirectory(f.a.roomId);writeFileSync(join(actual,staged.upload!.file.fileId+'.png'),'changed');await assert.rejects(f.attachments.preview(identity),/library_file_changed/);
 }finally{await f.close();}});

test('authenticated semantic image preview carries a maximum-size upload beyond the normal JSON response limit and survives restart',async()=>{const f=await fixture();let host:Awaited<ReturnType<typeof startHost>>|undefined;try{
 const prefix=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3XcAAAAASUVORK5CYII=','base64'),bytes=Buffer.concat([prefix,Buffer.alloc(4*1024*1024-prefix.length)]),staged=await f.attachments.stage(upload(f.a.roomId,'a',{name:'large.png',data:bytes.toString('base64')})),sent=await f.attachments.send(send(f.a.roomId,[staged.upload!.id],{text:'大图片'}));
 initConfig(f.root,{version:1,brokerUrl:f.upstream.options.brokerUrl,kswarmUrl:f.upstream.options.kswarmUrl});host=await startHost({root:f.root,upstream:f.upstream.options});const api=createDesktopAPI((route,value)=>hostRequest(f.root,'kteam-main',route,value)),input={roomId:f.a.roomId,messageId:sent.messageId,fileId:staged.upload!.file.fileId};
 const value=await api.previewMessageAttachment({...input,variant:'thumbnail'});assert.equal(value.image.mediaType,'image/png');assert.deepEqual(Buffer.from(value.image.base64,'base64'),bytes);assert.equal('path'in value,false);
 await assert.rejects(hostRequest(f.root,'kteam-companion','/v1/composer-attachments/preview',input),/attachment_client_forbidden/);await assert.rejects(api.previewMessageAttachment({...input,path:'/etc/passwd'}),/unknown_field/);
 await host.close();host=await startHost({root:f.root,upstream:f.upstream.options});assert.equal((await api.previewMessageAttachment(input)).image.base64,value.image.base64);
 }finally{await host?.close();await f.close();}});

test('downloading an attachment saves all original bytes to the chosen directory with Room isolation and safe cancellation',async()=>{
 const f=await fixture();
 let host:Awaited<ReturnType<typeof startHost>>|undefined;
 try{
  const roomId=f.a.roomId,original=Buffer.alloc(512*1024,0xfd),name='附件原件.md';
  const staged=await f.attachments.stage(upload(roomId,'a',{name,data:original.toString('base64')}));
  const {fileId}=staged.upload!.file,message=await f.attachments.send(send(roomId,[staged.upload!.id],{text:''}));
  const source={roomId,messageId:message.messageId,fileId};
  initConfig(f.root,{version:1,brokerUrl:f.upstream.options.brokerUrl,kswarmUrl:f.upstream.options.kswarmUrl});
  host=await startHost({root:f.root,upstream:f.upstream.options});
  const preview=await hostRequest(f.root,'kteam-main','/v1/composer-attachments/preview',source);
  assert.equal(preview.truncated,true);
  await assert.rejects(hostRequest(f.root,'kteam-companion',artifactDownloadRoute,source),/artifact_download_forbidden/);
  await assert.rejects(saveArtifact(f.root,{...source,roomId:f.b.roomId},async()=>assert.fail('chooser opened for another Room')));
  await assert.rejects(hostRequest(f.root,'kteam-main',artifactDownloadRoute,{...source,path:name}),/unknown_field/);
  const folder=join(f.root,'手动选择目录');
  mkdirSync(folder);
  const destination=join(folder,'改名后的报告.md');
  assert.deepEqual(await saveArtifact(f.root,source,async suggested=>{assert.equal(suggested,name);return undefined;}),{ok:true,cancelled:true});
  assert.deepEqual(readdirSync(folder),[]);
  assert.deepEqual(await saveArtifact(f.root,source,async()=>destination),{ok:true,cancelled:false});
  assert.deepEqual(readFileSync(destination),original);
  writeFileSync(destination,'另一个版本');
  await saveArtifact(f.root,source,async()=>destination);
  assert.deepEqual(readFileSync(destination),original);
  await assert.rejects(saveArtifact(f.root,source,async()=>join(folder,'missing',name)),/artifact_save_failed/);
  const path=join(f.conversations.libraryDirectory(roomId),fileId+'.md');
  await assert.rejects(saveArtifact(f.root,source,async()=>{writeFileSync(path,Buffer.alloc(original.length));return destination;}),/library_file_changed/);
  assert.deepEqual(readFileSync(destination),original);
  assert.deepEqual(readdirSync(folder),['改名后的报告.md']);
  assert.equal(artifactSaveName(name,'win32'),name);
  assert.equal(artifactSaveName('AUX?.md','win32'),'AUX_.md');
  assert.equal(artifactSaveName('AUX.md','win32'),'_AUX.md');
 }finally{await host?.close();await f.close();}
});
