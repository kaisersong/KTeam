/** Resolved receipts leave the composer; only facts that still need attention stay visible. */
const ENDED_JOB_STATES=['delivered','noop','blocked','unknown','stopped'];
export function visibleInputReceipts<T extends {status?:string;queuedState?:string}>(receipts:T[]):T[]{
 return receipts.filter(item=>item.status!=='completed'&&!(item.status==='queued'&&ENDED_JOB_STATES.includes(String(item.queuedState))));
}
export function pendingAttachmentSends<T extends {status?:string}>(sends:T[]):T[]{
 return sends.filter(send=>send.status!=='complete'&&send.status!=='cancelled');
}
