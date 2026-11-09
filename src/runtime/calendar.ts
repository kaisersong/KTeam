/** Calendar dates are resolved by the host in the user's timezone, never model arithmetic. */
export function calendarWindow(now=new Date(),timeZone=Intl.DateTimeFormat().resolvedOptions().timeZone){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 const part=(type:string)=>Number(parts.find(p=>p.type===type)!.value),date=new Date(Date.UTC(part('year'),part('month')-1,part('day')));
 const day=(date.getUTCDay()+6)%7,iso=(offset:number)=>new Date(date.getTime()+offset*86400000).toISOString().slice(0,10);
 return {timeZone,today:iso(0),weekday:['周一','周二','周三','周四','周五','周六','周日'][day]!,weekStart:iso(-day),weekEnd:iso(6-day),lastWeekStart:iso(-day-7),lastWeekEnd:iso(-day-1)};
}
