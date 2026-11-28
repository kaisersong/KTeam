import {useEffect,useRef,useState} from 'react';
import {RefreshCw,ShieldCheck,Users} from 'lucide-react';
import {api,explain} from './api';
import {sharedCacheMs} from '../../../src/protocol/shared-desktop';

const client=(action:string,input:Record<string,unknown>={})=>api.sharedGroupClient({action,...input});
const admin=(action:string,input:Record<string,unknown>={})=>api.changeSharedGroupSettings({action,...input});
const printable=(value:unknown)=>JSON.stringify(value,null,2);
const clock=(value:number)=>new Date(value).toLocaleString();
const ids=(value:string)=>value.trim().split(/[\s,，]+/).filter(Boolean);
const message=(error:unknown)=>{
 const code=error instanceof Error?error.message:String(error);
 const labels:Record<string,string>={
  shared_private_https_required:'请输入包含私网 IP 的 HTTPS 地址。',
  shared_listener_unavailable:'共享入口未能监听。请检查本机是否拥有该私网地址，以及端口是否可用。',
  shared_self_probe_timeout:'共享入口已监听，但本机 TLS 自检超时。',
  shared_self_probe_failed:'共享入口已监听，但本机 TLS 自检连接失败。',
  shared_certificate_mismatch:'证书指纹、IP 或有效期校验失败。',
  shared_coordinator_identity_mismatch:'协调端身份与受信材料不符。',
  shared_invite_unavailable:'邀请已过期或不可用。请让协调端创建新邀请。',
  shared_identity_rotation_required:'协调端地址已绑定。',
  shared_draft_invalid:'草稿超过 32 KiB，请缩短后重试。',
  broker_unavailable:'协调端暂时无法读取 Broker，草稿已保留。',
  shared_coordinator_unreachable:'协调端暂时不可达。已保存的草稿可在重连后继续编辑。',
  shared_device_unauthorized:'共享设备会话已失效，请重新配对。',
  shared_room_authority_unavailable:'共享聊天权限尚未在协调端和 Broker 间配置完成。',
  shared_operation_pending_verification:'权威回执仍待核实。本次操作保持待确认。',
  upstream_operation_unknown:'写入结果待核实。请查询原请求的权威回执。',
  host_operation_unknown:'宿主还未返回结果。请刷新待确认状态。',
  room_revision_conflict:'成员版本已改变。刷新历史后重新确认本次变更。'
 };
 return labels[code]??explain(error);
};
function Materials({label,value}:{label:string;value:unknown}){
 return <label className="shared-field">{label}<textarea rows={5} readOnly value={printable(value)}/></label>;
}

