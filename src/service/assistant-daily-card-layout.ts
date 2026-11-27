import {compileRenderUiToA2ui} from '../../runtime-core/src/a2ui/compiler.js';
import {validateA2uiMessages} from '../../runtime-core/src/a2ui/decoder.js';
import type {RenderUISection} from '../../runtime-core/src/a2ui/protocol.js';

export function compileDailyCardSurface(id:string,title:string,sections:RenderUISection[]){
 const card=compileRenderUiToA2ui({title,sections},{taskId:id,toolUseId:'proactive-brief'});
 for(const message of card.messages){
  if(!('updateComponents' in message))continue;
  const components=message.updateComponents.components;
  const metrics=components.filter(component=>component.component==='MetricCard');
  for(let index=0;index+1<metrics.length;index+=2){
   const first=metrics[index]!.id,second=metrics[index+1]!.id;
   const container=components.find(component=>component.children?.includes(first));
   const children=container?.children;
   if(!children)continue;
   const siblings=components.find(component=>component.children?.includes(second))?.children;
   if(!siblings)continue;
   const rowId='brief-'+first;
   children[children.indexOf(first)]=rowId;
   siblings.splice(siblings.indexOf(second),1);
   components.push({id:rowId,component:'Row',children:[first,second]});
  }
 }
 if(!validateA2uiMessages(card.messages).ok)throw new Error('Invalid assistant card surface');
 return {artifactId:card.surfaceId,content:JSON.stringify(card.messages)};
}
