export const dailySlots = ['morning', 'midday', 'evening'] as const;
export const dailySlotLabels = {morning:'早报', midday:'午报', evening:'晚报'} as const;
export const dailyKinds = ['mail','yzj-message','yzj-calendar','yzj-doc','news'] as const;
export type DailySlot = typeof dailySlots[number];
export type DailySourceKind = typeof dailyKinds[number];

export interface DailySource {
 kind:DailySourceKind;
 id:string;
 label:string;
 account:string;
 revision:string;
}

export interface DailyConfiguration {
 timeZone:string;
 weekdays:number[];
 schedule:Record<DailySlot,string|null>;
 middayUrgentOnly:boolean;
 paused:boolean;
 sources:DailySource[];
}

export interface DailyChange {
 schedule?:Partial<DailyConfiguration['schedule']>;
 weekdays?:number[];
 middayUrgentOnly?:boolean;
 paused?:boolean;
 skipToday?:DailySlot;
 restore?:true;
 sourceKinds?:DailySourceKind[];
 removeSourceKinds?:DailySourceKind[];
}

export interface DailyItem {
 id:string;
 title:string;
 detail:string;
 observedAt:number;
 urgent:boolean;
 deadline?:number;
 source:DailySource;
 originalId?:string;
 url?:string;
}

export interface DailyCoverage {
 source:DailySource;
 state:'ok'|'partial'|'unavailable';
 checkedAt:number;
 from:number;
}
