export type RoutineSchedule={kind:'once';at:number}|{kind:'interval';startAt:number;minutes:number}|{kind:'daily';time:string;weekdays:number[]};
const weekdayNames = ['周一','周二','周三','周四','周五','周六','周日'];

export function routineScheduleLabel(schedule:RoutineSchedule,timeZone?:string):string {
 if(schedule.kind==='once'){
  return new Intl.DateTimeFormat('zh-CN',{timeZone,month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(schedule.at);
 }
 if(schedule.kind==='interval'){
  return schedule.minutes % 60 === 0 ? '每 '+schedule.minutes / 60+' 小时' : '每 '+schedule.minutes+' 分钟';
 }
 const days=[...new Set(schedule.weekdays)].sort((a,b)=>a-b);
 const cadence=days.length===7?'每天':days.join(',')==='1,2,3,4,5'?'周一至周五':'每'+days.map(day=>weekdayNames[day-1]).join('、');
 return cadence+' '+schedule.time;
}

/** Absolute intervals do not drift. Daily times skip DST gaps and use the first fold only. */
export function nextRoutineAt(schedule:RoutineSchedule,timeZone:string,after:number,endAt?:number):number|null{
 let next:number|undefined;
 if(schedule.kind==='once')next=schedule.at>after?schedule.at:undefined;
 else if(schedule.kind==='interval'){const step=schedule.minutes*60000;next=schedule.startAt+Math.max(0,Math.floor((after-schedule.startAt)/step)+1)*step;}
 else{
  const formatter=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  const parts=(at:number)=>{const values=Object.fromEntries(formatter.formatToParts(at).map(part=>[part.type,part.value]));return Date.UTC(Number(values.year),Number(values.month)-1,Number(values.day),Number(values.hour),Number(values.minute),Number(values.second));};
  const local=new Date(parts(after)),[hour,minute]=schedule.time.split(':').map(Number),base=Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate());
  for(let day=0;day<15;day++){
   const date=base+day*86400000,weekday=new Date(date).getUTCDay()||7;if(!schedule.weekdays.includes(weekday))continue;
   const desired=date+hour!*3600000+minute!*60000;
   const offsets=new Set([-36,-12,0,12,36].map(hours=>{const at=desired+hours*3600000;return parts(at)-at;}));
   const candidates=[...offsets].map(offset=>desired-offset).filter(at=>parts(at)===desired).sort((a,b)=>a-b);
   if(candidates[0]!==undefined&&candidates[0]>after){next=candidates[0];break;}
  }
 }
 return next!==undefined&&Number.isFinite(next)&&next<8640000000000000&&(endAt===undefined||next<=endAt)?next:null;
}
