import {unexecutedModelToolOutput} from '../../../src/protocol/model-tool-output';
import {showGeneratedFile} from './artifact-viewer';
import {toolApprovalSummary} from '../../../src/protocol/tool-approval-summary';
import {A2uiArtifactRenderer} from '../../core-ui/renderer/src/components/a2ui/A2uiArtifactRenderer';
import {Markdown} from './Markdown';
import React,{useRef,useState}from'react';
import{Terminal,Check,ShieldCheck,X,FileText}from'lucide-react';
import{api,explain,type Bot}from'./api';
type ApprovalDecision='allow_once'|'allow_always'|'allow_directory'|'allow_directory_routine'|'deny';
export function ToolApprovalCard({approval,bot,onDecide}:{approval:any;bot?:Bot;onDecide:(decision:ApprovalDecision,applyToGroup?:boolean)=>Promise<void>}){
 const [applyToGroup,setApplyToGroup]=useState(true);
 const [busy,setBusy]=useState<ApprovalDecision>();
 const [settled,setSettled]=useState<"allowed"|"denied">();
 const deciding=useRef(false);
 const [error,setError]=useState('');
 const [grants,setGrants]=useState<any[]>();
 const splitRequired=approval.inspectionRequired===true;
 const directoryDecision=approval.directoryOperations==='routine'?'allow_directory_routine':'allow_directory';
 const directories:string[]=approval.directories?.length?approval.directories:approval.directory?[approval.directory]:[];
 const groupScope=!splitRequired&&directories.length?approval.directoryGroupScope:undefined;
 const description=toolApprovalSummary(approval.toolName,approval.display);
 const facts=approval.operationFacts??[];
 const affected=facts.filter((fact:any)=>fact.kind==='delete'||fact.kind==='unknown'||fact.kind==='overwrite');
 const relevant=affected.filter((fact:any,index:number)=>affected.findIndex((other:any)=>other.target===fact.target&&other.kind===fact.kind)===index);

 async function decide(decision:ApprovalDecision){
  if(deciding.current)return;
  deciding.current=true;setBusy(decision);setError('');
  try{await onDecide(decision,groupScope&&decision===directoryDecision?applyToGroup:undefined);setSettled(decision==='deny'?'denied':'allowed');}
  catch(e){setError(explain(e));}
  finally{deciding.current=false;setBusy(undefined);}
 }
 async function toggleGrants(){
  if(grants){setGrants(undefined);return;}
  setError('');
  try{setGrants((await api.toolPermissions()).permissions.filter((grant:any)=>grant.botId===approval.botId));}
  catch(e){setError(explain(e));}
 }
 async function revokeGrant(id:string){
  try{await api.revokeToolPermission({id});setGrants(current=>current?.filter(grant=>grant.id!==id));}
  catch(e){setError(explain(e));}
 }

 if(settled)return <ApprovalReceiptNotice approval={{...approval,status:settled}} bot={bot}/>;
 return <section className="tool-approval approval-card" data-notification-target={approval.id} tabIndex={-1} aria-label="工具调用确认">
  <h3><ShieldCheck size={18}/>{bot?.name.replace(/ · KTeam .+$/,'')??'成员'} 需要你确认</h3>
  <p>{description.summary}{description.target&&<> · <code>{description.target}</code></>}</p>
  {splitRequired?<p className="approval-warning" role="alert">检查与删除混在同一条命令。请拒绝这次申请，让成员先单独检查，再提交修改。</p>:
   approval.reason&&<p className="approval-reason">{approval.reason}</p>}
  {approval.terminalTrigger&&<p className="approval-trigger"><span>触发确认的命令段</span><code>{approval.terminalTrigger}</code></p>}
  {relevant.length>0&&<ul className="approval-targets" aria-label="修改目标">{relevant.map((fact:any)=><li key={fact.kind+':'+fact.target}><span>{fact.kind==='delete'?'删除或清空':fact.kind==='overwrite'?'写入或覆盖':'目标待核对'}</span><code>{fact.target}</code></li>)}</ul>}
  {directories.length>0&&!splitRequired&&<div className="approval-scope">
   <ul aria-label="授权目录">{directories.map(path=><li key={path}><code>{path}</code></li>)}</ul>
   {groupScope&&<label className="approval-group"><input type="checkbox" checked={applyToGroup} disabled={!!busy} onChange={e=>setApplyToGroup(e.target.checked)}/>给当前群所有 Bot 授权（{groupScope.members.length} 位）</label>}
   <small>{approval.directoryOperations==='routine'?'覆盖所列目录及子目录的常规读写、Git 和本地命令。删除、推送及敏感操作需单独确认。':'长期允许所列目录及子目录的普通文件读写。'}{groupScope&&' 新成员需另行授权。'}</small>
   {approval.pendingOperationCount>1&&<small>还有 {approval.pendingOperationCount-1} 项待处理操作。</small>}
  </div>}
  {!directories.length&&approval.canAlways&&!splitRequired&&<small>{approval.commandScoped?'长期允许此成员在当前目录执行这条完整命令。':approval.toolName==='bash'?'长期允许此成员在该目录下执行常规命令。':'长期允许此成员在该目录下执行同类操作。'}</small>}
  <details className="operation-details approval-details">
   <summary>完整命令与技术详情</summary>
   <div className="approval-details-body">
    <pre tabIndex={0} aria-label="完整工具参数">{approval.display}</pre>
    <button type="button" className="text-button" onClick={()=>void navigator.clipboard.writeText(approval.display).catch(e=>setError(explain(e)))}>复制完整命令</button>
    <dl>
     <dt>工具</dt><dd>{approval.toolName}</dd>
     {approval.cwd&&<><dt>工作目录</dt><dd>{approval.cwd}</dd></>}
     {approval.riskTags?.length>0&&<><dt>策略分类</dt><dd>{approval.riskTags.join('、')}</dd></>}
     <dt>来源工作</dt><dd>{approval.jobId}</dd>
     <dt>截止时间</dt><dd>{new Date(approval.expiresAt).toLocaleString('zh-CN')}</dd>
    </dl>
    {facts.length>0&&<ul className="approval-facts" aria-label="实际操作目标">{facts.map((fact:any,index:number)=><li key={index}>{fact.reason} <code>{fact.target}</code></li>)}</ul>}
   </div>
  </details>
  {grants&&<div className="approval-grants" aria-label="成员授权">
   {!grants.length&&<p>当前没有长期授权</p>}
   {grants.map(grant=><p key={grant.id}><span>{grant.kind==='command'?'指定完整命令':grant.kind==='directory'?'目录常规操作':'同类工具操作'} · {grant.directory??grant.cwd}</span><button type="button" className="text-button" disabled={!!busy} onClick={()=>void revokeGrant(grant.id)}>撤销</button></p>)}
  </div>}
  {error&&<p className="flow-error" role="alert">{error}</p>}
  <footer className="approval-footer">
   <button type="button" className="text-button approval-manage" aria-expanded={!!grants} onClick={()=>void toggleGrants()}>管理此成员已有授权</button>
   <div className="approval-actions">
    <button className="secondary" disabled={!!busy} onClick={()=>void decide('deny')}><X size={14}/>{busy==='deny'?'正在拒绝…':splitRequired?'拒绝此申请':'拒绝'}</button>
    {!splitRequired&&<>
     <button className={directories.length||approval.commandScoped?'secondary':'primary'} disabled={!!busy} onClick={()=>void decide('allow_once')}><Check size={14}/>{busy==='allow_once'?'正在确认…':'允许本次'}</button>
     {directories.length?<button className="primary" disabled={!!busy} onClick={()=>void decide(directoryDecision)}>{busy===directoryDecision?'正在授权…':approval.directoryOperations==='routine'?(directories.length>1?'长期允许所列目录':'长期允许此目录'):'长期允许此目录读写'}</button>:
      approval.canAlways&&<button className={approval.commandScoped?'primary':'secondary'} disabled={!!busy} onClick={()=>void decide('allow_always')}>{busy==='allow_always'?'正在授权…':approval.commandScoped?'长期允许此命令':approval.toolName==='bash'?'长期允许此目录常规命令':'长期允许此类操作'}</button>}
    </>}
   </div>
  </footer>
 </section>;
}
export function ApprovalReceiptNotice({approval,bot,onWork}:{approval:any;bot?:Bot;onWork?:()=>void}){
 const description=toolApprovalSummary(approval.toolName,approval.display);
 const allowed=approval.status==='allowed',denied=approval.status==='denied',expired=approval.status==='expired';
 const title=allowed?'已批准':denied?'已拒绝':expired?'审批已过期':'审批已取消';
 const detail=allowed?'执行结果请查看工作记录。':denied?'已拒绝这项操作。':expired?'工作已暂停，可重新发起。':approval.reason?explain(approval.reason):'这项申请已关闭。';
 return <section className="tool-approval approval-receipt" data-notification-target={approval.id} tabIndex={-1} aria-label={title}>
  <h3><ShieldCheck size={16}/>{bot?.name.replace(/ · KTeam .+$/,'')??'成员'} · {title}</h3>
  <p>{description.summary}{description.target&&<> · <code>{description.target}</code></>}</p>
  <small role="status">{detail}</small>
  {onWork&&<button type="button" className="text-button" onClick={onWork}>查看工作记录</button>}
 </section>;
}
export function toolActivity(events:any[],bots:Bot[]){
 const descriptions:Record<string,string>={read:'正在查阅本机资料',glob:'正在定位资料',grep:'正在检索资料',bash:'正在检查本机资料',web_fetch:'正在核对网络资料',web_search:'正在查找公开来源',update_shared_context:'正在整理共享纪要',ask_user:'等待你在私聊中确认'};
 const event=[...events].reverse().find(e=>(e.name==='contact_bot'||descriptions[e.name]));
 if(!event||event.state!=='running')return undefined;
 if(event.name==='contact_bot'){try{const input=typeof event.input==='string'?JSON.parse(event.input):event.input;const name=bots.find(b=>b.id===input.botId)?.name;return name?'正在与'+name+'核对，等待对方答复':'正在与另一位成员核对';}catch{return '正在与另一位成员核对';}}
 return descriptions[event.name];
}
function GeneratedFileButton({event}:{event:any}){const[error,setError]=useState(''),[busy,setBusy]=useState(false);return <div><button className="secondary" disabled={busy} onClick={()=>{setBusy(true);setError('');void showGeneratedFile({roomId:event.file.roomId,toolCallId:event.id}).catch(e=>setError(explain(e))).finally(()=>setBusy(false));}}><FileText size={16} strokeWidth={1.6} aria-hidden="true"/>打开 {event.file.name}</button>{error&&<p className="flow-error" role="alert">{error}</p>}</div>;}
export function ToolTrace({events}:{events:any[]}){if(!events.length)return null;return <><div className="generated-files">{events.filter(e=>e.state==='completed'&&e.file).map(e=><GeneratedFileButton key={e.id} event={e}/>)}</div><details className="tool-trace"><summary><Terminal size={13}/>工具记录 · {[...new Set(events.map(e=>e.name))].join('、')} · {events.length} 条记录</summary>{events.map(e=><div key={e.id}><strong>{e.name}<small>{e.state==='completed'?'已返回':e.state==='running'?'执行中':'未完成'}</small></strong>{e.input&&<pre>{typeof e.input==='string'?e.input:JSON.stringify(e.input,null,2)}</pre>}{e.result&&<pre>{typeof e.result==='string'?e.result:JSON.stringify(e.result,null,2)}</pre>}{e.code&&<p>{explain(e.code)}</p>}</div>)}</details></>;}

