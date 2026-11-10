import {executionFailure} from '../../../src/protocol/execution-failure';
import {explain, type Bot} from './api';

export function WorkRecoveryNotice({recovery,job,bots,reconnecting,busy,onContinue}:{recovery:any;job:any;bots:Bot[];reconnecting:boolean;busy:boolean;onContinue:()=>void}) {
 if (!job || !['stopped','unknown','blocked'].includes(job.state)) return null;
 const name = bots.find(bot=>bot.id===job.activeBotId)?.name ?? '成员';
 return <section className="work-recovery" aria-label="中断工作恢复" role="status">
  <strong>{recovery?.hostInterrupted?'后台重启中断了本轮工作':explain(executionFailure(job)?.code??job.reason)}</strong>
  {recovery&&<p>{reconnecting?'正在自动重新连接…':'团队服务已连接。'}已有消息{recovery.hasDraft?'和工作草稿':''}已保留。{recovery.completedReplies>0?'已交付的答复会保留。':''}</p>}
  {recovery?.canContinue&&<><button className="secondary" disabled={busy||reconnecting} onClick={onContinue}>{busy?'正在准备继续…':recovery.native?'核对已有结果':'核对并继续'}</button><small>{name}会先核对已有结果，再处理未完成部分。{recovery.native?'本机 Agent 本轮只读核对。':'需要修改或执行时会重新确认。'}</small></>}
  {recovery?.reason&&<p>{explain(recovery.reason)}</p>}
 </section>;
}
