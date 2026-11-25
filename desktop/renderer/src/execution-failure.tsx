import {useState} from 'react';
import {modelFailureMessage} from '../../../src/protocol/model-failure-notice';
import {executionDiagnostic,executionFailure} from '../../../src/protocol/execution-failure';
import {explain,type Bot} from './api';
const phases={routing:'选择处理成员',preparing:'准备执行环境',model:'请求模型',tool:'执行工具',delivery:'提交回复与交付',unknown:'未记录'};
export function ExecutionFailureDetails({job,bots}:{job:any;bots:Bot[]}){
 const [copyState,setCopyState]=useState<{payload:string;message:string}>();
 const failure=executionFailure(job);if(!failure)return null;
 const diagnostic=executionDiagnostic(job),payload=JSON.stringify(diagnostic,null,2);
 async function copyDiagnostic(){
  try{await navigator.clipboard.writeText(payload);setCopyState({payload,message:'已复制诊断。'});}
  catch{setCopyState({payload,message:'无法访问剪贴板，请从预览中选择并复制。'});}
 }
 const bot=bots.find(b=>b.id===failure.botId),events=(job.toolTrace??[]).filter((e:any)=>['tool_started','tool_finished','model_request_started','run_aborted','run_failed'].includes(e.type)).slice(-8);
 return <section className="execution-failure" aria-label="执行问题详情"><h3>{explain(failure.code)}</h3><dl><dt>阶段</dt><dd>{phases[failure.phase]??phases.unknown}{failure.toolName?' · '+failure.toolName:''}</dd>{bot&&<><dt>成员</dt><dd>{bot.name}</dd></>}<dt>{failure.model?'模型':'模型（当前绑定）'}</dt><dd>{failure.model??bot?.binding?.model??'旧记录未保存'}</dd>{failure.at&&<><dt>时间</dt><dd>{new Date(failure.at).toLocaleString()}</dd></>}{failure.httpStatus&&<><dt>接口状态</dt><dd>HTTP {failure.httpStatus}</dd></>}</dl>
 {failure.evidence!=='captured'?<p>旧版本没有保存原始异常，无法确定具体中断原因。</p>:failure.code==='execution_admission_unverified'?<p>协作服务连接中断或执行租约未能续期。本轮记录已保留；确认原执行结束、工具结果完整后会自动接续。若仍未恢复，可查看技术信息。</p>:failure.code==='execution_lease_lost'?<p>协作服务已拒绝本轮继续执行，可能是任务、成员绑定或权限范围发生变化。</p>:null}
 {events.length>0&&<details><summary>最近的执行记录</summary><ol>{events.map((e:any)=><li key={e.id}><time>{new Date(e.startedAt).toLocaleTimeString()}</time><span>{e.type==='model_request_started'?'请求模型':e.type==='run_aborted'?'运行中断':e.type==='run_failed'?'运行失败':e.name+' · '+(e.type==='tool_started'?'开始':'返回')}</span></li>)}</ol></details>}
 {(failure.message||failure.causeCode||failure.exception)&&<details><summary>技术信息</summary>{failure.message&&<pre>{failure.message}</pre>}<p>{failure.exception}{failure.causeCode?' · '+failure.causeCode:''}</p></details>}
 {diagnostic&&<details><summary>预览脱敏诊断</summary><p>{diagnostic.next}。</p><pre>{payload}</pre><button type="button" onClick={()=>void copyDiagnostic()}>复制预览内容</button>{copyState?.payload===payload&&<span role="status">{copyState.message}</span>}</details>}
 <p>核对工具记录和未交付草稿后，再决定是否重新发起。</p></section>;
}

export function ModelFailureNotice({notice,bots,onSettings,onDetails}:{notice:{job:any;failure:any};bots:Bot[];onSettings:()=>void;onDetails:()=>void}){
 const {failure}=notice,routingProblem=['group_plan_invalid','group_dependency_cycle','routing_invalid','iteration_budget_exhausted','group_research_evidence_missing'].includes(failure.code),name=bots.find(bot=>bot.id===failure.botId)?.name.replace(/ · KTeam .+$/,'')??'成员',message=modelFailureMessage(failure.code,failure.phase);
 return <section className="work-recovery" role="alert" aria-label="处理请求失败"><strong>{message.title}</strong><p>{name}{failure.model?' · '+failure.model:''}：{message.reason}{failure.httpStatus?'（HTTP '+failure.httpStatus+'）':''}。</p><p>{message.guidance}{routingProblem?'请查看失败详情和已有执行记录。':'请在模型设置中检查配置，或为成员选择可用模型。'}</p>{!routingProblem&&<button className="secondary" onClick={onSettings}>{failure.code==='model_tool_approval_unavailable'?'调整成员模型':'打开模型设置'}</button>}<button className="secondary" onClick={onDetails}>查看失败详情</button></section>;
}
