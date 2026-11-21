export type RoutineSchedule={kind:'once';at:number}|{kind:'interval';startAt:number;minutes:number}|{kind:'daily';time:string;weekdays:number[]};
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
