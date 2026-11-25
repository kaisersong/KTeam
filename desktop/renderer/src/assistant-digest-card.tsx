import {ArrowRight} from 'lucide-react';
import type {AssistantDailyCard} from '../../../src/protocol/assistant-daily-card';
import {A2uiArtifactRenderer} from '../../core-ui/renderer/src/components/a2ui/A2uiArtifactRenderer';
import {Markdown} from './Markdown';

export function AssistantDigestCard({card,text,onOpen}:{card:AssistantDailyCard;text:string;onOpen:()=>void}){
 return <section className="assistant-digest-card" aria-label="小 K 推送卡片">
  <A2uiArtifactRenderer artifactContent={card.content} artifactRef={{key:card.artifactId,artifactId:card.artifactId}}
   fallback={<Markdown text={text}/>}/>
  <footer><button type="button" className="secondary" onClick={onOpen}>查看并处理<ArrowRight size={14}/></button></footer>
 </section>;
}
