import {memo,useState,type ReactNode} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {webLinkUrl} from '../../../src/protocol/web-link';
import {api,explain} from './api';
// Markdown HTML stays disabled; web links open only after an explicit user click.
const plugins=[remarkGfm];
function WebLink({href,children}:{href?:string;children:ReactNode}){
 const [error,setError]=useState(''),url=webLinkUrl(href);
 if(!url)return <span className="source-link">{children}</span>;
 const open=()=>{setError('');void api.openWebLink({url}).catch(error=>setError(explain(error)));};
 return <><a href={url} title={url} rel="noopener noreferrer" onClick={event=>{event.preventDefault();event.stopPropagation();open();}} onAuxClick={event=>{if(event.button===1){event.preventDefault();event.stopPropagation();open();}}}>{children}</a>{error&&<small className="flow-error" role="alert">{error}</small>}</>;
}
export const Markdown=memo(function Markdown({text}:{text:string}){
 return <ReactMarkdown remarkPlugins={plugins} skipHtml components={{
  img:({alt})=><span className="muted">[图片：{alt??'未加载'}]</span>,
  a:({children,href})=><WebLink href={href}>{children}</WebLink>,
 }}>{text}</ReactMarkdown>;
});
