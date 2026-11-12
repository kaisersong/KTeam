import {useEffect,useRef,useState} from 'react';
import {LoaderCircle,RefreshCw} from 'lucide-react';
import {api,explain} from './api';
import {presentUpdateCheck,KTEAM_RELEASES_URL,type UpdateSnapshot} from '../../update-ui';

function emptyStatus(): UpdateSnapshot {
  return {channel:'unsupported',status:{checking:false,available:false,downloading:false,downloaded:false,progress:0}};
}

export function UpdateCheckSettings({currentVersion}:{currentVersion?:string}){
  const [snapshot,setSnapshot]=useState<UpdateSnapshot>(),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const alive=useRef(true);
  useEffect(()=>{alive.current=true;void api.updateStatus().then(value=>{if(alive.current)setSnapshot(value);}).catch(e=>{if(alive.current)setError(explain(e));});return()=>{alive.current=false;};},[]);
  const inFlight=Boolean(snapshot?.status.checking||snapshot?.status.downloading||snapshot?.status.installing);
  useEffect(()=>{if(!inFlight)return;const id=window.setInterval(()=>{void api.updateStatus().then(value=>{if(alive.current)setSnapshot(value);}).catch(e=>{if(alive.current)setError(explain(e));});},750);return()=>window.clearInterval(id);},[inFlight]);
  const view=presentUpdateCheck({channel:snapshot?.channel??'unsupported',status:snapshot?.status??emptyStatus().status,currentVersion:currentVersion??snapshot?.currentVersion,checked:snapshot?.checked});
  async function check(){setBusy(true);setError('');try{const result=await api.checkForUpdates();if(alive.current)setSnapshot(result);}catch(e){if(alive.current)setError(explain(e));}finally{if(alive.current)setBusy(false);}}
  async function install(){setBusy(true);setError('');try{const result=await api.installUpdate();if(alive.current)setSnapshot(result);}catch(e){if(alive.current)setError(explain(e));}finally{if(alive.current)setBusy(false);}}
  return <div className="settings-row update-check"><div><strong>软件更新</strong>{view.statusText&&<p className="settings-description" role="status" data-update-tone={view.tone}>{view.statusText}{view.showReleasesLink&&<> <a href={view.releasesUrl??KTEAM_RELEASES_URL} onClick={event=>{event.preventDefault();void api.openKTeamReleases().catch(e=>setError(explain(e)));}}>{view.releasesUrl??KTEAM_RELEASES_URL}</a></>}</p>}{error&&<p className="settings-error" role="alert">{error}</p>}</div><div className="update-check-actions"><button type="button" className="secondary" aria-label="检查更新" disabled={view.buttonDisabled} onClick={()=>void check()}>{(view.tone==='checking'||busy)&&!view.showReleasesLink?<LoaderCircle size={14} className="spinner"/>:<RefreshCw size={14}/>}检查更新</button>{view.showInstallButton&&<button type="button" className="primary" disabled={busy} onClick={()=>void install()}>{view.installLabel}</button>}</div></div>;
}
