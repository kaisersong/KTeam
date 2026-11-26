export type WatchKind = 'waiting' | 'commitment';
export type WatchState = 'active' | 'paused' | 'stopped' | 'done' | 'dismissed';
export type WatchStatus = 'scheduled' | 'due' | 'missed' | 'unconfirmed' | 'source-unavailable';
export type WatchMeetingReview = {day:string; titles:string[]};
export type WatchDecision = 'online'|'decline';

export interface WatchDraft {
 title: string;
 condition: string;
 kind: WatchKind;
 checkAt: number;
 stopAt: number;
 link?: string;
 itemId?: string;
 calendar?:WatchMeetingReview;
}

export interface WatchReminder {
 at:number;
 status:'attempted'|'sent'|'unconfirmed';
 verifiedTitles?:string[];
 evidenceDigest?:string;
}
export interface WatchPrompt {
 id:string;
 revision:number;
 title:string;
 reviewedAt:number;
 verifiedTitles?:string[];
}
export interface WatchProposal {id:string; draft:WatchDraft; expiresAt:number}

export interface WatchItem {
 id: string;
 revision: number;
 state: WatchState;
 status: WatchStatus;
 checkAt: number;
 stopAt: number;
 sourceLinked:boolean;
 checkedAt?: number;
 snoozedUntil?: number;
 details?: Pick<WatchDraft, 'title' | 'condition' | 'kind' | 'link' | 'calendar'> & {originalLink?: string};
 reminder?:WatchReminder;
 decision?:{choice:WatchDecision;at:number;titles:string[]};
}

type WatchStateAction='check'|'pause'|'resume'|'stop'|'done'|'dismiss'|'snooze'|'recheck';
export type WatchCommand =
 | {action:'create'; id:string; draft:WatchDraft}
 | {action:'edit'; id:string; expectedRevision:number; draft:WatchDraft; clearCalendar?:boolean}
 | {action:'confirm-draft'|'dismiss-draft';id:string}
 | {action:'decide';id:string;expectedRevision:number;choice:WatchDecision}
 | {action:WatchStateAction; id:string; expectedRevision:number};

export function watchStatus(item:Pick<WatchItem,'checkedAt'|'checkAt'|'stopAt'|'snoozedUntil'|'reminder'>,now:number):WatchStatus {
 return item.reminder||item.checkedAt!==undefined&&item.checkedAt>=item.checkAt?'unconfirmed':
  now>=item.stopAt?'missed':now>=Math.max(item.checkAt,item.snoozedUntil??0)?'due':'scheduled';
}

export const watchStatuses:Record<WatchStatus,string> = {
 scheduled:'等待检查点', due:'已到检查点，请核对', missed:'已错过检查窗口，待回看',
 unconfirmed:'已到复核环节，待处理', 'source-unavailable':'无法复核来源',
};
export const watchStates:Record<Exclude<WatchState,'active'>,string> = {
 paused:'已暂停', stopped:'已停止', done:'已处理', dismissed:'不是我的事项',
};

export const watchDefaults = () => {
 const checkAt = Date.now() + 3600000;
 return {title:'',condition:'',kind:'waiting' as const,checkAt,stopAt:checkAt+86400000};
};

const two = (value:number) => String(value).padStart(2,'0');
export function localWatchTime(at:number) {
 const date=new Date(at);
 return `${date.getFullYear()}-${two(date.getMonth()+1)}-${two(date.getDate())}T${two(date.getHours())}:${two(date.getMinutes())}`;
}

export function parseWatchTime(value:string) {
 const local=value.trim().replace(' ','T');
 const at=Date.parse(local);
 return Number.isFinite(at)&&localWatchTime(at)===local?at:NaN;
}

export function watchActions(item:WatchItem):{action:WatchStateAction;label:string}[]{
 if(item.state==='paused')return [{action:'resume',label:'恢复'},{action:'stop',label:'停止'},{action:'done',label:'已处理'}];
 if(item.state!=='active')return [];
 const pending=item.status==='missed'||item.status==='source-unavailable'?[]:[
  {action:'check',label:'现在自查'},{action:'snooze',label:'延后 1 小时'},
 ] as const;
 return [...pending,{action:'pause',label:'暂停'},{action:'stop',label:'停止'},{action:'done',label:'已处理'},{action:'dismiss',label:'不是我的'}];
}

export function watchError(error:unknown) {
 const code=error instanceof Error?error.message:String(error);
 if(code==='watch_changed')return '事项已更新，请重新查看。';
 if(code==='watch_invalid')return '请核对事项、检查时间、停止时间和来源链接。';
 if(code==='watch_limit')return '进行中的事项已达上限。处理或停止一条后可以继续登记。';
 if(['daily_source_unavailable','daily_source_changed'].includes(code))return '无法核对原消息或访问权限。';
 return '暂时无法处理，请刷新后重试。';
}

export const watchEvidenceLifetime = 30000;

export function watchDisplay(item:WatchItem, verifiedAt:number, now:number):WatchItem {
 if(item.sourceLinked&&(!item.details||now-verifiedAt>=watchEvidenceLifetime))return {...item,details:undefined,status:'source-unavailable'};
 return {...item,status:watchStatus(item,now)};
}
