import {useEffect,useMemo,useRef,useState} from 'react';
import {X,ExternalLink,Monitor,Maximize2,Minimize2,Download} from 'lucide-react';
import {api,explain} from './api';
import {Markdown} from './Markdown';
import {ArtifactReviewPanel} from './artifact-review';
type GeneratedIdentity={roomId:string;toolCallId:string;review?:boolean};
type AttachmentIdentity={roomId:string;messageId:string;fileId:string;name:string;extension:string};
type Identity=GeneratedIdentity|AttachmentIdentity;
type Preview=Awaited<ReturnType<typeof api.previewGeneratedFile>> & {truncated?:boolean};
const eventName='kteam:preview-generated-file';
/** Callers pass receipt identity only. Content is resolved and verified by the host. */
export async function showGeneratedFile(identity:GeneratedIdentity){window.dispatchEvent(new CustomEvent(eventName,{detail:identity}));}
export function showMessageAttachment(identity:AttachmentIdentity){window.dispatchEvent(new CustomEvent(eventName,{detail:identity}));}
export function htmlPreview(content:string){
 const doc=new DOMParser().parseFromString(content,'text/html');
 doc.querySelectorAll('script,iframe,frame,object,embed,base,form,meta[http-equiv],link').forEach(node=>node.remove());
 doc.querySelectorAll('a').forEach(node=>node.removeAttribute('href'));
 const policy=doc.createElement('meta');policy.httpEquiv='Content-Security-Policy';policy.content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; form-action 'none'; base-uri 'none'";doc.head.prepend(policy);
 // Reports commonly hide content until an animation script runs. Keep it visible in a static preview.
 doc.body.classList.add('no-animations');const style=doc.createElement('style');style.textContent='.fade-in-up,.stagger-ready,.stagger-ready>*{opacity:1!important;transform:none!important;animation:none!important}';doc.head.append(style);
 return '<!doctype html>'+doc.documentElement.outerHTML;
}
async function readPreview(identity:Identity):Promise<Preview>{
 if('toolCallId' in identity)return api.previewGeneratedFile({roomId:identity.roomId,toolCallId:identity.toolCallId});
 const {roomId,messageId,fileId}=identity;
 const value=await api.previewMessageAttachment({roomId,messageId,fileId,variant:'full'});
 const kind=value.image?'image':value.preview===null?'unsupported':identity.extension==='md'?'markdown':identity.extension==='html'?'html':'text';
 return {ok:true,kind,name:value.file.name,bytes:value.file.bytes,mediaType:value.image?.mediaType,content:value.image?.base64??value.preview??'',truncated:value.truncated};
}
export function ArtifactViewer({roomId}:{roomId?:string}){
 const [selection,setIdentity]=useState<Identity>(),[preview,setPreview]=useState<{source:Identity;data:Preview}>(),[error,setError]=useState(''),[busy,setBusy]=useState(false),[expanded,setExpanded]=useState(false),[review,setReview]=useState(false),[attempt,setAttempt]=useState(0);
 const [save,setSave]=useState<{source:Identity;pending?:boolean;error?:string}>();
 const identity=selection?.roomId===roomId?selection:undefined;
 const closeButton=useRef<HTMLButtonElement>(null),trigger=useRef<HTMLElement|null>(null);
 useEffect(()=>{const open=(event:Event)=>{
  const value=(event as CustomEvent<Identity>).detail;
  if(typeof value?.roomId!=='string'||(!('toolCallId' in value)&&!('fileId' in value)))return;
  trigger.current=document.activeElement as HTMLElement|null;
  setIdentity(value);setError('');setReview('toolCallId' in value&&value.review===true);
 };window.addEventListener(eventName,open);return()=>window.removeEventListener(eventName,open);},[]);
 useEffect(()=>{setIdentity(value=>value?.roomId===roomId?value:undefined);setExpanded(false);},[roomId]);
 useEffect(()=>{if(!identity)return;let live=true;void readPreview(identity).then(data=>{if(live)setPreview({source:identity,data});}).catch(e=>{if(live)setError(explain(e));});return()=>{live=false;};},[identity,attempt]);
 useEffect(()=>{if(identity)closeButton.current?.focus();},[identity]);
 const data=preview?.source===identity?preview?.data:undefined;
 const html=useMemo(()=>data?.kind==='html'?htmlPreview(data.content):'', [data]);
 if(!identity)return null;
 const close=()=>{setIdentity(undefined);setExpanded(false);if(trigger.current?.isConnected)trigger.current.focus();};
 const generated='toolCallId' in identity?identity:undefined;
 const download=async()=>{
  setSave({source:identity,pending:true});
  const {roomId}=identity;
  const source='toolCallId' in identity?{roomId,toolCallId:identity.toolCallId}:{roomId,messageId:identity.messageId,fileId:identity.fileId};
  try{
   const result=await api.downloadArtifact(source);
   setSave(result.cancelled?undefined:{source:identity});
  }catch(e){setSave({source:identity,error:explain(e)});}
 };
 const external=async(target:'browser'|'system')=>{
  setBusy(true);setError('');
  try{
   if('toolCallId' in identity)await api.openGeneratedFile({roomId:identity.roomId,toolCallId:identity.toolCallId,target});
   else await api.openLibrary({roomId:identity.roomId,fileId:identity.fileId});
  }catch(e){setError(explain(e));}finally{setBusy(false);}
 };
 return <aside className={'artifact-viewer'+(expanded?' is-expanded':'')} aria-label="产物预览"
  onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();close();}}}>
  <header>
   <strong>{data?.name??('name' in identity?identity.name:'产物预览')}</strong>
   <div>
    <button className="secondary" disabled={busy||save?.pending||!data} onClick={()=>void download()}><Download size={16} aria-hidden="true"/>{save?.source===identity&&save.pending?'下载中…':'下载'}</button>
    {generated&&data&&['markdown','text'].includes(data.kind)&&<button className="secondary" aria-pressed={review} onClick={()=>setReview(value=>!value)}>{review?'返回预览':'审阅产物'}</button>}
    {generated&&<button className="icon-button" aria-label="浏览器打开" title="浏览器打开" disabled={busy||!data} onClick={()=>void external('browser')}><ExternalLink size={16}/></button>}
    <button className="icon-button" aria-label="系统默认打开" title="系统默认打开" disabled={busy||!data} onClick={()=>void external('system')}><Monitor size={16}/></button>
    <button className="icon-button" aria-label={expanded?'缩小预览':'展开预览'} onClick={()=>setExpanded(value=>!value)}>{expanded?<Minimize2 size={17}/>:<Maximize2 size={17}/>}</button>
    <button ref={closeButton} className="icon-button" aria-label="关闭产物预览" onClick={close}><X size={19}/></button>
   </div>
  </header>
  {error&&!review&&<p role="alert" className="flow-error">{error}<button className="text-button" onClick={()=>{setError('');setAttempt(value=>value+1);}}>重新读取</button></p>}
  {save?.source===identity&&save.error&&<p role="alert" className="flow-error">{save.error}</p>}
  <div className="artifact-viewer-content">
   {review&&generated?<ArtifactReviewPanel key={generated.roomId+':'+generated.toolCallId} roomId={generated.roomId} toolCallId={generated.toolCallId}/>:<>
    {!data&&!error&&<p className="artifact-document" role="status">正在读取产物…</p>}
    {data?.kind==='html'&&<iframe title={data.name} sandbox="" referrerPolicy="no-referrer" srcDoc={html}/>}
    {data?.kind==='markdown'&&<div className="artifact-document"><Markdown text={data.content}/></div>}
    {data?.kind==='text'&&<pre className="artifact-document">{data.content}</pre>}
    {data?.kind==='image'&&<img className="artifact-image" alt={data.name} src={'data:'+data.mediaType+';base64,'+data.content}/>}
    {data?.kind==='unsupported'&&<p className="artifact-document">{data.reason==='preview_too_large'?'文件较大，请使用系统默认程序查看。':'此格式可使用系统默认程序打开。'}</p>}
   </>}
  </div>
  {data&&<footer>{(data.bytes/1024).toFixed(1)} KiB{data.truncated?' · 预览已截断':''}{data.kind==='html'?' · 静态预览':''}{save?.source===identity&&!save.pending&&!save.error&&<span role="status"> · 已下载</span>}</footer>}
 </aside>;
}
