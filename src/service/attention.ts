/** A pending peer consultation can block the original group. Project only its origin, never its answer. */
export function attentionSource(item:any,readJob:(id:string)=>any){
 const job=typeof item.jobId==='string'?readJob(item.jobId):null;
 if(!job||job.roomId!==item.sourceRoomId||!job.peer?.rootJobId)return {...item,rootSourceRoomId:item.sourceRoomId};
 const root=readJob(job.peer.rootJobId);
 return {...item,rootSourceRoomId:root?.roomId??item.sourceRoomId};
}