export function RuntimeMessageContent({text,cards=[],files=[]}:{text:string;cards?:any[];files?:any[]}){
 if(unexecutedModelToolOutput(text))return <p role="alert">工具请求格式错误，尚未执行。请在工作记录中核对并恢复。</p>;
 const parts:React.ReactNode[]=[];let start=0;
 for(const [index,card]of cards.entries()){
  const offset=Math.max(start,Math.min(text.length,Number.isSafeInteger(card.offset)?card.offset:text.length));
  if(offset>start)parts.push(<Markdown key={'text-'+index} text={text.slice(start,offset)} files={files}/>);
  parts.push(<div className="runtime-card" key={card.artifactId??index}><A2uiArtifactRenderer artifactContent={card.content} artifactRef={{key:card.artifactId,artifactId:card.artifactId}}/></div>);start=offset;
 }
 if(start<text.length||!parts.length)parts.push(<Markdown key="text-final" text={text.slice(start)} files={files}/>);
 return <>{parts}</>;
}

export function BotQuestionCard({question,onAnswer,onSource}:{question:any;onAnswer:(text:string)=>Promise<void>;onSource?:()=>void}){
 const[value,setValue]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const answer=async(text:string)=>{if(!text.trim())return;setBusy(true);try{await onAnswer(text);}catch(e){setError(explain(e));}finally{setBusy(false);}};
 return <section className="tool-approval" data-notification-target={question.id} tabIndex={-1} aria-label="私聊确认"><h3>需要你确认一件事</h3><p>{question.question}</p><small>来源：{question.sourceRoomTitle??'原会话'} · {question.durable?'原工作已保存，回答后接续同一工作':'回答后继续原来的工作'}</small>{onSource&&<button type="button" className="text-button" onClick={onSource}>查看发起工作</button>}{(question.options??[]).length>0&&<div>{question.options.map((label:string)=><button className="secondary" disabled={busy} key={label} onClick={()=>void answer(label)}>{label}</button>)}</div>}<form onSubmit={e=>{e.preventDefault();void answer(value);}}><input aria-label="回答问题" value={value} onChange={e=>setValue(e.target.value)} placeholder="你的回答（请勿填写密码或验证码）"/><button className="primary" disabled={busy||!value.trim()}>发送回答</button></form>{error&&<p role="alert">{error}</p>}</section>;
}