export function SharedGroupsSettings(){
 const [settings,setSettings]=useState<any>(),[state,setState]=useState<any>();
 const [endpoint,setEndpoint]=useState(''),[invite,setInvite]=useState<any>(),[inviteText,setInviteText]=useState('');
 const [trustText,setTrustText]=useState(''),[confirmed,setConfirmed]=useState<Record<string,string>>({});
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
 const [now,setNow]=useState(Date.now());
 const load=async()=>{
  const [settings,state]=await Promise.all([api.sharedGroupSettings(),client('state')]);
  setSettings(settings);
  setState(state);
 };
 useEffect(()=>{
  let active=true;
  const refresh=()=>void api.sharedGroupSettings().then(value=>{if(active)setSettings(value);},error=>{if(active)setError(message(error));});
  refresh();
  void client('state').then(value=>{if(active)setState(value);},error=>{if(active)setError(message(error));});
  const poll=setInterval(refresh,3000),timer=setInterval(()=>setNow(Date.now()),1000);
  return()=>{active=false;clearInterval(poll);clearInterval(timer);};
 },[]);
 const perform=async(work:()=>Promise<void>)=>{
  setBusy(true);setError('');setNotice('');
  try{await work();await load();}
  catch(error){setError(error instanceof SyntaxError?'材料必须是有效的 JSON。':message(error));await load().catch(()=>{});}
  finally{setBusy(false);}
 };
 const usePairing=async(check:boolean)=>{
  const result=await (check?client('pair-check'):client('pair',{trust:JSON.parse(trustText),invite:JSON.parse(inviteText)}));
  setNotice(result.paired?'配对成功，可以打开共享群。':'设备公钥已提交，请让协调端管理员核对并批准。');
  if(result.paired){setInviteText('');setTrustText('');}
 };
 return <div className="shared-settings">
  <section className="settings-block">
   <h2><ShieldCheck size={17}/> 协调端</h2>
   <p className="settings-description">在常在线的机器启用私网 HTTPS 入口。签发密钥和证书指纹用于核验协调端身份。</p>
   {error&&<p role="alert" className="settings-error">{error}</p>}
   {notice&&<p role="status" className="settings-success">{notice}</p>}
   <p role="status">{settings?.listening?'共享入口正在监听':settings?'共享入口未监听':'正在读取共享入口'}{settings?.listenError&&' · '+message(settings.listenError)}</p>
   <label className="shared-field">私网 HTTPS 地址
    <input value={settings?.trust?.endpoint??endpoint} disabled={busy||!settings||!!settings.trust} onChange={event=>setEndpoint(event.target.value)} placeholder="https://192.168.1.10:8443"/>
   </label>
   <div className="settings-actions">
    <button className="secondary" disabled={busy||!settings||(!settings.listening&&!settings.trust&&!endpoint.trim())} onClick={()=>void perform(async()=>{
     await admin(settings.listening?'disable':'enable',settings.listening?{}:{endpoint:settings.trust?.endpoint??endpoint});
    })}>{settings?.listening?'停止监听':'启用监听'}</button>
    {settings?.listening&&<button className="secondary" disabled={busy} onClick={()=>void perform(async()=>{
     if(state?.connection&&state.connection.trust.coordinatorId!==settings.coordinatorId&&!window.confirm('切换到本机协调端的共享会话？'))return;
     await client('pair-local');
     setNotice('本机已加入共享群。');
    })}>用本机加入共享群</button>}
   </div>
   {settings?.trust&&<Materials label="受信协调端材料（地址、协调端 ID、公钥、证书指纹）" value={settings.trust}/>}
   <div className="settings-actions">
    <button className="secondary" disabled={busy||!settings?.listening} onClick={()=>void perform(async()=>setInvite(await admin('invite')))}>创建两分钟邀请</button>
    <button className="secondary" disabled={busy||!settings?.trust} onClick={()=>void perform(async()=>{
     if(!window.confirm('轮换协调端签发密钥会使所有旧设备会话失效。确认轮换？'))return;
     await admin('rotate-coordinator-key');
     setInvite(undefined);
    })}>轮换签发密钥</button>
   </div>
   {invite&&invite.expiresAt>now&&<>
    <Materials label="邀请材料（通过可信渠道交给另一台机器）" value={{inviteId:invite.inviteId,secret:invite.secret,challenge:invite.challenge}}/>
    <p>剩余 {Math.ceil((invite.expiresAt-now)/1000)} 秒</p>
   </>}
   <h3>设备审批</h3>
   {(settings?.requests??[]).filter((request:any)=>request.publicKey).map((request:any)=><div className="shared-device" key={request.id}>
    <code>{request.id}</code>
    <label className="shared-field">待批准设备公钥<textarea rows={3} readOnly value={request.publicKey}/></label>
    <label className="shared-field">粘贴从对方设备独立核对的公钥
     <textarea rows={3} value={confirmed[request.id]??''} onChange={event=>setConfirmed({...confirmed,[request.id]:event.target.value})}/>
    </label>
    <button className="secondary" disabled={busy||request.approved||confirmed[request.id]?.trim()!==request.publicKey.trim()} onClick={()=>void perform(async()=>{
     await admin('approve',{inviteId:request.id,publicKey:confirmed[request.id]});
    })}>{request.approved?'已批准，等待设备领取':'批准此设备公钥'}</button>
   </div>)}
   <h3>已登记设备</h3>
   {!settings?.devices?.length&&<p className="settings-description">暂无设备。</p>}
   {(settings?.devices??[]).map((device:any)=><div className="shared-device" key={device.deviceId}>
    <code>{device.deviceId}</code>{device.deviceId===state?.connection?.deviceId&&' · 本机'}
    <details><summary>设备公钥</summary><pre>{device.publicKey}</pre></details>
    <button className="secondary" disabled={busy||device.revoked} onClick={()=>void perform(async()=>{
     if(window.confirm('撤销后，该设备将无法读取共享群、提交消息或查询回执。确认撤销？'))
      await admin('revoke',{deviceId:device.deviceId});
    })}>{device.revoked?'已撤销':'撤销设备'}</button>
   </div>)}
  </section>
  <section className="settings-block">
   <h2>设备配对</h2>
   <p className="settings-description">通过可信渠道核对协调端公钥和证书指纹，再粘贴受信材料与邀请。</p>
   {state?.connection&&<p>当前会话 · <code>{state.connection.deviceId}</code> · 签发代际 {state.connection.generation}</p>}
   <label className="shared-field">受信协调端材料<textarea rows={5} value={trustText} onChange={event=>setTrustText(event.target.value)}/></label>
   <label className="shared-field">邀请材料<textarea rows={4} value={inviteText} onChange={event=>setInviteText(event.target.value)}/></label>
   {state?.pairing&&<label className="shared-field">本机设备公钥（供管理员核对）<textarea rows={3} readOnly value={state.pairing.publicKey}/></label>}
   <div className="settings-actions">
    <button className="secondary" disabled={busy||!inviteText.trim()||!trustText.trim()} onClick={()=>void perform(()=>usePairing(false))}>核验身份并提交配对</button>
    {state?.pairing&&<button className="secondary" disabled={busy} onClick={()=>void perform(()=>usePairing(true))}>查询配对结果</button>}
    {state?.connection&&<button className="secondary" disabled={busy} onClick={()=>void perform(async()=>{setState(undefined);await client('logout');})}>退出共享会话</button>}
   </div>
  </section>
  {state?.connection&&<SharedRoomWorkspace key={state.connection.deviceId+':'+state.connection.generation} onUnauthorized={()=>void client('state').then(setState).catch(()=>setState(undefined))}/>}
 </div>;
}

