import {ArrowRight,CalendarClock,CalendarSearch} from 'lucide-react';
import type {AssistantDailyCard} from '../../../src/protocol/assistant-daily-card';
import {A2uiArtifactRenderer} from '../../core-ui/renderer/src/components/a2ui/A2uiArtifactRenderer';
import {Markdown} from './Markdown';

export function AssistantDigestCard({card,text,onOpen,onDraft}:{card:AssistantDailyCard;text:string;onOpen:()=>void;onDraft:()=>void}){
 const schedule=card.kind==='schedule-change';
 return <section className={'assistant-digest-card'+(schedule?' assistant-digest-card--schedule':'')} aria-label={schedule?'日程变更':'小 K 推送卡片'}>
  {schedule&&<header><CalendarClock size={16} aria-hidden="true"/>日程变更</header>}
  <A2uiArtifactRenderer artifactContent={card.content} artifactRef={{key:card.artifactId,artifactId:card.artifactId}}
   fallback={<Markdown text={text}/>}/>
  <footer>{card.calendarCheckDraft
   ? <button type="button" className="secondary assistant-card-action" onClick={onDraft}><CalendarSearch size={15} aria-hidden="true"/>准备日历核对<ArrowRight size={14} aria-hidden="true"/></button>
   : <button type="button" className="secondary" onClick={onOpen}>查看简报<ArrowRight size={14} aria-hidden="true"/></button>}
  </footer>
 </section>;
}
