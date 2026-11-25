import {visibleInputReceipts} from './receipt-visibility';
const ended=new Set(['unknown','blocked','stopped']);
const waiting=new Set(['waiting','held']);
const labels:Record<string,string>={handling:'小K正在理解这条消息…',preparing:'消息已收到，正在核对。',waiting_boundary:'补充已收到，小K会接着处理。',staged:'补充已收到，小K会接着处理。',injected:'小K已收到这条补充。',completed:'这条补充已处理。',queued:'消息已收到，小K会接着处理。',needs_review:'这条消息需要先核对当前工作。'};
function receiptText(item:any){
 if(item.status==='queued'&&!item.independentAt){
  if(ended.has(item.previousWorkState))return '前一项工作已中断，这条消息已保留，等待前一项接续。';
  if(waiting.has(item.previousWorkState))return '这条消息已保留，等待前一项工作继续处理。';
 }
 return labels[item.status]??'消息已收到，小K会继续核对。';
}
export function WorkInputReceipts({receipts,onSource}:{receipts:any[];onSource:(id:string)=>void}){
 const visible=visibleInputReceipts(receipts);
 if(!visible.length)return null;
 return <section className="workspace-section work-input-receipts" aria-label="消息处理进展">
  <h3>消息处理进展</h3>
  <ol>{visible.slice(0,5).map(item=><li key={item.id}>
   <span>{receiptText(item)}</span>
   {item.messageId&&<button type="button" className="text-button" onClick={()=>onSource(item.messageId)}>查看消息</button>}
  </li>)}</ol>
 </section>;
}
