export interface WindowMessage {messageId:string;roomId?:string;roomSequence:number;text?:string}
export interface ConversationWindow<T extends WindowMessage=WindowMessage>{roomId:string;messages:T[];cursor:number;feedCursor?:string;hasOlder:boolean;hasNewer:boolean;newerCount:number;generation:number}
export const WINDOW_MESSAGES=80,WINDOW_BYTES=512*1024;
export const conversationWindow=<T extends WindowMessage>(roomId:string):ConversationWindow<T>=>({roomId,messages:[],cursor:0,hasOlder:false,hasNewer:false,newerCount:0,generation:0});
const bytes=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value)).byteLength;
function fit<T extends WindowMessage>(messages:T[],keep:'oldest'|'latest'){
 const sizes=messages.map(bytes);let total=sizes.reduce((a,b)=>a+b,0),start=0,end=messages.length;
 while(end-start>WINDOW_MESSAGES||total>WINDOW_BYTES){if(keep==='latest')total-=sizes[start++]!;else total-=sizes[--end]!;}
 return {messages:messages.slice(start,end),trimmed:start>0||end<messages.length};
}
/** A bounded UI window over canonical messages. Older messages remain with Broker. */
export function mergeConversationWindow<T extends WindowMessage>(state:ConversationWindow<T>,page:{messages:T[];hasMoreBefore?:boolean;hasMoreAfter?:boolean},mode:'updates'|'older'|'latest',follow=true):ConversationWindow<T>{
 if(page.messages.some(message=>message.roomId&&message.roomId!==state.roomId||!Number.isSafeInteger(message.roomSequence)||message.roomSequence<1))throw Error('conversation_window_scope');
 const incoming=page.messages.map(message=>({...message,roomId:state.roomId}));
 const cursor=Math.max(state.cursor,...incoming.map(message=>message.roomSequence));
 const map=new Map((mode==='latest'?[]:state.messages).map(message=>[message.messageId,message]));
 const added=incoming.filter(message=>!map.has(message.messageId));for(const message of incoming)map.set(message.messageId,message);
 const all=[...map.values()].sort((a,b)=>a.roomSequence-b.roomSequence),fitted=fit(all,mode==='older'?'oldest':'latest');
 if(mode==='updates'&&(state.hasNewer||!follow&&fitted.trimmed))return {...state,cursor,hasNewer:true,newerCount:Math.min(10000,state.newerCount+added.filter(message=>message.roomSequence>state.cursor).length)};
 return {...state,messages:fitted.messages,cursor,
  hasOlder:mode==='older'?page.hasMoreBefore===true:mode==='latest'||state.messages.length===0?page.hasMoreBefore===true||fitted.trimmed:state.hasOlder||fitted.trimmed,
  hasNewer:mode==='latest'?page.hasMoreAfter===true:mode==='older'?state.hasNewer||fitted.trimmed||page.hasMoreAfter===true:page.hasMoreAfter===true,
  newerCount:mode==='latest'?0:mode==='older'?state.newerCount:0,
  generation:state.generation+(mode==='latest'?1:0),
 };
}
/** A response for an earlier cursor must not move the current UI backwards. */
export function acceptsConversationUpdate(state:ConversationWindow,response:{roomId:string;previousCursor?:string|null}){return response.roomId===state.roomId&&(response.previousCursor??undefined)===state.feedCursor;}
