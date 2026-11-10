import {useEffect,useRef,useState} from 'react';
import {RefreshCw} from 'lucide-react';
import {api,explain} from './api';

export function BotSkills({botId,onSaved}:{botId:string;onSaved:(revision:number)=>Promise<void>}){
 const [data,setData]=useState<any>(),[error,setError]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[query,setQuery]=useState('');
 const generation=useRef(0);
 async function load(){const current=++generation.current;setLoading(true);setError('');try{const value=await api.botCapabilities(botId);if(current===generation.current)setData(value);}catch(error){if(current===generation.current)setError(explain(error));}finally{if(current===generation.current)setLoading(false);}}
 useEffect(()=>{setData(undefined);setBusy(false);setQuery('');void load();return()=>{generation.current++;};},[botId]);
 async function toggle(name:string){
  if(!data||busy)return;const current=generation.current;setBusy(true);setError('');
  const disabledSkills=data.disabledSkills.includes(name)?data.disabledSkills.filter((skill:string)=>skill!==name):[...data.disabledSkills,name];
  try{const saved=await api.saveBotSkills({botId,expectedRevision:data.profileRevision,disabledSkills});if(current===generation.current){setData({...data,profileRevision:saved.profile.revision,disabledSkills,skills:data.skills.map((skill:any)=>({...skill,enabled:!skill.globallyDisabled&&!disabledSkills.includes(skill.name)}))});await onSaved(saved.profile.revision);}}
  catch(error){if(current===generation.current)setError(explain(error));}finally{if(current===generation.current)setBusy(false);}
 }
 return <section className="bot-capability-panel"><header><h3>这个 Bot 的技能</h3><button type="button" className="icon-button" aria-label="刷新 Bot 技能" disabled={busy||loading} onClick={()=>void load()}><RefreshCw size={16}/></button></header><p className="form-note">选择这个成员使用的工作方法。全局停用的技能仍保持停用，文件和命令继续遵守原有权限。</p>{loading?<p role="status">正在读取技能…</p>:data?.supported===false?<p className="form-note">{data.reason}</p>:data?.skills.length===0?<p className="form-note">这个工作目录还没有可用技能。</p>:<><label>搜索技能<input aria-label="搜索这个 Bot 的技能" value={query} onChange={event=>setQuery(event.target.value)} placeholder="搜索名称或工作方法…"/></label><div className="settings-list">{data?.skills.filter((skill:any)=>(skill.name+' '+skill.description).toLowerCase().includes(query.toLowerCase())).map((skill:any)=><div className="settings-resource" key={skill.name}><div><strong>{skill.name}</strong><p>{skill.description}</p>{skill.globallyDisabled&&<small>已在全局设置中停用</small>}</div><button type="button" role="switch" aria-label={'Bot 技能 '+skill.name} aria-checked={skill.enabled} disabled={busy||skill.globallyDisabled} className={'settings-switch '+(skill.enabled?'on':'')} onClick={()=>void toggle(skill.name)}><span/></button></div>)}</div></>}{error&&<p className="flow-error" role="alert">{error} <button type="button" className="text-link" onClick={()=>void load()}>重新读取</button></p>}</section>;
}

const cancelText:Record<string,string>={user_cancelled:'你已取消',room_settings_changed:'会话已暂停或设置发生变化',bot_source_or_origin_changed:'成员设置、执行来源或原消息已变化',daily_followup_limit:'今日跟进次数已达上限'};
const runText:Record<string,string>={followup_no_new_finding:'未发现需要提醒的新内容',followup_scope_changed:'成员设置或来源已变化，未执行检查'};
const stateText:Record<string,string>={pending:'已安排',scope_changed:'安排已失效，到期不会执行',queued:'等待执行',routing:'正在选择成员',running:'正在执行',delivered:'已提交答复',cancelled:'已取消',blocked:'需要处理',unknown:'结果待核对',stopped:'已停止',noop:'检查已结束',held:'会话已暂停'};
export function BotFollowups({botId,onOpenRoom}:{botId:string;onOpenRoom?:(roomId:string)=>void}){
 const [data,setData]=useState<any>(),[error,setError]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState('');
 const generation=useRef(0);
 async function load(){const current=++generation.current;setLoading(true);setError('');try{const value=await api.botFollowups(botId);if(current===generation.current)setData(value);}catch(error){if(current===generation.current)setError(explain(error));}finally{if(current===generation.current)setLoading(false);}}
 useEffect(()=>{setData(undefined);setBusy('');void load();return()=>{generation.current++;};},[botId]);
 async function cancel(item:any){const current=generation.current;setBusy(item.id);setError('');try{await api.cancelBotFollowup({botId,id:item.id,expectedRevision:item.revision});if(current===generation.current)await load();}catch(error){if(current===generation.current)setError(explain(error));}finally{setBusy('');}}
 const zone=Intl.DateTimeFormat().resolvedOptions().timeZone;
 return <section className="bot-capability-panel"><header><h3>已安排的跟进</h3><button type="button" className="icon-button" aria-label="刷新 Bot 跟进" disabled={!!busy||loading} onClick={()=>void load()}><RefreshCw size={16}/></button></header><p className="form-note">成员对未完成事项安排的一次性检查。时间按 {zone} 显示；不会自动循环。已开始的工作请在原会话暂停。</p>{loading?<p role="status">正在读取跟进…</p>:data?.items.length===0?<p className="form-note">还没有安排跟进。{data?.enabled?'有需要时，成员会在会话里安排。':'可在“属性与主动性”中允许一次主动跟进。'}</p>:<div className="settings-list">{data?.items.map((item:any)=><article className="bot-followup" key={item.id}><div><strong>{item.reason}</strong><p>{item.roomTitle} · {new Date(item.dueAt).toLocaleString()}</p><small>{stateText[item.state]??item.state}{item.cancelReason?' · '+(cancelText[item.cancelReason]??'安排已失效'):''}{runText[item.runReason]?' · '+runText[item.runReason]:''}</small></div><div className="followup-actions">{onOpenRoom&&<button type="button" className="secondary" onClick={()=>onOpenRoom(item.roomId)}>查看会话</button>}{item.canCancel&&<button type="button" className="secondary" disabled={!!busy} onClick={()=>void cancel(item)}>{busy===item.id?'正在取消…':'取消跟进'}</button>}</div></article>)}</div>}{error&&<p className="flow-error" role="alert">{error} <button type="button" className="text-link" onClick={()=>void load()}>重新读取</button></p>}</section>;
}
