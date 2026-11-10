import {useState} from 'react';
import {api,explain,type Bot} from './api';

export function TeamRolesPanel({roomId,bots,roles,onChanged}:{roomId:string;bots:Bot[];roles:any;onChanged:()=>Promise<void>}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const choose=async(botId:string)=>{if(!botId||busy)return;setBusy(true);setError('');try{await api.assignTeamCoordinator({roomId,coordinatorBotId:botId,expectedRevision:roles?.revision??0,requestId:crypto.randomUUID()});await onChanged();}catch(error){setError(explain(error));await onChanged();}finally{setBusy(false);}};
 const coordinator=bots.find(bot=>bot.id===roles?.coordinatorBotId),spokesperson=bots.find(bot=>bot.id===roles?.spokespersonBotId);
 return <section className="workspace-section team-roles" aria-label="团队分工与负责人"><h3>团队分工</h3>
  {roles?.status==='planning'?<p role="status">正在根据成员名称和群内方向判断分工…</p>:roles?.status==='needs_choice'?<p>{spokesperson?.name??'一位成员'}会协助确认负责人。成员职责相近，请选一位统筹。</p>:roles?.status==='unavailable'?<p>暂时未能判断分工，你可以先选一位负责人。</p>:coordinator?<p><strong>{coordinator.name}</strong> · 统筹负责人{roles.coordinatorSource==='inferred'?'（根据成员角色判断）':'（你指定的）'}</p>:<p>根据成员名称和当前方向判断分工。</p>}
  <label>统筹负责人<select aria-label="统筹负责人" disabled={busy} value={roles?.coordinatorBotId??''} onChange={event=>void choose(event.target.value)}><option value="" disabled>选择一位成员</option>{bots.map(bot=><option key={bot.id} value={bot.id}>{bot.name}</option>)}</select></label>
  <p className="muted">未点名的消息由负责人先接续，已有工作按原分工继续。也可以在群里说“以后由 CTO 牵头”。</p>
  {roles?.duties&&<dl>{bots.map(bot=><div key={bot.id}><dt>{bot.name}</dt><dd>{roles.duties[bot.id]??'待明确分工'}</dd></div>)}</dl>}
  {error&&<p className="flow-error" role="alert">{error}</p>}
 </section>;
}
