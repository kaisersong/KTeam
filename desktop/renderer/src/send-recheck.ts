/** Auto read-back after a send whose upstream receipt stayed unknown.
 * The send is NEVER replayed: one delayed read-only `reconcile` decides whether
 * the message actually landed, using the service outbox as the source of truth.
 * Only a reconcile issued after the failure may settle it; a newer send, a room
 * switch, a manual reconcile or unmount cancels the pending check. */

export type SendRecheckVerdict='delivered'|'not_delivered'|'undetermined';
export const SEND_RECHECK_DELAY_MS=600;
/** team-store pendingSubmissions reads ORDER BY rowid LIMIT 100; at the cap a
 * missing id may be truncation, not delivery. */
const PENDING_PAGE_LIMIT=100;

export function isUnknownSendReceipt(error:unknown):boolean{
 return error instanceof Error&&error.message==='upstream_operation_unknown';
}

/** The reconcile endpoint returns the room's remaining pending submissions.
 * Absence below the page cap means the outbox row was completed upstream. */
export function sendRecheckVerdict(messageId:string,response:unknown):SendRecheckVerdict{
 const pending=(response as {pendingSubmissions?:unknown}|null|undefined)?.pendingSubmissions;
 if(!Array.isArray(pending)||pending.length>=PENDING_PAGE_LIMIT)return 'undetermined';
 // Every outbox row is {id:string,...}; a row without a string id means the payload is malformed,
 // so absence cannot be trusted as delivery (that would wrongly clear the draft and retry identity).
 if(pending.some(row=>typeof (row as {id?:unknown}|null)?.id!=='string'))return 'undetermined';
 return pending.some(row=>(row as {id:string}).id===messageId)?'not_delivered':'delivered';
}

export interface SendRecheckContext{roomId:string;id:string;text:string;replyToMessageId?:string}

interface SendRecheckDeps{
 reconcile:(roomId:string)=>Promise<unknown>;
 /** True while the failed send is still the room's pending identity. */
 isCurrent:(context:SendRecheckContext)=>boolean;
 onChecking:()=>void;
 onSettled:(verdict:SendRecheckVerdict,context:SendRecheckContext)=>void;
 delayMs?:number;
 setTimer?:(fn:()=>void,ms:number)=>ReturnType<typeof setTimeout>;
 clearTimer?:(handle:ReturnType<typeof setTimeout>)=>void;
}

export function createSendRecheck(deps:SendRecheckDeps){
 const setTimer=deps.setTimer??((fn,ms)=>setTimeout(fn,ms));
 const clearTimer=deps.clearTimer??(handle=>clearTimeout(handle));
 let timer:ReturnType<typeof setTimeout>|null=null;
 let generation=0;
 const cancel=()=>{generation++;if(timer!==null){clearTimer(timer);timer=null;}};
 const schedule=(context:SendRecheckContext)=>{
  cancel();
  // A late send rejection (after a room switch or unmount) must not announce checking or arm a timer
  // for an identity that is no longer current; otherwise another room would show "checking" forever.
  if(!deps.isCurrent(context))return;
  const issued=generation;
  deps.onChecking();
  timer=setTimer(()=>{
   timer=null;
   if(issued!==generation||!deps.isCurrent(context))return;
   void deps.reconcile(context.roomId).then(
    response=>{if(issued===generation&&deps.isCurrent(context))deps.onSettled(sendRecheckVerdict(context.id,response),context);},
    ()=>{if(issued===generation&&deps.isCurrent(context))deps.onSettled('undetermined',context);},
   );
  },deps.delayMs??SEND_RECHECK_DELAY_MS);
 };
 return {schedule,cancel};
}