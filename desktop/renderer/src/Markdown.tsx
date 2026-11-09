import {memo} from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
// Same markdown stack as xiaok. No HTML, file opener, network images or
// tool authority is inferred from untrusted message text.
const plugins=[remarkGfm];
export const Markdown=memo(function Markdown({text}:{text:string}){
 return <ReactMarkdown remarkPlugins={plugins} skipHtml components={{
  img:({alt})=><span className="muted">[图片：{alt??'未加载'}]</span>,
  a:({children,href})=><span className="source-link">{children}{href&&!(typeof children==='string'&&/^(?:https?:\/\/|www\.)/.test(children))&&<small>（{href}）</small>}</span>,
 }}>{text}</ReactMarkdown>;
});
