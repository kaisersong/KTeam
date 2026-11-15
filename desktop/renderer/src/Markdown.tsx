import {FileText} from 'lucide-react';
import {memo,useState,type ReactNode} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {webLinkUrl} from '../../../src/protocol/web-link';
import {showGeneratedFile} from './artifact-viewer';
import {api,explain} from './api';
// Markdown HTML stays disabled; web links open only after an explicit user click.
const plugins=[remarkGfm];
function WebLink({href,children}:{href?:string;children:ReactNode}){
 const [error,setError]=useState(''),url=webLinkUrl(href);
 if(!url)return <span className="source-link">{children}</span>;
 const open=()=>{setError('');void api.openWebLink({url}).catch(error=>setError(explain(error)));};
 return <><a href={url} title={url} rel="noopener noreferrer" onClick={event=>{event.preventDefault();event.stopPropagation();open();}} onAuxClick={event=>{if(event.button===1){event.preventDefault();event.stopPropagation();open();}}}>{children}</a>{error&&<small className="flow-error" role="alert">{error}</small>}</>;
}
export type MessageFile={id:string;file:{name:string;roomId:string}};
/** A link can select a receipt, never grant access to the model-authored path. */
export function receiptForLink(href:string|undefined,files:MessageFile[]){
 if(!href||/^(?!file:)[a-z][a-z0-9+.-]*:/i.test(href)||href.startsWith('//'))return;
 let path:string;try{path=decodeURIComponent(href.startsWith('file:')?new URL(href).pathname:href);}catch{return;}
 if(/[?#\\\x00]/.test(path))return;
 const name=path.split('/').at(-1),matches=files.filter(value=>value.file.name===name);
 return matches.length===1?matches[0]:undefined;
}
export const Markdown=memo(function Markdown({text,files=[]}:{text:string;files?:MessageFile[]}){
 return <ReactMarkdown remarkPlugins={plugins} skipHtml urlTransform={url=>webLinkUrl(url)??(receiptForLink(url,files)?url:'')} components={{
  img:({alt})=><span className="muted">[图片：{alt??'未加载'}]</span>,
  a:({children,href})=>{const receipt=receiptForLink(href,files);return receipt?<a className="message-file-link" href="#" title={'在 KTeam 中查看 '+receipt.file.name} onClick={event=>{event.preventDefault();event.stopPropagation();void showGeneratedFile({roomId:receipt.file.roomId,toolCallId:receipt.id});}}><FileText size={14} strokeWidth={1.6} aria-hidden="true"/>{children}</a>:<WebLink href={href}>{children}</WebLink>;},
 }}>{text}</ReactMarkdown>;
});
