type Upstream={broker?:{available?:boolean};kswarm?:{available?:boolean};ready?:boolean};
const hostErrors=['ENOENT','ECONNREFUSED','ECONNRESET','EPIPE','host_start_timeout','host_timeout','desktop_generation_busy','desktop_generation_unconfirmed'];
/** Only connection errors whose own service has recovered may be cleared. */
export function recoveredConnectionError(error:string,upstream:Upstream,explain:(code:string)=>string=(code=>code)){
 if(error===explain('broker_unavailable'))return upstream.broker?.available===true;
 if(error===explain('kswarm_unavailable'))return upstream.kswarm?.available===true;
 if(hostErrors.some(code=>error===explain(code)))return upstream.ready===true;
 if(['upstream_protocol_unavailable','aimp_unavailable'].some(code=>error===explain(code)))return upstream.ready===true;
 return false;
}
export function preserveActionError(previous:string,next:string,explain:(code:string)=>string=(code=>code)){
 const connection=[...hostErrors,'broker_unavailable','kswarm_unavailable','upstream_protocol_unavailable','aimp_unavailable'].some(code=>previous===explain(code));
 return previous&&!connection?previous:next;
}
