import {KTeamError,fields,record,text} from '../errors.js';
import type {Upstreams} from '../adapters/upstream.js';
import {messageAnchors,messageReference,type MessageAnchor} from '../protocol/message-reference.js';

async function ownedRoom(upstream:Upstreams,roomId:string) {
 const {room,members}=await upstream.membership(roomId);
 if((room as any)?.status!=='active'||!(members as any[]).some(member=>member.status==='active'&&member.role==='owner'&&member.subject?.kind==='user'&&member.subject?.userId==='user.local'))
  throw new KTeamError('message_reference_forbidden',403);
}

async function readSource(upstream:Upstreams,anchor:MessageAnchor) {
 await ownedRoom(upstream,anchor.roomId);
 const {message}=await upstream.conversationMessage(anchor.roomId,anchor.messageId);
 const source=message as any;
 if(source?.messageId!==anchor.messageId||source.roomId!==anchor.roomId||!['agent','user'].includes(source.sender?.kind)
  ||['aimp_event','bot_question_answer','bot_private_message'].includes(source.sourceRef?.kind)
  ||typeof source.text!=='string'||!source.text.trim())
  throw new KTeamError('message_reference_unavailable',404);
 await ownedRoom(upstream,anchor.roomId);
 return messageReference(anchor,source.text);
}
export async function previewMessageReference(upstream:Upstreams,value:unknown) {
 const input=record(value);fields(input,['roomId','sourceRoomId','messageId']);
 const roomId=text(input.roomId,'room_id'),sourceRoomId=text(input.sourceRoomId,'room_id'),id=text(input.messageId,'message_id');
 if(!/^[a-zA-Z0-9_-]{1,256}$/.test(sourceRoomId)||!/^[a-zA-Z0-9_-]{1,256}$/.test(id))throw new KTeamError('message_reference_invalid');
 await ownedRoom(upstream,roomId);
 const reference=await readSource(upstream,{roomId:sourceRoomId,messageId:id});
 await ownedRoom(upstream,roomId);
 return {ok:true,reference};
}
export async function verifyMessageReferences(upstream:Upstreams,roomId:string,body:string) {
 const anchors=messageAnchors(body);
 if(!anchors.length)return;
 if(new Set(anchors.map(anchor=>anchor.roomId+'/'+anchor.messageId)).size!==anchors.length)throw new KTeamError('message_reference_duplicate',409);
 if(anchors.length>3)throw new KTeamError('message_reference_limit');
 await ownedRoom(upstream,roomId);
 for(const anchor of anchors){
  const source=await readSource(upstream,anchor);
  if(!('\n'+body+'\n').includes('\n'+source.quote+'\n'))throw new KTeamError('message_reference_changed',409);
 }
 await ownedRoom(upstream,roomId);
}
