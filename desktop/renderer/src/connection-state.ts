type Upstream={broker?:{available?:boolean};kswarm?:{available?:boolean};ready?:boolean};
const hostErrors=['ENOENT','ECONNREFUSED','ECONNRESET','EPIPE','host_start_timeout','host_timeout','desktop_generation_busy','desktop_generation_unconfirmed','managed_services_start_timeout','managed_service_port_foreign'];
/** Only connection errors whose own service has recovered may be cleared. */
export function recoveredConnectionError(error:string,upstream:Upstream,explain:(code:string)=>string=(code=>code)){
 if(error===explain('broker_unavailable'))return upstream.broker?.available===true;
 if(error===explain('kswarm_unavailable'))return upstream.kswarm?.available===true;
 if(hostErrors.some(code=>error===explain(code)))return upstream.ready===true;
 if(['upstream_protocol_unavailable','aimp_unavailable'].some(code=>error===explain(code)))return upstream.ready===true;
 return false;
}
export function isConnectionError(error:string,explain:(code:string)=>string=(code=>code)){
 return recoveredConnectionError(error,{ready:true,broker:{available:true},kswarm:{available:true}},explain);
}
export function preserveActionError(previous:string,next:string,explain:(code:string)=>string=(code=>code)){
 return previous&&!isConnectionError(previous,explain)?previous:next;
}

export const rejectedConversationRead='暂时无法更新会话，已保留当前内容。';
export const rejectedMessageSend='发送操作未完成，草稿已保留。请先查看会话中是否已有这条消息。';
export function upstreamRejectionMessage(error:unknown,operation:'read'|'send'){
 const code=error instanceof Error?error.message:String(error);
 if(code!=='upstream_rejected')return;
 return operation==='read'?rejectedConversationRead:rejectedMessageSend;
}
