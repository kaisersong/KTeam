import {KTeamError,fields,record} from '../errors.js';
import type {RoutineSchedule} from './routine-calendar.js';
export {nextRoutineAt,type RoutineSchedule} from './routine-calendar.js';
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
