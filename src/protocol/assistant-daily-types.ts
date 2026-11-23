export type AssistantConnectorSetup = { enterprise?: boolean; mail?: boolean };

export const dailySlots = ['morning', 'midday', 'evening'] as const;
export const dailySlotLabels = {morning:'早报', midday:'午报', evening:'晚报'} as const;
export const yzjRecentGroupsId = 'recent-groups-30';
export const recentGroupsLimit = 30;
export const recentGroupsInterval = 15*60000;
export const isYzjRecentGroups=(source:DailySource)=>source.kind==='yzj-message'&&source.id===yzjRecentGroupsId;
export const dailyKinds = ['mail','yzj-message','yzj-calendar','yzj-doc','news','enterprise-message','enterprise-calendar'] as const;
export const dailyEnterpriseProviders = ['dingtalk','feishu','wecom'] as const;
export type DailyEnterpriseProvider = typeof dailyEnterpriseProviders[number];
export const dailyEnterpriseLabels = {dingtalk:'钉钉',feishu:'飞书',wecom:'企业微信'} as const;
export const isDailyMessage=(source:DailySource)=>source.kind==='yzj-message'||source.kind==='enterprise-message';
export const isDailyCalendar=(source:DailySource)=>source.kind==='yzj-calendar'||source.kind==='enterprise-calendar';
export const isDailyRecentGroups=(source:DailySource)=>isYzjRecentGroups(source)||source.kind==='enterprise-message';
export type DailySlot = typeof dailySlots[number];
export type DailySourceKind = typeof dailyKinds[number];

export interface DailySource {
 kind:DailySourceKind;
 provider?:DailyEnterpriseProvider;
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

export const dailyPresets = {
 morning: {
  label:'只看早报', detail:'08:30 汇总关注事项',
  schedule:{morning:'08:30',midday:null,evening:null}, middayUrgentOnly:false,
 },
 twice: {
  label:'早晚各一份', detail:'08:30 看今日安排，18:00 看收尾事项',
  schedule:{morning:'08:30',midday:null,evening:'18:00'}, middayUrgentOnly:false,
 },
 three: {
  label:'早、中、晚各一份', detail:'08:30、12:00、18:00，午报只看紧急事项',
  schedule:{morning:'08:30',midday:'12:00',evening:'18:00'}, middayUrgentOnly:true,
 },
} as const satisfies Record<string,{label:string;detail:string;schedule:DailyConfiguration['schedule'];middayUrgentOnly:boolean}>;

export type DailyPreset = keyof typeof dailyPresets;
export const dailyPresetIds = ['morning','twice','three'] as const satisfies readonly DailyPreset[];
export interface DailyPresetSelection {
 preset:DailyPreset|'sources';
 expectedRevision:number;
 expectedDraftId:string|null;
}

export type DailyMessageAttention = {kind:'schedule'|'deadline'|'decision'|'reply';group:string;text:string;at:number};

export interface DailyItem {
 id:string;
 title:string;
 detail:string;
 observedAt:number;
 urgent:boolean;
 messageAttention?:DailyMessageAttention;
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

export type DailyBriefDelivery = 'pending'|'attempted'|'sent'|'unconfirmed'|'expired';
export const dailyBriefDeliveryLabels:Record<DailyBriefDelivery,string> = {
 pending:'待投递', attempted:'送达待核对', sent:'已发到小 K 私聊', unconfirmed:'送达未确认', expired:'仅在简报页保留',
};
