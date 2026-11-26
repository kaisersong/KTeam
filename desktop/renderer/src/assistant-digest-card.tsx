import {ArrowRight,CalendarClock,CalendarSearch,CalendarDays} from 'lucide-react';
import type {AssistantDailyCard} from '../../../src/protocol/assistant-daily-card';
import {A2uiArtifactRenderer} from '../../core-ui/renderer/src/components/a2ui/A2uiArtifactRenderer';
import {Markdown} from './Markdown';

export function AssistantDigestCard({card,text,onOpen,onDraft}:{card:AssistantDailyCard;text:string;onOpen:()=>void;onDraft:()=>void}){
 const invitation=card.kind==='meeting-invitation';
 const label=invitation?'会议邀请':card.kind==='schedule-change'?'日程变更':undefined;
 const Icon=invitation?CalendarDays:CalendarClock;
 return <section className={'assistant-digest-card'+(label?' assistant-digest-card--schedule':'')+(invitation?' assistant-digest-card--invitation':'')} aria-label={label??'小 K 推送卡片'}>
  {label&&<header><Icon size={16} aria-hidden="true"/>{label}{invitation&&<span className="assistant-invitation-status">参会待确认</span>}</header>}
  <A2uiArtifactRenderer artifactContent={card.content} artifactRef={{key:card.artifactId,artifactId:card.artifactId}}
   fallback={<Markdown text={text}/>}/>
  <footer>{card.calendarCheckDraft
   ? <button type="button" className="secondary assistant-card-action" onClick={onDraft}><CalendarSearch size={15} aria-hidden="true"/>{card.confirmMeetingDate?'确认会议日期':invitation?'核对我的日程':'准备日历核对'}<ArrowRight size={14} aria-hidden="true"/></button>
   : <button type="button" className="secondary" onClick={onOpen}>查看简报<ArrowRight size={14} aria-hidden="true"/></button>}
  </footer>
  {(invitation||card.showOriginal)&&<details className="assistant-invitation-original"><summary>查看通知详情</summary><div><Markdown text={text}/></div></details>}
 </section>;
}
