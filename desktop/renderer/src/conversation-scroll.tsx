import React,{useLayoutEffect,useRef,useState,type RefObject,type ReactNode} from 'react';
import {ArrowDown} from 'lucide-react';

export function ConversationScroll({scrollRef,children,hasOlder,hasNewer,loadingOlder,onOlder,onLatest,onPosition,historyKey}:{scrollRef:RefObject<HTMLDivElement|null>;children:ReactNode;hasOlder:boolean;hasNewer:boolean;loadingOlder:boolean;onOlder:()=>Promise<void>;onLatest:()=>Promise<void>;onPosition:(atBottom:boolean)=>void;historyKey?:string}){
 const [away,setAway]=useState(false),[jumping,setJumping]=useState(false);
 const loading=useRef(false),attempt=useRef<string|undefined>(undefined);
 const measure=()=>{const box=scrollRef.current;if(box)setAway(box.scrollHeight-box.clientHeight-box.scrollTop>2);};
 useLayoutEffect(()=>{const box=scrollRef.current;if(!box)return;measure();const observer=new ResizeObserver(measure);observer.observe(box);if(box.firstElementChild)observer.observe(box.firstElementChild);return()=>observer.disconnect();},[scrollRef]);
 useLayoutEffect(measure,[children,hasNewer]);
 const older=()=>{if(!hasOlder||loadingOlder||loading.current||attempt.current===historyKey)return;attempt.current=historyKey;loading.current=true;void onOlder().finally(()=>{loading.current=false;});};
 return <div className="message-viewport"><div className="message-scroll" ref={scrollRef} onScroll={()=>{const box=scrollRef.current!;measure();onPosition(box.scrollHeight-box.clientHeight-box.scrollTop<=2);if(box.scrollTop>24)attempt.current=undefined;else older();}} onWheel={event=>{if(event.deltaY<0&&(scrollRef.current?.scrollTop??Infinity)<=24){attempt.current=undefined;older();}}}>
  <div className="message-column">{hasOlder&&<div className="load-older" role="status">{loadingOlder?'正在加载更早的消息…':'向上滚动查看更早的消息'}</div>}{children}</div>
 </div>{(away||hasNewer)&&<button type="button" className="jump-to-latest" aria-label="回到最新消息" title="回到最新消息" disabled={jumping} onClick={()=>{if(jumping)return;setJumping(true);void onLatest().finally(()=>{setJumping(false);measure();});}}><ArrowDown size={22}/></button>}</div>;
}
