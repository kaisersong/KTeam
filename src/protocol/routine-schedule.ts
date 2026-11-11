import {KTeamError,fields,record} from '../errors.js';
export type RoutineSchedule={kind:'once';at:number}|{kind:'interval';startAt:number;minutes:number}|{kind:'daily';time:string;weekdays:number[]};
export function routineSchedule(value:unknown):RoutineSchedule{
 const input=record(value);
 if(input.kind==='once'){fields(input,['kind','at']);if(!validTime(input.at))throw new KTeamError('routine_time_invalid');return {kind:'once',at:input.at as number};}
 if(input.kind==='interval'){fields(input,['kind','startAt','minutes']);if(!validTime(input.startAt)||!Number.isSafeInteger(input.minutes)||Number(input.minutes)<15||Number(input.minutes)>10080)throw new KTeamError('routine_time_invalid');return {kind:'interval',startAt:input.startAt as number,minutes:input.minutes as number};}
 if(input.kind==='daily'){fields(input,['kind','time','weekdays']);if(typeof input.time!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time)||!Array.isArray(input.weekdays)||!input.weekdays.length||input.weekdays.length>7||Array.from(input.weekdays).some(day=>!Number.isInteger(day)||day<1||day>7)||new Set(input.weekdays).size!==input.weekdays.length)throw new KTeamError('routine_time_invalid');return {kind:'daily',time:input.time,weekdays:[...input.weekdays].sort()};}
 throw new KTeamError('routine_time_invalid');
}
export const validTime=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>0&&Number(value)<8640000000000000;
export function routineTimeZone(value:unknown):string{
 if(typeof value!=='string'||!value||value.length>64)throw new KTeamError('routine_timezone_invalid');
 try{return new Intl.DateTimeFormat('en',{timeZone:value}).resolvedOptions().timeZone;}catch{throw new KTeamError('routine_timezone_invalid');}
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
