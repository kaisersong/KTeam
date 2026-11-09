import {randomBytes} from 'node:crypto';
export const DESKTOP_METHODS=['status','bots','teams','models','runtimes','createBot','createTeam','send','messages','settings','work','pause','resume','seen','review','reconcile'] as const;
type Call=(route:string,value?:unknown)=>Promise<any>;
const text=(value:unknown)=>{if(typeof value!=='string'||!value||value.length>32768)throw Error('invalid_input');return value;};
const room=(value:unknown)=>encodeURIComponent(text(value));
export function createDesktopAPI(call:Call){return {
 status:()=>call('/v1/status'),bots:()=>call('/v1/bots'),teams:()=>call('/v1/teams'),models:()=>call('/v1/models'),runtimes:()=>call('/v1/runtimes'),
 createBot:(input:unknown)=>call('/v1/bot-create',input),createTeam:(input:unknown)=>call('/v1/teams',input),
 send:(input:any)=>call('/v1/messages',{aimp:'1.0',id:input.id??'msg_'+randomBytes(16).toString('hex'),room_id:text(input.roomId),thread_id:'thread-'+text(input.roomId),from:'human://kteam.local/user.local',to:[],mentions:[],ts:new Date().toISOString(),act:'chat',source_level:'principal',classification:'internal',body:text(input.text)}),
 messages:(input:any)=>{const after=input.after??0,limit=input.limit??100,before=input.before;if(!Number.isSafeInteger(after)||after<0||!Number.isInteger(limit)||limit<1||limit>100||(before!==undefined&&(!Number.isSafeInteger(before)||before<1)))throw Error('invalid_pagination');return call(`/v1/teams/${room(input.roomId)}/messages?after=${after}&limit=${limit}${before!==undefined?'&before='+before:''}${input.tail===true?'&tail=true':''}`);},
 settings:(id:unknown)=>call(`/v1/teams/${room(id)}/settings`),work:(id:unknown)=>call(`/v1/teams/${room(id)}/work`),
 reconcile:(id:unknown)=>call(`/v1/teams/${room(id)}/reconcile`,{}),
 pause:(id:unknown)=>call(`/v1/teams/${room(id)}/pause`,{}),resume:(id:unknown)=>call(`/v1/teams/${room(id)}/resume`,{}),
 seen:(input:any)=>call(`/v1/teams/${room(input.roomId)}/seen`,{sequences:input.sequences}),review:(input:any)=>call(`/v1/teams/${room(input.roomId)}/review`,{taskRef:input.taskRef,decision:input.decision}),
};}
export async function dispatchDesktop(api:ReturnType<typeof createDesktopAPI>,method:unknown,args:unknown){
 if(typeof method!=='string'||!Object.hasOwn(api,method)||!Array.isArray(args)||args.length>1)throw Error('desktop_method_forbidden');
 return Reflect.apply((api as any)[method],undefined,args);
}
export function trustedFrame(senderFrame:unknown,mainFrame:unknown){return !!senderFrame&&senderFrame===mainFrame;}
