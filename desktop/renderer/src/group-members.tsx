import {useEffect,useRef,useState} from 'react';
import {Plus,Search,Trash2} from 'lucide-react';
import {api,explain,type Bot} from './api';
import {Avatar,Modal} from './components';
const name=(bot:{name:string})=>bot.name.replace(/ · KTeam .+$/,'');
export function GroupMemberManager({roomId,remove,onClose,onChanged,onCreate}:{roomId:string;remove?:Bot;onClose:()=>void;onChanged:()=>Promise<void>;onCreate?:()=>void}){
 const [data,setData]=useState<any>(),[selected,setSelected]=useState<string[]>([]),[query,setQuery]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const alive=useRef(true),locked=useRef(false),intent=useRef<{fingerprint:string;requestId:string}|undefined>(undefined);
 useEffect(()=>{alive.current=true;void load();return()=>{alive.current=false;};},[roomId]);
 async function load(){setError('');try{const result=await api.groupMembers(roomId);if(alive.current){setData(result);setSelected([]);}}catch(e){if(alive.current)setError(explain(e));}}
 async function save(){
  if(!data||locked.current)return;locked.current=true;setBusy(true);setError('');
  const input={roomId,action:remove?'remove':'add',botIds:remove?[remove.id]:[...selected].sort(),expectedRoomRevision:data.roomRevision},fingerprint=JSON.stringify(input);
  if(intent.current?.fingerprint!==fingerprint)intent.current={fingerprint,requestId:crypto.randomUUID()};
  try{await api.changeGroupMembers({...input,requestId:intent.current.requestId});await onChanged();if(alive.current)onClose();}
  catch(e){if(alive.current)setError(explain(e));}finally{locked.current=false;if(alive.current)setBusy(false);}
 }
 const candidates=(data?.candidates??[]).filter((bot:any)=>(name(bot)+' '+bot.model).toLowerCase().includes(query.toLowerCase()));
 return <Modal title={remove?'移除群成员':'添加群成员'} onClose={()=>{if(!locked.current)onClose();}}>
  {error&&<div className="flow-error" role="alert">{error}<button className="text-button" disabled={busy} onClick={()=>void load()}>重新读取</button></div>}
  {!data?<p role="status">正在读取群成员…</p>:remove?<p>确定将「{name(remove)}」移出当前群聊？该 Bot 和其他会话会保留，移出后将无法继续参与本群工作。</p>:<>
   <p className="muted">选择已有 Bot 加入当前群聊。</p><label className="group-member-search"><Search size={16}/><input aria-label="搜索可添加的成员" value={query} disabled={busy} placeholder="搜索成员" onChange={e=>setQuery(e.target.value)}/></label>
   <div className="group-member-picker">{candidates.map((bot:any)=><label key={bot.id} className="group-member-choice"><input type="checkbox" aria-label={'添加 '+name(bot)} checked={selected.includes(bot.id)} disabled={busy} onChange={e=>setSelected(ids=>e.target.checked?[...ids,bot.id]:ids.filter(id=>id!==bot.id))}/><Avatar {...bot}/><span><strong>{name(bot)}</strong><small>{bot.model}</small></span></label>)}{!candidates.length&&<p className="muted">{query?'没有匹配的成员。':'暂无可添加的成员，已有成员不会重复显示。'}</p>}</div>
   {onCreate&&<button className="text-button" disabled={busy} onClick={()=>{onClose();onCreate();}}><Plus size={14}/>创建新 Bot</button>}
  </>}
  <div className="group-member-actions"><button className="secondary" disabled={busy} onClick={onClose}>取消</button><button className={remove?'secondary danger':'primary'} disabled={busy||!data||!remove&&!selected.length||!!remove&&!data?.memberIds.includes(remove.id)} onClick={()=>void save()}>{remove?<><Trash2 size={15}/>{busy?'正在移除…':'确认移除'}</>:<><Plus size={15}/>{busy?'正在添加…':'添加'+(selected.length?' '+selected.length+' 位成员':'成员')}</>}</button></div>
 </Modal>;
}
