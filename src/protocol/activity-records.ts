// Read-only presentation of the existing queue, never another task or event owner.
export interface ActivityEvent {
 id:string; name:string; type?:string; state:string; observedState?:string; botId?:string;
 input?:string; result?:string; code?:string; startedAt?:string; finishedAt?:string;
 previewTruncated:boolean;
}
export interface ActivityRecord {
 id:string; state:string; reason?:string; createdAt?:string; originId?:string; sourceLabel?:string;
 resultMessageIds:string[]; botIds:string[]; events:ActivityEvent[]; eventsLimited:boolean;
 calls:number;
}
const text=(value:unknown,max=256)=>typeof value==='string'?value.slice(0,max):undefined;
function preview(value:unknown,max:number):{value?:string;truncated:boolean}{
 if(value===undefined||value===null)return {truncated:false};
 let source:string;
 try{source=typeof value==='string'?value:JSON.stringify(value)??'';}catch{return {value:'（记录无法显示）',truncated:true};}
 return {value:source.slice(0,max),truncated:source.length>max};
}
export function activityRecords(jobs:unknown[],roomId:string):ActivityRecord[]{
 return jobs.filter((job:any)=>job&&job.roomId===roomId&&typeof job.id==='string').slice(0,100).map((job:any)=>{
  const all:any[]=Array.isArray(job.toolTrace)?job.toolTrace:[];
  const events:ActivityEvent[]=all.slice(-100).filter((event:any)=>event&&typeof event==='object').map((event:any,index:number):ActivityEvent=>{
   const input=preview(event.input,8192),result=preview(event.result,2000);
   return {id:text(event.id)??'record-'+index,name:text(event.name)??text(event.type)??'未命名事件',
    type:text(event.type),state:job.handoffPauseEventIds?.includes(event.id)?'waiting':text(event.state)??'unreported',observedState:job.handoffPauseEventIds?.includes(event.id)?text(event.state):undefined,botId:text(event.botId),
    input:input.value,result:result.value,code:text(event.code),startedAt:text(event.startedAt),finishedAt:text(event.finishedAt),
    previewTruncated:input.truncated||result.truncated};
  });
  return {id:job.id,state:job.needsReview?'needs_review':text(job.state)??'unknown',reason:text(job.reason),createdAt:text(job.createdAt),originId:job.trigger==='routine'?undefined:text(job.originId),sourceLabel:job.trigger==='routine'?'例行任务：'+(text(job.routine?.name)??'已安排的工作'):undefined,
   resultMessageIds:[...new Set<string>((Array.isArray(job.results)?job.results:[]).map((result:any)=>text(result?.messageId)).filter((id:unknown):id is string=>typeof id==='string'))].slice(0,128),
   botIds:[...new Set<string>([...(Array.isArray(job.members)?job.members:[]),job.activeBotId,...events.map(event=>event.botId)].filter((id:unknown):id is string=>typeof id==='string'))].slice(0,128),
   events,eventsLimited:job.toolTraceLimited===true||all.length>=100,calls:Number.isSafeInteger(job.calls)&&job.calls>=0?job.calls:0};
 });
}
export const activityStateLabels:Record<string,string>={queued:'等待执行',routing:'正在选择成员',running:'正在执行',stopping:'正在停止',waiting:'等待结果',needs_review:'交付中有未完成项，需核对',delivered:'已提交答复',blocked:'需要处理',unknown:'结果待核对',stopped:'已停止',noop:'检查已结束',held:'会话已暂停',cancelled:'已取消'};
export const eventStateLabels:Record<string,string>={waiting:'已保存，等待结果',running:'执行中',completed:'已返回',failed:'失败',unreported:'未报告状态'};
const toolLabels:Record<string,string>={read:'查阅资料',glob:'定位文件',grep:'检索资料',bash:'执行命令',web_fetch:'读取网页',web_search:'检索公开来源',contact_bot:'联络成员',delegate_work:'交接子工作',wait_for_condition:'等待工作条件',ask_user:'向你提问',read_material:'读取会话资料',update_shared_context:'更新共享纪要',skill:'使用技能',skillFetchAssets:'读取技能资源',tool_search:'查找可用工具',render_ui:'生成交互内容',render_report:'生成报告',render_slide:'生成演示文稿',schedule_follow_up:'安排跟进',model_request_started:'请求模型'};
export function activityEventLabel(event:ActivityEvent){if(event.type==='run_aborted')return event.state==='waiting'?'保存原工作':'运行已中止';return toolLabels[event.name]??toolLabels[event.type??'']??event.name;}

/** The wrapped calls are the tool facts. Keep lifecycle/usage telemetry in Events/Raw. */
export function readableActivityEvents(record:ActivityRecord):ActivityEvent[]{
 const wrapped=record.events.filter(event=>!event.type),tools=wrapped.length?wrapped:record.events.filter(event=>['tool_started','tool_finished','tool_failed'].includes(event.type??''));
 const selected=new Set([...tools,...record.events.filter(event=>event.type==='run_aborted'&&event.state==='waiting')]);return record.events.filter(event=>selected.has(event));
}
