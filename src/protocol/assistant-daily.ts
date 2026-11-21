import {z} from 'zod';
import {calendarWindow} from '../runtime/calendar.js';
import {nextRoutineAt, routineTimeZone} from './routine-schedule.js';

import {dailySlots,dailyKinds,type DailySource,type DailyConfiguration,type DailyChange} from './assistant-daily-types.js';
export type {DailySource,DailyConfiguration,DailyChange,DailyItem,DailyCoverage} from './assistant-daily-types.js';

const dailyKind = z.enum(dailyKinds);
const id = z.string().min(1).max(256).regex(/^[^\u0000-\u001f\u007f-\u009f]+$/u);
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const slot = z.enum(dailySlots);
const revision = z.number().int().nonnegative();
export const dailySource = z.object({kind:dailyKind,id,label:id,account:id,revision:id}).strict() satisfies z.ZodType<DailySource>;
export const dailyConfiguration = z.object({
 timeZone:z.string().max(64),
 weekdays:z.array(z.number().int().min(1).max(7)).min(1).max(7),
 schedule:z.object({morning:time.nullable(),midday:time.nullable(),evening:time.nullable()}).strict(),
 middayUrgentOnly:z.boolean(),
 paused:z.boolean(),
 sources:z.array(dailySource).max(24),
}).strict() satisfies z.ZodType<DailyConfiguration>;
export const dailyChange = z.object({
 schedule:z.object({morning:time.nullable().optional(),midday:time.nullable().optional(),evening:time.nullable().optional()}).strict().optional(),
 weekdays:dailyConfiguration.shape.weekdays.optional(),
 middayUrgentOnly:z.boolean().optional(), paused:z.boolean().optional(),
 skipToday:slot.optional(), restore:z.literal(true).optional(),
 sourceKinds:z.array(dailyKind).max(5).optional(),
 removeSourceKinds:z.array(dailyKind).max(5).optional(),
}).strict() satisfies z.ZodType<DailyChange>;
export const dailyCommit = z.object({id:z.string().uuid(),expectedRevision:revision,sources:z.array(dailySource).max(24)}).strict();
export const dailySourceKey = (source:DailySource) => JSON.stringify([source.kind,source.account,source.id]);
export function defaultDaily(timeZone:string):DailyConfiguration {
 return {timeZone:routineTimeZone(timeZone),weekdays:[1,2,3,4,5],schedule:{morning:'08:30',midday:'12:00',evening:'18:00'},middayUrgentOnly:false,paused:false,sources:[]};
}
export function dailyTimes(plan:DailyConfiguration, now:number) {
 const day=calendarWindow(new Date(now),plan.timeZone).today;
 const earliest=now-36*3600000;
 return dailySlots.flatMap(slot=>{
  const time=plan.schedule[slot];
  if(time===null)return [];
  const schedule={kind:'daily' as const,time,weekdays:plan.weekdays};
  const first=nextRoutineAt(schedule,plan.timeZone,earliest);
  const second=first===null?null:nextRoutineAt(schedule,plan.timeZone,first);
  const due=[first,second].find(at=>at!==null&&at<=now&&calendarWindow(new Date(at),plan.timeZone).today===day);
  return [{slot,day,due,next:nextRoutineAt(schedule,plan.timeZone,now)}];
 });
}
