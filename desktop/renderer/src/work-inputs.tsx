const labels:Record<string,string>={handling:'小K正在理解这条消息…',preparing:'消息已收到，正在核对。',waiting_boundary:'补充已收到，小K会接着处理。',staged:'补充已收到，小K会接着处理。',injected:'小K已收到这条补充。',completed:'这条补充已处理。',queued:'消息已收到，小K会接着处理。',needs_review:'这条消息需要先核对当前工作。'};
/** Progress only. Message disposition is chosen by the assistant, never by a composer mode. */
export function WorkInputControls({receipts,onSource}:{receipts:any[];onSource:(id:string)=>void}){
 if(!receipts.length)return null;
 return <section className="work-input-controls" aria-label="消息处理进展"><details className="work-input-receipts"><summary>消息处理进展</summary><ol>{receipts.slice(0,5).map(item=><li key={item.id}><span>{item.status==='queued'&&!item.independentAt&&['unknown','blocked','stopped','waiting','held'].includes(item.previousWorkState)?'当前工作需要先核对，这条消息已保留。':labels[item.status]??'消息已收到，小K会继续核对。'}</span>{item.messageId&&<button type="button" className="text-button" onClick={()=>onSource(item.messageId)}>查看消息</button>}</li>)}</ol></details></section>;
}
