import {ownerPage} from './room-reads.js';
import type {Upstreams} from '../adapters/upstream.js';
import {KTeamError} from '../errors.js';
import {attachmentMessageView} from '../protocol/message-attachments.js';
import {projectMessage as originalMessage} from './collaboration.js';
export const MESSAGE_PAGE_BYTES=384*1024;
/** Preserve the original owner IDs/sequence, while duplicate envelope bodies remain on demand. */
export function projectMessage(message:any):any{const {envelope,...result}=originalMessage(message) as any;return {...result,...(attachmentMessageView(message)?{attachmentView:true}:{})};}
/** Adapt the original bounded read downwards on byte overflow; never retry a mutation. */
export async function conversationPage(upstream:Upstreams,roomId:string,input:{after?:number;before?:number;tail?:boolean;limit?:number}={}){
 const source=await ownerPage(upstream,roomId,input);
 const actual=(source.messages as any[]).map(projectMessage).sort((a,b)=>a.roomSequence-b.roomSequence),selected:any[]=[];let bytes=0;for(const message of input.tail?[...actual].reverse():actual){const count=Buffer.byteLength(JSON.stringify(message));if(count>MESSAGE_PAGE_BYTES)throw new KTeamError('conversation_message_too_large',413);if(bytes+count>MESSAGE_PAGE_BYTES)break;selected.push(message);bytes+=count;}if(input.tail)selected.reverse();return {ok:true,messages:selected,totalMessages:source.totalMessages,fromSequence:selected[0]?.roomSequence??null,toSequence:selected.at(-1)?.roomSequence??null,hasMoreBefore:!!source.hasMoreBefore||!!input.tail&&selected.length<actual.length,hasMoreAfter:!!source.hasMoreAfter||!input.tail&&selected.length<actual.length,bytes};
}
