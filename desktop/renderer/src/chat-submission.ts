export type ChatIntent={roomId:string;text:string;replyToMessageId?:string};
export type ChatSubmission=ChatIntent&{id:string};

/** One in-flight receipt per conversation. Unknown receipts retain the original ID. */
export const CHAT_INTENTS_KEY='kteam.ui.send-intents.v1';
export function createChatSubmission(send:(input:ChatSubmission)=>Promise<unknown>,timeoutMs=25000,storage?:Pick<Storage,'getItem'|'setItem'>){
 const intents=new Map<string,ChatSubmission>(),pending=new Set<string>();
 if(storage)try{
  const stored=JSON.parse(storage.getItem(CHAT_INTENTS_KEY)??'{}');
  for(const [roomId,value] of Object.entries(stored??{}).slice(-200)){
   const row=value as ChatSubmission;
   if(row&&roomId===row.roomId&&roomId.length<=256&&typeof row.text==='string'&&row.text.length<=32768&&/^msg_[a-f0-9]{32}$/.test(row.id)&&(row.replyToMessageId===undefined||typeof row.replyToMessageId==='string'&&row.replyToMessageId.length<=256))intents.set(roomId,{roomId,text:row.text,id:row.id,replyToMessageId:row.replyToMessageId});
  }
 }catch{}
 const persist=()=>{try{storage?.setItem(CHAT_INTENTS_KEY,JSON.stringify(Object.fromEntries([...intents].slice(-200))));}catch{}};
 return {
  pending:(roomId:string)=>pending.has(roomId),
  async send(input:ChatIntent){
   if(pending.has(input.roomId))return undefined;
   const previous=intents.get(input.roomId),intent=previous?.text===input.text&&previous.replyToMessageId===input.replyToMessageId?previous:{...input,id:'msg_'+crypto.randomUUID().replaceAll('-','')};
   intents.set(input.roomId,intent);persist();pending.add(input.roomId);
   let timer:ReturnType<typeof setTimeout>|undefined;
   try{
    await Promise.race([Promise.resolve().then(()=>send(intent)),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('message_send_receipt_unknown')),timeoutMs);})]);
    if(intents.get(input.roomId)===intent){intents.delete(input.roomId);persist();}
    return intent;
   }finally{if(timer)clearTimeout(timer);pending.delete(input.roomId);}
  },
 };
}

export const CHAT_DRAFTS_KEY='kteam.ui.drafts.v1';
export function readChatDrafts(storage:Pick<Storage,'getItem'>):Record<string,string>{
 try{const raw=JSON.parse(storage.getItem(CHAT_DRAFTS_KEY)??'{}');if(!raw||typeof raw!=='object'||Array.isArray(raw))return {};return Object.fromEntries(Object.entries(raw).filter(([key,value])=>key.length<=256&&typeof value==='string'&&value.length<=32768).slice(-200)) as Record<string,string>;}catch{return {};}
}

export function writeChatDrafts(storage:Pick<Storage,'setItem'>,drafts:Record<string,string>){
 try{storage.setItem(CHAT_DRAFTS_KEY,JSON.stringify(drafts));}catch{/* Keep typing when local storage is unavailable. */}
}
