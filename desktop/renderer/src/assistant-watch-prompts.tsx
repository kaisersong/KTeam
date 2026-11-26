import {useState} from 'react';
import {api} from './api';
import {watchError,type WatchCommand,type WatchPrompt,type WatchProposal} from '../../../src/protocol/assistant-watch';

export function AssistantWatchPrompts({proposal,prompts,onUpdate}:{proposal?:WatchProposal;prompts?:WatchPrompt[];onUpdate:()=>Promise<void>}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[receipt,setReceipt]=useState('');
 const time=(at:number)=>new Date(at).toLocaleString('zh-CN');
 async function apply(command:WatchCommand,description?:string){
  setBusy(true);setError('');setReceipt('');
  try{
   await api.changeDailyWatch(command);
   if(description)setReceipt(description);
   await onUpdate();
  }catch(cause){setError(watchError(cause));await onUpdate();}
  finally{setBusy(false);}
 }
 return <>
  {proposal&&<section className="proposal-card" aria-label="待确认的跟进">
   <h3>{proposal.draft.title}</h3><p>{proposal.draft.condition}</p>
   <p>检查时间 {time(proposal.draft.checkAt)}</p>
   {proposal.draft.calendar&&<p>复核 {proposal.draft.calendar.day} 的会议：{proposal.draft.calendar.titles.join('、')}</p>}
   <div className="assistant-daily-actions">
    <button type="button" className="primary" disabled={busy} onClick={()=>void apply({action:'confirm-draft',id:proposal.id},'跟进已安排。')}>确认跟进</button>
    <button type="button" className="secondary" disabled={busy} onClick={()=>void apply({action:'dismiss-draft',id:proposal.id})}>忽略草案</button>
   </div>
  </section>}
  {prompts?.map(item=>{
   const target={id:item.id,expectedRevision:item.revision},titles=item.verifiedTitles;
   return <section className="proposal-card" key={item.id} aria-label="跟进待处理">
    <h3>{item.title}</h3><small>复核时间 {time(item.reviewedAt)}</small>
    {!!titles?.length&&<p>可记录参会意向：{titles.join('、')}</p>}
    <div className="assistant-daily-actions">
     {!!titles?.length&&<>
      <button type="button" className="primary" disabled={busy} onClick={()=>void apply({action:'decide',choice:'online',...target},'已记录线上参加的意向。')}>记录线上参加</button>
      <button type="button" className="secondary" disabled={busy} onClick={()=>void apply({action:'decide',choice:'decline',...target},'已记录不参加的意向。')}>记录不参加</button>
     </>}
     <button type="button" className="secondary" disabled={busy} onClick={()=>void apply({action:'recheck',...target},'已安排重新复核。')}>重新复核</button>
     <button type="button" className="secondary" disabled={busy} onClick={()=>void apply({action:'snooze',...target},'已延后一小时。')}>晚点再说</button>
     <button type="button" className="text-button" disabled={busy} onClick={()=>void apply({action:'done',...target},'跟进已结束。')}>已处理</button>
    </div>
   </section>;
  })}
  {receipt&&<p role="status">{receipt}</p>}
  {error&&<p role="alert" className="settings-error">{error}</p>}
 </>;
}
