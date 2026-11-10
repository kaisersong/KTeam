import {executionFailure} from '../../../src/protocol/execution-failure';
import {explain,type Bot} from './api';
const phases={routing:'选择处理成员',preparing:'准备执行环境',model:'请求模型',tool:'执行工具',delivery:'提交回复与交付',unknown:'未记录'};
export function ExecutionFailureDetails({job,bots}:{job:any;bots:Bot[]}){
 const failure=executionFailure(job);if(!failure)return null;
 const bot=bots.find(b=>b.id===failure.botId),events=(job.toolTrace??[]).filter((e:any)=>['tool_started','tool_finished','model_request_started','run_aborted','run_failed'].includes(e.type)).slice(-8);
 return <section className="execution-failure" aria-label="执行问题详情"><h3>{explain(failure.code)}</h3><dl><dt>阶段</dt><dd>{phases[failure.phase]??phases.unknown}{failure.toolName?' · '+failure.toolName:''}</dd>{bot&&<><dt>成员</dt><dd>{bot.name}</dd></>}<dt>{failure.model?'模型':'模型（当前绑定）'}</dt><dd>{failure.model??bot?.binding?.model??'旧记录未保存'}</dd>{failure.at&&<><dt>时间</dt><dd>{new Date(failure.at).toLocaleString()}</dd></>}{failure.httpStatus&&<><dt>接口状态</dt><dd>HTTP {failure.httpStatus}</dd></>}</dl>
 {failure.evidence!=='captured'?<p>旧版本没有保存原始异常，无法确定具体中断原因。</p>:failure.code==='execution_admission_unverified'?<p>与协作服务通信未能及时确认有效执行资格。已停止后续执行，请先检查服务连接。</p>:failure.code==='execution_lease_lost'?<p>协作服务已拒绝本轮继续执行，可能是任务、成员绑定或权限范围发生变化。</p>:null}
 {events.length>0&&<details><summary>最近的执行记录</summary><ol>{events.map((e:any)=><li key={e.id}><time>{new Date(e.startedAt).toLocaleTimeString()}</time><span>{e.type==='model_request_started'?'请求模型':e.type==='run_aborted'?'运行中断':e.type==='run_failed'?'运行失败':e.name+' · '+(e.type==='tool_started'?'开始':'返回')}</span></li>)}</ol></details>}
 {(failure.message||failure.causeCode||failure.exception)&&<details><summary>技术信息</summary>{failure.message&&<pre>{failure.message}</pre>}<p>{failure.exception}{failure.causeCode?' · '+failure.causeCode:''}</p></details>}
 <p>核对已完成内容和未交付草稿后，再决定是否继续。</p></section>;
}
