import {executionFailure} from '../../../src/protocol/execution-failure';
import {explain, type Bot} from './api';
import {recoveredConnectionError} from './connection-state';

export function WorkRecoveryNotice({recovery,job,bots,reconnecting,busy,onContinue}:{recovery:any;job:any;bots:Bot[];reconnecting:boolean;busy:boolean;onContinue:()=>void}) {
 if (!job || !['stopped','unknown','blocked'].includes(job.state)) return null;
 const name = bots.find(bot=>bot.id===job.activeBotId)?.name ?? '成员';
 const code = executionFailure(job)?.code ?? job.reason;
 const connectionFailure = recoveredConnectionError(code,{ready:true,broker:{available:true},kswarm:{available:true}});
 const interrupted = recovery?.hostInterrupted || job.state==='stopped' || connectionFailure;
 return <section className="work-recovery" aria-label="中断工作恢复" role="status">
  <strong>{interrupted?`${name}的工作中断了`:explain(code)}</strong>
  <p>{recovery?.hostInterrupted?'应用重启时，这项工作尚未完成。':''}{reconnecting?'连接暂时中断，正在自动重连。':connectionFailure?'连接已恢复，这项工作尚未完成。':''}已有消息{recovery?.hasDraft?'和工作草稿':''}已保留。{recovery?.completedReplies>0?'已完成的答复不会重复生成。':''}</p>
  {recovery?.canContinue&&<><button className="secondary" disabled={busy||reconnecting} onClick={onContinue}>{busy?'正在准备继续…':reconnecting?'等待连接恢复…':recovery.native?'检查已有结果':'继续这项工作'}</button><small>{recovery.native?`${name}会检查已有结果，并说明还需要完成什么。`:`${name}会先检查已有结果，接着处理未完成的部分。`}</small></>}
  {recovery?.reason&&<p>{explain(recovery.reason)}</p>}
 </section>;
}
