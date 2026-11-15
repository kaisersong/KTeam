import {createHash} from 'node:crypto';
import {KTeamError,record,fields,text} from '../errors.js';
import type {TeamStore} from './team-store.js';
import type {InboxReceipt} from '../protocol/inbox.js';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const contentFields=['id','hash','intentHash','revision','roomId','botId','state','status','reason','title','question','expiresAt','operation','priority','nextStep','sourceRoomId','sourceChanged'];
/** Local presentation receipts only. Canonical tasks, approvals, messages and outbox facts stay untouched. */
export class InboxState {
 constructor(private store:TeamStore){}
 private key(kind:string,id:string){return 'inbox-receipt:'+hash([kind,id]);}
 project(kind:string,item:any){
  const id=String(item.id),version=hash([kind,Object.fromEntries(contentFields.filter(key=>Object.hasOwn(item,key)).map(key=>[key,item[key]]))]),receipt=this.store.state<any>(this.key(kind,id));
  const inbox:InboxReceipt={kind,id,version,revision:receipt?.revision??0,read:receipt?.version===version&&receipt.read===true,deleted:receipt?.version===version&&receipt.deleted===true};
  return {...item,inbox};
 }
 change(value:unknown,current:any[]){
  const input=record(value);fields(input,['action','items','collection']);if(!['read','unread','delete'].includes(String(input.action))||input.collection!==undefined&&!['needs','attention'].includes(String(input.collection))||!Array.isArray(input.items)||input.items.length<1||input.items.length>500)throw new KTeamError('inbox_invalid');
  const seen=new Set<string>(),tokens=input.items.map(value=>{const item=record(value);fields(item,['kind','id','version','revision','read','deleted']);const kind=text(item.kind,'inbox_kind',32),id=text(item.id,'inbox_id',256),version=text(item.version,'inbox_version',64),revision=item.revision;if(!/^[a-f0-9]{64}$/.test(version)||!Number.isSafeInteger(revision)||Number(revision)<0)throw new KTeamError('inbox_invalid');const key=this.key(kind,id);if(seen.has(key))throw new KTeamError('inbox_invalid');seen.add(key);return {kind,id,version,revision:Number(revision),key};});
  return this.store.transaction(()=>{
   // Validate the entire displayed batch first; a newer notice is never consumed by an old bulk action.
   const updates=tokens.map(token=>{
    const item=current.find(item=>item.inbox?.kind===token.kind&&item.inbox.id===token.id);if(!item||item.inbox.version!==token.version)throw new KTeamError('inbox_changed',409);
    const prior=this.store.state<any>(token.key),same=prior?.version===token.version;
    if(same&&(prior.deleted===true||input.action==='read'&&prior.read===true||input.action==='unread'&&prior.read===false))return null;
    if((prior?.revision??0)!==token.revision)throw new KTeamError('inbox_changed',409);
    return {key:token.key,value:{version:token.version,revision:(prior?.revision??0)+1,read:input.action==='read'?true:input.action==='unread'?false:same&&prior.read===true,deleted:input.action==='delete',updatedAt:Date.now()}};
   });
   for(const update of updates)if(update)this.store.setState(update.key,update.value);
   return {ok:true,changed:updates.filter(Boolean).length};
  });
 }
}
export function projectInbox(state:InboxState,source:Record<string,any>){
 const result:any={...source};let unreadCount=0;
 for(const [field,kind] of [['questions','question'],['approvals','approval'],['proposals','proposal'],['creations','creation'],['jobs','job']]){
  result[field!]=(source[field!]??[]).map((item:any)=>state.project(kind!,item)).filter((item:any)=>!item.inbox.deleted);unreadCount+=result[field!].filter((item:any)=>!item.inbox.read).length;
 }
 return {...result,unreadCount};
}