function SharedRoomWorkspace({onUnauthorized}:{onUnauthorized:()=>void}){
 const [list,setList]=useState<any>(),[roomId,setRoomId]=useState(''),[view,setView]=useState<any>();
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[checking,setChecking]=useState(false);
 const [title,setTitle]=useState(''),[agents,setAgents]=useState(''),[added,setAdded]=useState(''),[removed,setRemoved]=useState('');
 const [draft,setDraft]=useState<any>(),[pending,setPending]=useState<any[]>([]),[draftRooms,setDraftRooms]=useState<string[]>([]);
 const roomRef=useRef(''),viewRef=useRef<any>(undefined),refreshing=useRef(false),saves=useRef(Promise.resolve());
 const history=view?.history;
 const offline=view?.offline||list?.offline;
 const locked=draft?.requestId;
 const updateView=(value:any)=>{viewRef.current=value;setView(value);};
 const handleError=(error:unknown)=>{
  if(error instanceof Error&&['shared_device_unauthorized','shared_certificate_mismatch','shared_pairing_required'].includes(error.message)){
   setList(undefined);updateView(undefined);setDraft(undefined);
   onUnauthorized();
  }
  setError(message(error));
 };
 const loadLocal=async(target:string)=>{
  const [state,local]=await Promise.all([client('state'),target?client('draft',{roomId:target}):Promise.resolve(undefined)]);
  setPending(state.pending);
  setDraftRooms(state.draftRooms);
  if(target===roomRef.current&&local)setDraft(local.draft??{text:''});
 };
 const refresh=async(target:string,forcePage=false)=>{
  if(refreshing.current)return;
  refreshing.current=true;
  setChecking(true);
  try{
   const list=await client('rooms');
   setList(list);
   if(!list.offline&&viewRef.current?.offline)setError('');
   if(!target||target!==roomRef.current)return;
   if(!list.offline&&!list.rooms.some((room:any)=>room.roomId===target)){
    updateView(undefined);return;
   }
   // While reading a paginated snapshot, advance only on demand. Completed snapshots catch up on refresh.
   if(!viewRef.current?.history?.nextCursor||forcePage||list.offline||viewRef.current?.offline){
    const result=await client('history',{roomId:target});
    if(target===roomRef.current)updateView(result);
   }
  }catch(error){handleError(error);}
  finally{refreshing.current=false;setChecking(false);}
 };
 const poll=useRef(refresh);
 poll.current=refresh;
 useEffect(()=>{
  void poll.current('');
  void loadLocal('').catch(handleError);
  const timer=setInterval(()=>{if(document.visibilityState==='visible')void poll.current(roomRef.current);},4000);
  return()=>clearInterval(timer);
 },[]);
 useEffect(()=>{
  if(!history?.cachedAt)return;
  const timer=setTimeout(()=>updateView(undefined),Math.max(0,history.cachedAt+sharedCacheMs-Date.now()));
  return()=>clearTimeout(timer);
 },[history?.cachedAt]);
 useEffect(()=>{
  if(!list?.cachedAt||!list.offline)return;
  const timer=setTimeout(()=>setList(undefined),Math.max(0,list.cachedAt+sharedCacheMs-Date.now()));
  return()=>clearTimeout(timer);
 },[list?.cachedAt,list?.offline]);
 const select=(target:string)=>{
  roomRef.current=target;setRoomId(target);updateView(undefined);setDraft(undefined);setAdded('');setRemoved('');setError('');
  void loadLocal(target).catch(handleError);
  void refresh(target);
 };
 const perform=async(work:()=>Promise<unknown>)=>{
  setBusy(true);setError('');
  try{await work();}
  catch(error){handleError(error);}
  finally{
   const target=roomRef.current;
   await loadLocal(target).catch(handleError);
   await refresh(target,true);
   setBusy(false);
  }
 };
 const save=(text:string)=>{
  const target=roomRef.current;
  setDraft({text});
  setDraftRooms(current=>text?[...new Set([...current,target])]:current.filter(id=>id!==target));
  saves.current=saves.current.catch(()=>{}).then(()=>client('save-draft',{roomId:target,text}));
  void saves.current.catch(handleError);
 };
 const revision=history?.room.revision;
 return <section className="settings-block shared-room-workspace">
  <h2><Users size={17}/> 共享群</h2>
  <p className="settings-description">共享群支持纯文本聊天。派工和执行当前不可用。</p>
  {error&&<p role="alert" className="settings-error">{error}</p>}
  {offline&&<p role="status">协调端暂时不可用。{list?.cachedAt?'群列表缓存于 '+clock(list.cachedAt)+'。':''} 输入保存为草稿。</p>}
  <div className="settings-actions">
   <button className="secondary" disabled={checking||busy} onClick={()=>void refresh(roomId)}><RefreshCw size={14}/>刷新共享群</button>
   <select aria-label="共享群" value={roomId} disabled={busy} onChange={event=>select(event.target.value)}>
    <option value="">选择共享群</option>
    {(list?.rooms??[]).map((room:any)=><option key={room.roomId} value={room.roomId}>{room.title}</option>)}
    {draftRooms.filter(id=>!list?.rooms.some((room:any)=>room.roomId===id)).map(id=><option key={id} value={id}>草稿 · {id}</option>)}
   </select>
  </div>
  <details className="shared-room-form">
   <summary>创建共享群</summary>
   <label className="shared-field">群名称<input value={title} maxLength={256} onChange={event=>setTitle(event.target.value)}/></label>
   <label className="shared-field">成员逻辑 Agent ID<input value={agents} onChange={event=>setAgents(event.target.value)}/></label>
   <p className="settings-description">用逗号或空格分隔 Broker 成员协议的逻辑 Agent ID。当前没有跨机器 Bot 目录或 KSwarm 校验。</p>
   <button className="secondary" disabled={busy||!!offline||!title.trim()||pending.some(item=>item.operation==='create')} onClick={()=>void perform(async()=>{
    await client('create',{title,memberAgentIds:ids(agents)});
    setTitle('');setAgents('');
   })}>创建共享群</button>
  </details>
  {!!pending.length&&<div className="shared-room-form">
   <h3>待确认提交</h3>
   {pending.map(item=><div key={item.requestId} className="shared-device">
    <span>{({create:'建群',members:'成员变更',message:'消息'} as Record<string,string>)[item.operation]} · {clock(item.firstSentAt)} · 代际 {item.coordinatorGeneration}</span>
    <code>{item.requestId}</code>
    <button className="secondary" disabled={busy||!!offline} onClick={()=>void perform(()=>client('receipt',{requestId:item.requestId}))}>查询原回执</button>
   </div>)}
  </div>}
  {roomId&&<>
   {history&&<>
    <h3>{history.room.title}</h3>
    <p role="status">{offline?'缓存水位':'已读水位'} {history.watermark} · {clock(history.cachedAt)}
     {history.nextCursor&&' · 快照上界 '+history.roomSequenceUpperBound}</p>
    {history.missingThrough>0&&<p role="status">权威历史缺失序号 1–{history.missingThrough}，{history.earliestAvailableSequence==null?'暂无可读记录':'最早可读序号 '+history.earliestAvailableSequence}。</p>}
    {history.localWindowStart&&<p>当前缓存窗口从序号 {history.localWindowStart} 开始。</p>}
    <ol className="shared-history" aria-label="共享群历史">
     {history.messages.map((entry:any)=><li key={entry.roomSequence}>
      <small>{entry.roomSequence} · {clock(Date.parse(entry.createdAt))}</small><p>{entry.text}</p>
     </li>)}
    </ol>
    {history.nextCursor&&<button className="secondary" disabled={checking||busy||offline} onClick={()=>void refresh(roomId,true)}>读取下一页</button>}
    <details className="shared-room-form">
     <summary>成员（版本 {revision}）</summary>
     <ul>{history.members.filter((item:any)=>item.status==='active'&&item.subject.kind==='agent').map((item:any)=><li key={item.subject.logicalAgentId}><code>{item.subject.logicalAgentId}</code></li>)}</ul>
     <label className="shared-field">加入的逻辑 Agent ID<input value={added} onChange={event=>setAdded(event.target.value)}/></label>
     <label className="shared-field">移除的逻辑 Agent ID<input value={removed} onChange={event=>setRemoved(event.target.value)}/></label>
     <button className="secondary" disabled={busy||offline||(!added.trim()&&!removed.trim())||pending.some(item=>item.roomId===roomId&&item.operation==='members')} onClick={()=>void perform(async()=>{
      await client('members',{roomId,expectedRoomRevision:revision,addAgentIds:ids(added),removeAgentIds:ids(removed)});
      setAdded('');setRemoved('');
     })}>保存成员变更</button>
    </details>
   </>}
   <label className="shared-field">消息草稿<textarea rows={4} maxLength={32768} value={draft?.text??''} disabled={!draft||!!locked||busy} onChange={event=>save(event.target.value)}/></label>
   {locked&&<p role="status">此草稿关联待确认请求 {locked}。</p>}
   {locked&&!pending.some(item=>item.requestId===locked)&&<button className="secondary" disabled={busy} onClick={()=>void perform(async()=>{
    if(window.confirm('原请求的七天查询期已结束，结果仍可能已写入。清除此草稿？'))await client('discard-expired-draft',{roomId});
   })}>清除到期草稿</button>}
   <button className="secondary" disabled={busy||!!offline||!!locked||!revision||!draft?.text.trim()} onClick={()=>void perform(async()=>{
    await saves.current;
    await client('message',{roomId,expectedRoomRevision:revision});
   })}>发送文本</button>
  </>}
 </section>;
}
