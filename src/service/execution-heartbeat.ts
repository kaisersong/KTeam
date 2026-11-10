import {KTeamError} from '../errors.js';
const transient=new Set(['upstream_operation_unknown','broker_unavailable','kswarm_unavailable']);
type Options={leaseUntil:number;request:(operation:'heartbeat'|'execution-check')=>Promise<any>;onLost:(error:KTeamError)=>void;now?:()=>number;schedule?:(fn:()=>void,ms:number)=>()=>void};
/** Renewals are serialized. Unknown transport results never invent a new lease. */
export class ExecutionHeartbeat{
 private closed=false;private pending?:Promise<void>;private cancelPulse?:()=>void;private cancelDeadline?:()=>void;private leaseUntil:number;private lastCause?:string;
 private now:()=>number;private schedule:(fn:()=>void,ms:number)=>()=>void;
 constructor(private options:Options){this.leaseUntil=options.leaseUntil;this.now=options.now??Date.now;this.schedule=options.schedule??((fn,ms)=>{const timer=setTimeout(fn,ms);return()=>clearTimeout(timer);});this.armDeadline();this.next(20000);}
 private fail(code:string,causeCode?:string){if(this.closed)return;this.stop();this.options.onLost(new KTeamError(code,409,{causeCode}));}
 private armDeadline(){this.cancelDeadline?.();if(!Number.isFinite(this.leaseUntil)){this.fail('execution_admission_unverified');return;}this.cancelDeadline=this.schedule(()=>this.fail('execution_admission_unverified',this.lastCause),Math.max(0,this.leaseUntil-this.now()-500));}
 private next(ms:number){this.cancelPulse?.();if(!this.closed)this.cancelPulse=this.schedule(()=>{void this.pulse();},ms);}
 private observe(result:any){if(this.closed)return;const lease=result?.task?.leaseUntil;if(!Number.isFinite(lease)||lease<=this.now()+500){this.fail('execution_admission_unverified');return;}this.leaseUntil=lease;this.lastCause=undefined;this.armDeadline();}
 pulse():Promise<void>{if(this.closed)return Promise.resolve();if(this.pending)return this.pending;this.cancelPulse?.();this.pending=(async()=>{
  let retry=20000;
  try{this.observe(await this.options.request('heartbeat'));}
  catch{if(this.closed)return;try{this.observe(await this.options.request('execution-check'));retry=5000;}catch(error){if(this.closed)return;const cause=error instanceof KTeamError?error.code:'broker_unavailable';this.lastCause=cause;if(!transient.has(cause)){this.fail('execution_lease_lost',cause);return;}retry=5000;}}
  finally{this.pending=undefined;this.next(retry);}
 })();return this.pending;}
 stop(){this.closed=true;this.cancelPulse?.();this.cancelDeadline?.();}
}
