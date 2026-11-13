export interface NotificationNavigation {roomId?:string;jobId?:string;settings?:'notifications';messageId?:string;questionId?:string;approvalId?:string}
export interface NotificationPreferences {revision:number;enabled:boolean;completed:boolean;blocked:boolean;input:boolean;sound:boolean;showPreview:boolean;quiet:boolean;quietHours:{enabled:boolean;start:string;end:string;timeZone:string}}
export const defaultNotificationPreferences=():NotificationPreferences=>({revision:0,enabled:false,completed:true,blocked:true,input:true,sound:false,showPreview:false,quiet:false,quietHours:{enabled:false,start:'22:00',end:'08:00',timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone}});
export function notificationQuiet(preferences:NotificationPreferences,now:number){
 if(preferences.quiet)return true;const hours=preferences.quietHours;if(!hours.enabled)return false;
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:hours.timeZone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now),time=parts.find(part=>part.type==='hour')!.value+':'+parts.find(part=>part.type==='minute')!.value;
 return hours.start<hours.end?time>=hours.start&&time<hours.end:time>=hours.start||time<hours.end;
}
