import {KTeamError} from '../src/errors.js';
interface NativeNotice {show():void;once(event:string,callback:(...args:any[])=>void):any}
interface Dependencies {request:(route:string,value?:unknown)=>Promise<any>;supported:()=>boolean;foreground:()=>boolean;create:(options:{id:string;groupId:string;title:string;body:string;silent:boolean})=>NativeNotice;navigate:(navigation:any)=>Promise<void>;now?:()=>number}
/** One desktop delivery loop; native acceptance never changes message read state. */
export class NotificationDelivery {
 private busy=false;private stopped=false;private notices=new Map<string,NativeNotice>();private timers=new Set<ReturnType<typeof setTimeout>>();private lastActivation=new Map<string,number>();private lastTestId?:string;private lastPoll?:number;private lastError?:string;
 constructor(private deps:Dependencies){}
 status(){return {available:true,supported:this.deps.supported(),lastPoll:this.lastPoll,lastTestId:this.lastTestId,lastError:this.lastError,systemDisplay:'由操作系统及勿扰设置决定，应用只能记录通知接口回执'};}
 async poll(){
  if(this.stopped||this.busy||!this.deps.supported()||this.deps.foreground())return;this.busy=true;
  try{const pending=await this.deps.request('/v1/desktop-notifications/pending');this.lastPoll=this.deps.now?.()??Date.now();this.lastError=undefined;
   for(const item of pending.items.slice(0,3)){if(this.stopped||this.deps.foreground())break;const claim=await this.deps.request('/v1/desktop-notifications/claim',item);if(!claim.claimed)continue;
    await this.present(claim);
   }
  }catch{this.lastError='notification_delivery_unavailable';}finally{this.busy=false;}
 }
 private async present(claim:any,allowForeground=false){
    const receipt=(status:'issued'|'failed'|'unknown'|'skipped')=>this.deps.request('/v1/desktop-notifications/receipt',{id:claim.id,token:claim.token,status}).catch(()=>{this.lastError='notification_receipt_unknown';});
    if(this.stopped||!allowForeground&&this.deps.foreground()){await receipt('skipped');return;}
    try{const notice=this.deps.create({id:claim.id,groupId:'kteam-work',title:claim.title,body:claim.body,silent:claim.silent});this.notices.set(claim.id,notice);while(this.notices.size>100)this.notices.delete(this.notices.keys().next().value!);
     const timer=setTimeout(()=>{this.timers.delete(timer);void receipt('unknown');},5000);timer.unref?.();this.timers.add(timer);const clear=()=>{clearTimeout(timer);this.timers.delete(timer);};notice.once('show',()=>{clear();void receipt('issued');});notice.once('failed',()=>{clear();void receipt('failed');});notice.once('click',()=>void this.activate(claim.id));notice.show();
    }catch{await receipt('unknown');}
 }
 async test(){if(!this.deps.supported()||this.stopped)throw new KTeamError('notification_desktop_unavailable',409);const claim=await this.deps.request('/v1/desktop-notifications/test',{});this.lastTestId=claim.id;await this.present(claim,true);return {ok:true,attempted:true,id:claim.id};}
 retain(id:string,notice:NativeNotice){if(!/^desktop-notification:[a-f0-9]{64}$/.test(id))return;this.notices.set(id,notice);notice.once('click',()=>void this.activate(id));}
 async activate(id:string){if(this.stopped||!/^desktop-notification:[a-f0-9]{64}$/.test(id))return;const now=this.deps.now?.()??Date.now();if(now-(this.lastActivation.get(id)??0)<2000)return;this.lastActivation.set(id,now);while(this.lastActivation.size>200)this.lastActivation.delete(this.lastActivation.keys().next().value!);try{const result=await this.deps.request('/v1/desktop-notifications/locate',{id});if(!this.stopped)await this.deps.navigate(result.navigation);}catch{this.lastError='notification_source_changed';if(!this.stopped)try{await this.deps.navigate({error:'notification_source_changed'});}catch{}}}
 close(){this.stopped=true;for(const timer of this.timers)clearTimeout(timer);this.timers.clear();}
}
