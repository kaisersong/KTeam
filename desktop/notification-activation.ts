export const KTEAM_APP_ID = 'com.kteam.desktop';
const prefix = 'desktop-notification:';
const validId = (value: unknown): value is string => typeof value === 'string' && /^desktop-notification:[a-f0-9]{64}$/.test(value);
type NoticeOptions = {id:string;groupId:string;title:string;body:string;silent:boolean};
const xmlText = (value:string) => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g,'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]!));

/** Native payloads carry an opaque source ID, never an executable action or navigation. */
export function nativeNotificationOptions(platform:string,options:NoticeOptions):NoticeOptions&{toastXml?:string} {
 if(!validId(options.id))throw Error('notification_id_invalid');
 if(platform!=='win32')return options;
 // Windows Tags have a 64-character limit. Keep the full 256-bit source identity.
 const tag=options.id.slice(prefix.length);
 return {...options,id:tag,toastXml:'<toast launch="type=click&amp;tag='+tag+'"><visual><binding template="ToastGeneric"><text>'+xmlText(options.title)+'</text><text>'+xmlText(options.body)+'</text></binding></visual>'+(options.silent?'<audio silent="true"/>':'')+'</toast>'};
}

export function notificationActivationId(platform:string,details:unknown):string|undefined {
 if(!details||typeof details!=='object'||Array.isArray(details))return;
 const value=details as Record<string,unknown>;
 if(platform==='darwin')return value.actionIdentifier==='com.apple.UNNotificationDefaultActionIdentifier'&&validId(value.identifier)?value.identifier:undefined;
 if(platform==='win32'&&value.type==='click'&&typeof value.arguments==='string'){
  const match=/^type=click&tag=([a-f0-9]{64})$/.exec(value.arguments);
  if(match)return prefix+match[1];
 }
}

/** At most one startup click waits for the IPC handler and renderer to be ready. */
export function createNotificationActivationRouter(platform:string) {
 let pending:string|undefined,closed=false,deliver:((id:string)=>Promise<void>)|undefined;
 return {
  async receive(details:unknown){if(closed)return;const id=notificationActivationId(platform,details);if(!id)return;if(deliver)await deliver(id);else pending=id;},
  async connect(handler:(id:string)=>Promise<void>){if(closed)return;deliver=handler;const id=pending;pending=undefined;if(id)await handler(id);},
  close(){closed=true;pending=undefined;deliver=undefined;},
 };
}
