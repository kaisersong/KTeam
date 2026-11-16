import {useEffect,useRef,useState} from 'react';
import {ArrowDownToLine,RefreshCw,LoaderCircle,ExternalLink} from 'lucide-react';
import {api,explain} from './api';
import {presentUpdateCheck,type UpdateSnapshot} from '../../update-ui';

/** Persistent, non-modal update entry. No automatic download or restart. */
export function SidebarUpdate(){
 const [snapshot,setSnapshot]=useState<UpdateSnapshot>(),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const alive=useRef(true),generation=useRef(0),pending=useRef(false);
 const inFlight=busy||!!(snapshot?.status.checking||snapshot?.status.downloading||snapshot?.status.installing);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 useEffect(()=>{
  const read=async()=>{if(pending.current||document.visibilityState==='hidden')return;pending.current=true;const revision=generation.current;try{const next=await api.updateStatus();if(alive.current&&revision===generation.current)setSnapshot(next);}catch{/* Transient background reads do not interrupt the user's work. */}finally{pending.current=false;}};
  void read();const timer=window.setInterval(()=>void read(),inFlight?750:10000);const visible=()=>void read();document.addEventListener('visibilitychange',visible);
  return()=>{window.clearInterval(timer);document.removeEventListener('visibilitychange',visible);};
 },[inFlight]);
 if(!snapshot)return null;
 const view=presentUpdateCheck(snapshot);
 if(!['available','downloading','ready','error'].includes(view.tone)&&!error)return null;
 const label=error?'更新操作失败':view.showReleasesLink?'更新需手动安装':view.tone==='error'?'更新检查失败':view.showInstallButton?'重启并更新':snapshot.status.installing?'正在安装更新…':snapshot.status.downloading?`下载更新 ${snapshot.status.progress}%`:snapshot.status.checking?'正在检查更新…':'发现新版本';
 const disabled=busy||!!(snapshot.status.downloading||snapshot.status.checking||snapshot.status.installing);
 async function activate(){if(disabled)return;generation.current++;setBusy(true);setError('');try{
  if(view.showReleasesLink){await api.openKTeamReleases();return;}
  const next=view.showInstallButton?await api.installUpdate():view.showDownloadButton?await api.downloadUpdate():await api.checkForUpdates();if(alive.current)setSnapshot(next);
 }catch(e){if(alive.current)setError(explain(e));}finally{if(alive.current)setBusy(false);}}
 return <div className="sidebar-update" data-update-tone={view.tone}>
  <button type="button" disabled={disabled} aria-label={label} title={error||view.statusText} onClick={()=>void activate()}>
   {disabled?<LoaderCircle size={16} className="spinner"/>:view.showReleasesLink?<ExternalLink size={16}/>:view.showInstallButton?<RefreshCw size={16}/>:<ArrowDownToLine size={16}/>}
   <span><strong>{label}</strong><small>{error|| (snapshot.status.version?'KTeam '+snapshot.status.version:view.statusText)}</small></span>
  </button>
  <span className="sr-only" role="status">{error||view.statusText}</span>
 </div>;
}
