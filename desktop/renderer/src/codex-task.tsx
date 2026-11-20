import {useEffect, useRef, useState} from 'react';
import {api, explain, type Bot, type CodexGrantView} from './api';
import {Modal} from './components';

export const isCodexMember = (bot: Bot) => bot.binding?.kind==='local-native'&&bot.binding.modelId==='local-agent:codex';
const label = (bot: Bot) => bot.name.replace(/ · KTeam .+$/, '');

export function CodexWriteSettings({botId}:{botId:string}) {
 const [view,setView]=useState<CodexGrantView>(),[path,setPath]=useState<string>(),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let mounted=true;void api.codexWriteGrant(botId).then(value=>{if(mounted)setView(value);}).catch(error=>{if(mounted)setError(explain(error));});return()=>{mounted=false;};},[botId]);
 const run=async(action:()=>Promise<void>)=>{setBusy(true);setError('');try{await action();}catch(error){setError(explain(error));}finally{setBusy(false);}};
 const save=(next:string|null)=>void run(async()=>{if(!view)return;setView(await api.saveCodexWriteGrant({botId,path:next,expectedRevision:view.grant.revision}));setPath(undefined);});
 return <section className="bot-capability-panel" aria-label="Codex 目录写入授权">
  <h3>Codex 目录写入授权</h3>
  <p className="form-note">授权覆盖所选目录及当前和以后新建的子目录。群内派工还须单独允许本任务修改文件。</p>
  {error&&<p className="flow-error" role="alert">{error}<button type="button" className="text-button" disabled={busy} onClick={()=>void run(async()=>{setView(await api.codexWriteGrant(botId));})}>重新读取</button></p>}
  {view&&<><p className="form-note">{view.grant.path??'尚未授权目录'}</p>
  {path&&<p className="form-note">待保存目录 {path}</p>}
  {view.supported?<div className="workspace-inline">
   <button type="button" className="secondary" disabled={busy} onClick={()=>void run(async()=>{const selected=await api.chooseWorkspace();if(!selected.cancelled)setPath(selected.path);})}>{view.grant.path?'更改目录':'选择目录'}</button>
   {path&&<button type="button" className="primary" disabled={busy} onClick={()=>save(path)}>授权写入</button>}
   {view.grant.path&&<button type="button" className="secondary" disabled={busy} onClick={()=>save(null)}>撤销授权</button>}
  </div>:<p className="form-note">此平台暂不支持受限的 Codex 写入任务。</p>}</>}
 </section>;
}

export function CodexDispatchDialog({roomId,bots,initialText,initialBot,onClose,onSent}:{roomId:string;bots:Bot[];initialText:string;initialBot?:string;onClose:()=>void;onSent:()=>void}) {
 const [botId,setBotId]=useState(initialBot??bots[0]?.id??''),[body,setBody]=useState(initialText),[allowWrite,setAllowWrite]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [grant,setGrant]=useState<CodexGrantView>();
 const intent=useRef<{id:string;key:string}|undefined>(undefined);
 useEffect(()=>{let live=true;setGrant(undefined);if(botId)void api.codexWriteGrant(botId).then(value=>{if(live)setGrant(value);}).catch(error=>{if(live)setError(explain(error));});return()=>{live=false;};},[botId]);
 const submit=async()=>{if(busy||!botId||!body.trim())return;const key=JSON.stringify([botId,body,allowWrite]);if(intent.current?.key!==key)intent.current={key,id:'msg_'+crypto.randomUUID().replaceAll('-','')};setBusy(true);setError('');try{await api.dispatchCodex({roomId,botId,text:body,id:intent.current.id,allowWrite});onSent();}catch(error){setError(explain(error));}finally{setBusy(false);}};
 return <Modal title="派发 Codex 任务" onClose={onClose}>
  {error&&<p className="flow-error" role="alert">{error}</p>}
  <label>执行成员<select value={botId} disabled={busy} onChange={event=>{setBotId(event.target.value);setAllowWrite(false);setError('');}}>{bots.map(bot=><option key={bot.id} value={bot.id}>{label(bot)}</option>)}</select></label>
  {grant&&<p className="form-note">{grant.grant.path??'该成员尚未获得目录写入授权'}</p>}
  <label>任务要求<textarea value={body} disabled={busy} maxLength={32768} onChange={event=>setBody(event.target.value)}/></label>
  <label><input type="checkbox" checked={allowWrite} disabled={busy||grant?.supported!==true} onChange={event=>setAllowWrite(event.target.checked)}/> 允许本任务修改文件</label>
  <button type="button" className="primary full" disabled={busy||!botId||!body.trim()} onClick={()=>void submit()}>派发任务</button>
 </Modal>;
}

export function CodexWorkBlocked({job,bots,onSettings,onDispatch}:{job:any;bots:Bot[];onSettings:(bot:Bot)=>void;onDispatch:()=>void}) {
 const reason=job.failure?.code??job.reason;
 if(!['blocked','stopped'].includes(job.state)||!job.codexDispatch||!['codex_write_grant_required','codex_task_write_required','codex_write_grant_changed','codex_write_target_outside','codex_write_sandbox_denied','native_codex_write_sandbox_unavailable'].includes(reason))return null;
 const bot=bots.find(bot=>bot.id===job.codexDispatch.botId);
 return <section className="conversation-note" role="status">
  <p>{bot?label(bot):job.codexDispatch.botId} · {explain(reason)}</p>
  {job.codexDispatch.path&&<p className="form-note">{job.codexDispatch.path}</p>}
  {reason!=='codex_task_write_required'&&bot&&isCodexMember(bot)&&<button type="button" onClick={()=>onSettings(bot)}>查看目录授权</button>}
  {reason!=='codex_write_sandbox_denied'&&bot&&isCodexMember(bot)&&<button type="button" onClick={onDispatch}>重新派工</button>}
 </section>;
}
