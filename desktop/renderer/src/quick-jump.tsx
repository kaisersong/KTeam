import {useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import {ArrowRight,Search} from 'lucide-react';
import {Modal} from './components';
import {api,type Room} from './api';
import {attentionDeadline} from '../../../src/protocol/attention-order';

export interface JumpTarget {
  key: string;
  roomId: string;
  title: string;
  subtitle: string;
  searchable?: string;
  jobId?: string;
  toolCallId?: string;
  attention?: {id:string; expiresAt?:string; inbox?:{read?:boolean}};
}

export function QuickJump({targets,currentRoom,loading,onClose,onOpen}:{
  targets:JumpTarget[];
  currentRoom?:Room;
  loading:boolean;
  onClose:()=>void;
  onOpen:(target:JumpTarget)=>void;
}){
  const [query,setQuery]=useState('');
  const [selected,setSelected]=useState<string>();
  const [files,setFiles]=useState<{roomId:string; items:JumpTarget[]}>();
  const roomId=currentRoom?.roomId;
  const roomTitle=currentRoom?.title;
  useEffect(()=>{
    if(!roomId)return;
    let live=true;
    void api.generatedFiles({roomId}).then(result=>{
      if(!live)return;
      setFiles({roomId,items:result.items.map((file:{name:string;toolCallId:string})=>({
        key:'artifact:'+file.toolCallId,roomId,toolCallId:file.toolCallId,title:file.name,subtitle:roomTitle??'',
      }))});
    }).catch(()=>{});
    return()=>{live=false;};
  },[roomId,roomTitle]);
  const input=useRef<HTMLInputElement>(null);
  const list=useRef<HTMLDivElement>(null);
  const id=useId();
  const terms=query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const candidates=terms.length&&files&&files.roomId===roomId?[...targets,...files.items]:targets;
  const matches=candidates.filter(target=>{
    const text=[target.title,target.subtitle,target.searchable].join(' ').toLocaleLowerCase();
    return terms.every(term=>text.includes(term));
  });
  const needs=matches.filter(target=>target.attention)
    .sort((a,b)=>attentionDeadline(a.attention?.expiresAt)-attentionDeadline(b.attention?.expiresAt))
    .slice(0,terms.length?30:6);
  const rooms=matches.filter(target=>!target.attention&&!target.jobId&&!target.toolCallId).slice(0,terms.length?30:6);
  const work=terms.length?matches.filter(target=>target.jobId).slice(0,30):[];
  const artifacts=matches.filter(target=>target.toolCallId).slice(0,20);
  const rows=[...needs,...rooms,...work,...artifacts];
  const index=selected===undefined?0:rows.findIndex(row=>row.key===selected);
  const active=rows[index];

  useEffect(()=>{input.current?.focus();},[]);
  useLayoutEffect(()=>{
    if(selected===undefined&&rows[0])setSelected(rows[0].key);
  },[selected,rows[0]?.key]);
  useEffect(()=>{
    if(active)list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({block:'nearest'});
  },[active?.key]);

  return <Modal title="快速跳转" onClose={onClose} className="quick-jump">
    <div className="jump-search"><Search size={18}/><input ref={input} role="combobox"
      aria-label="搜索会话和待办" aria-autocomplete="list" aria-expanded="true" aria-controls={id}
      aria-activedescendant={active?id+'-'+index:undefined} value={query}
      placeholder="搜索会话、成员或事项"
      onChange={event=>{setQuery(event.target.value);setSelected(undefined);}}
      onKeyDown={event=>{
        if(event.nativeEvent.isComposing||event.keyCode===229)return;
        if(event.key==='Enter'&&active){event.preventDefault();onOpen(active);}
        if(event.key==='ArrowDown'||event.key==='ArrowUp'){
          event.preventDefault();
          if(!rows.length)return;
          const next=index<0?(event.key==='ArrowUp'?rows.length-1:0):
            (index+(event.key==='ArrowDown'?1:-1)+rows.length)%rows.length;
          setSelected(rows[next].key);
        }
      }}/></div>
    <div className="jump-results" id={id} role="listbox" aria-label="跳转目标" ref={list}>
      {[
        {items:needs,label:'需要我处理',offset:0},
        {items:rooms,label:terms.length?'会话':'最近会话',offset:needs.length},
        {items:work,label:'需要核对的工作',offset:needs.length+rooms.length},
        {items:artifacts,label:'当前会话的产物',offset:needs.length+rooms.length+work.length},
      ].map(({items,label,offset})=>items.length>0&&<div key={label} role="group" aria-label={label}>
          <h3>{label}</h3>
          {items.map((target,i)=><div id={id+'-'+(offset+i)} key={target.key}
            role="option" aria-selected={target.key===active?.key} className="jump-row"
            onMouseDown={event=>event.preventDefault()} onMouseMove={()=>setSelected(target.key)} onClick={()=>onOpen(target)}>
            <span><strong>{target.title}</strong><small>{target.subtitle}</small></span><ArrowRight size={16}/>
          </div>)}
        </div>)}
      {!rows.length&&<p role="status" className="form-note">{loading?'正在读取待办…':query?'没有匹配项': '暂无可跳转的事项'}</p>}
    </div>
  </Modal>;
}
