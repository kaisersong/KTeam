import {useState,type ReactNode} from 'react';
import {Check,Trash2,Mail,CheckCheck} from 'lucide-react';
import type {InboxAction,InboxReceipt} from '../../../src/protocol/inbox';
import {explain} from './api';
export type ChangeInbox=(action:InboxAction,items:InboxReceipt[],collection?:'needs'|'attention')=>Promise<void>;
export function InboxEntry({item,children,onChange,collection='needs'}:{item:any;children:ReactNode;onChange:ChangeInbox;collection?:'needs'|'attention'}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),receipt=item.inbox as InboxReceipt|undefined;
 const change=async(action:InboxAction)=>{if(!receipt||busy)return;setBusy(true);setError('');try{await onChange(action,[receipt],collection);}catch(e){setError(explain(e));}finally{setBusy(false);}};
 return <article className={'inbox-entry'+(receipt?.read?' is-read':' is-unread')} aria-label="收件箱记录"><header><span className="inbox-read-state">{receipt?.read?<Check size={13}/>:<span className="inbox-unread-dot"/>}{receipt?.read?'已读':'未读'}</span><div><button type="button" className="text-button" disabled={busy||!receipt} onClick={()=>void change(receipt?.read?'unread':'read')}>{receipt?.read?<Mail size={14}/>:<Check size={14}/>}标为{receipt?.read?'未读':'已读'}</button><button type="button" className="icon-button" disabled={busy||!receipt} aria-label="删除通知" title="从收件箱删除，原记录保留" onClick={()=>void change('delete')}><Trash2 size={15}/></button></div></header>{children}{error&&<p className="flow-error" role="alert">{error}</p>}</article>;
}
export function InboxToolbar({items,onChange,collection='needs'}:{items:any[];onChange:ChangeInbox;collection?:'needs'|'attention'}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');const unread=items.filter(item=>item.inbox&&!item.inbox.read),approvals=items.filter(item=>item.inbox?.kind==='approval'&&item.status==='pending'&&item.expiresAt>Date.now()).reduce((n,item)=>n+(item.pendingOperationCount??1),0);
 const active=items.filter(item=>item.state==='unknown'||item.needsReview).length;
 return <div className="inbox-toolbar"><span role="status">{approvals} 项待审批 · {active} 项待核对 · {unread.length?unread.length+' 条未读':'全部已读'}</span><button type="button" className="text-button" disabled={!unread.length||busy} onClick={()=>{setBusy(true);setError('');void onChange('read',unread.slice(0,500).map(item=>item.inbox),collection).catch(e=>setError(explain(e))).finally(()=>setBusy(false));}}><CheckCheck size={16}/>{busy?'正在标记…':'全部标为已读'}</button>{error&&<p className="flow-error" role="alert">{error}</p>}</div>;
}
