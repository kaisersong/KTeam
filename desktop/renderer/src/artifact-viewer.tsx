import {useEffect,useMemo,useRef,useState} from 'react';
import {X,ExternalLink,Monitor,Maximize2,Minimize2} from 'lucide-react';
import {api,explain} from './api';
import {Markdown} from './Markdown';
import {ArtifactReviewPanel} from './artifact-review';
type Identity={roomId:string;toolCallId:string};
type OpenIdentity=Identity & {review?:boolean};
type Preview=Awaited<ReturnType<typeof api.previewGeneratedFile>>;
const eventName='kteam:preview-generated-file';
/** Callers pass receipt identity only. Content is resolved and verified by the host. */
export async function showGeneratedFile(identity:OpenIdentity){window.dispatchEvent(new CustomEvent(eventName,{detail:identity}));}
export function htmlPreview(content:string){
 const doc=new DOMParser().parseFromString(content,'text/html');
 doc.querySelectorAll('script,iframe,frame,object,embed,base,form,meta[http-equiv],link').forEach(node=>node.remove());
 doc.querySelectorAll('a').forEach(node=>node.removeAttribute('href'));
 const policy=doc.createElement('meta');policy.httpEquiv='Content-Security-Policy';policy.content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; form-action 'none'; base-uri 'none'";doc.head.prepend(policy);
 // Reports commonly hide content until an animation script runs. Keep it visible in a static preview.
 doc.body.classList.add('no-animations');const style=doc.createElement('style');style.textContent='.fade-in-up,.stagger-ready,.stagger-ready>*{opacity:1!important;transform:none!important;animation:none!important}';doc.head.append(style);
 return '<!doctype html>'+doc.documentElement.outerHTML;
}
export function ArtifactViewer(){
 const [identity,setIdentity]=useState<Identity>(),[data,setData]=useState<Preview>(),[error,setError]=useState(''),[busy,setBusy]=useState(false),[fullscreen,setFullscreen]=useState(false),[review,setReview]=useState(false),[attempt,setAttempt]=useState(0),closeButton=useRef<HTMLButtonElement>(null);
 useEffect(()=>{const open=(event:Event)=>{const value=(event as CustomEvent<OpenIdentity>).detail;if(typeof value?.roomId==='string'&&typeof value?.toolCallId==='string'){setIdentity({roomId:value.roomId,toolCallId:value.toolCallId});setFullscreen(false);setReview(value.review===true);}};window.addEventListener(eventName,open);return()=>window.removeEventListener(eventName,open);},[]);
 useEffect(()=>{if(!identity)return;let live=true;setData(undefined);setError('');void api.previewGeneratedFile(identity).then(value=>{if(live)setData(value);}).catch(e=>{if(live)setError(explain(e));});return()=>{live=false;};},[identity,attempt]);
 useEffect(()=>{if(!identity)return;const previous=document.activeElement as HTMLElement|null;closeButton.current?.focus();const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();setIdentity(undefined);}if(event.key==='Tab'){const buttons=closeButton.current?.closest('[role="dialog"]')?.querySelectorAll<HTMLElement>('button:not(:disabled),textarea:not(:disabled),iframe,[tabindex="0"]');if(!buttons?.length)return;const first=buttons[0],last=buttons[buttons.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}};window.addEventListener('keydown',key,true);return()=>{window.removeEventListener('keydown',key,true);previous?.focus();};},[identity]);
 const html=useMemo(()=>data?.kind==='html'?htmlPreview(data.content):'', [data]);
 if(!identity)return null;
 const external=async(target:'browser'|'system')=>{setBusy(true);setError('');try{await api.openGeneratedFile({...identity,target});}catch(e){setError(explain(e));}finally{setBusy(false);}};
 return <div className="artifact-viewer-backdrop"><section className={'artifact-viewer'+(fullscreen?' is-fullscreen':'')} role="dialog" aria-modal="true" aria-label="产物查看器"><header><strong>{data?.name??'产物查看器'}</strong><div>{data&&['markdown','text'].includes(data.kind)&&<button className="secondary" aria-pressed={review} onClick={()=>setReview(value=>!value)}>{review?'返回预览':'审阅产物'}</button>}<button className="secondary" disabled={busy||!data} onClick={()=>void external('browser')}><ExternalLink size={15}/>浏览器打开</button><button className="secondary" disabled={busy||!data} onClick={()=>void external('system')}><Monitor size={15}/>系统默认打开</button><button className="icon-button" aria-label={fullscreen?'退出全屏':'全屏查看'} onClick={()=>setFullscreen(value=>!value)}>{fullscreen?<Minimize2 size={17}/>:<Maximize2 size={17}/>}</button><button ref={closeButton} className="icon-button" aria-label="关闭产物查看器" onClick={()=>setIdentity(undefined)}><X size={19}/></button></div></header>{error&&!review&&<p role="alert" className="flow-error">{error}<button className="text-button" onClick={()=>setAttempt(value=>value+1)}>重新读取</button></p>}<div className="artifact-viewer-content">{review?<ArtifactReviewPanel key={identity.roomId+':'+identity.toolCallId} {...identity}/>:<>{!data&&!error&&<p role="status">正在读取产物…</p>}{data?.kind==='html'&&<iframe title={data.name} sandbox="" referrerPolicy="no-referrer" srcDoc={html}/ >}{data?.kind==='markdown'&&<div className="artifact-document"><Markdown text={data.content}/></div>}{data?.kind==='text'&&<pre className="artifact-document">{data.content}</pre>}{data?.kind==='image'&&<img className="artifact-image" alt={data.name} src={'data:'+data.mediaType+';base64,'+data.content}/ >}{data?.kind==='unsupported'&&<p className="artifact-document">{data.reason==='preview_too_large'?'文件较大，请使用浏览器或系统默认程序查看。':'此格式暂不支持应用内预览，请使用“系统默认打开”。'}</p>}</>}</div>{data&&<footer>{(data.bytes/1024).toFixed(1)} KiB{data.kind==='html'?' · 静态预览；交互脚本和外部资源请在浏览器中查看':''}</footer>}</section></div>;
}
