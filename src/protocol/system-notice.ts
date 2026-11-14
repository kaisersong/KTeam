/** A read-only display projection. Notice text never grants execution or approval. */
export function approvalSystemNotice(message:any){
 const source=message?.sourceRef;
 if(message?.sender?.kind!=='agent'||source?.kind!=='bot_private_message'||source.purpose!=='approval'||typeof source.originRoomId!=='string'||!source.originRoomId)return undefined;
 return {kind:'approval_required' as const,sourceRoomId:source.originRoomId};
}
