import {A2uiArtifactRenderer} from '../../xiaok/renderer/src/components/a2ui/A2uiArtifactRenderer';
import {Markdown} from './Markdown';
import React,{useState}from'react';
import{Check,ShieldCheck,X}from'lucide-react';
import{explain,type Bot}from'./api';
export function ToolApprovalCard({approval,bot,onDecide}:{approval:any;bot?:Bot;onDecide:(decision:'allow_once'|'allow_always'|'deny')=>Promise<void>}){
 const[busy,setBusy]=useState(false),[error,setError]=useState('');const decide=async(decision:'allow_once'|'allow_always'|'deny')=>{setBusy(true);setError('');try{await onDecide(decision);}catch(e){setError(explain(e));}finally{setBusy(false);}};
 let input:Record<string,any>={};try{input=JSON.parse(approval.display);}catch{}
 const titles:Record<string,string>={bash:'运行终端命令',write:'写入文件',edit:'修改文件',send_mail:'发送邮件',install_skill:'安装技能',uninstall_skill:'移除技能'};
 const title=titles[approval.toolName]??'执行一项操作',file=typeof input.file_path==='string'?input.file_path:undefined;
 const labels:Record<string,string>={command:'命令',workdir:'执行目录',file_path:'保存位置',characters:'文字数量',lines:'行数',timeout_ms:'最长等待',summary:'说明',to:'收件人',subject:'主题',body:'邮件内容',source:'来源',name:'名称'};
 return <section className="tool-approval" aria-label="操作确认"><h3><ShieldCheck size={18}/>{bot?.name.replace(/ · KTeam .+$/,'')??'成员'} 要{title}{file?' '+file.split(/[\\/]/).pop():''}</h3><p>确认后由成员在这台电脑上完成，无需你复制或执行参数。</p>{file&&<p>保存位置：{file}</p>}{approval.toolName==='bash'&&typeof input.command==='string'&&<pre>{input.command}</pre>}{approval.toolName==='bash'&&<small>执行目录：{input.workdir??approval.cwd}</small>}<details className="operation-details"><summary>操作详情</summary><dl>{Object.entries(input).filter(([key])=>!['content','old_string','new_string','file_path','command','workdir'].includes(key)).map(([key,value],i)=><React.Fragment key={key}><dt>{labels[key]??'信息 '+(i+1)}</dt><dd>{key==='timeout_ms'?Number(value)/1000+' 秒':typeof value==='string'||typeof value==='number'?String(value):'已配置'}</dd></React.Fragment>)}</dl></details>{approval.canAlways&&<small>长期授权范围：此成员在 {approval.cwd} 中的这类操作</small>}{error&&<p className="flow-error" role="alert">{error}</p>}<div><button className="secondary" disabled={busy} onClick={()=>void decide('deny')}><X size={14}/>拒绝</button><button className="secondary" disabled={busy} onClick={()=>void decide('allow_once')}><Check size={14}/>允许本次</button>{approval.canAlways&&<button className="primary" disabled={busy} onClick={()=>void decide('allow_always')}>以后允许这类操作</button>}</div></section>;
}
export function toolActivity(events:any[],bots:Bot[]){
 const descriptions:Record<string,string>={read:'正在查阅本机资料',glob:'正在定位资料',grep:'正在检索资料',bash:'正在处理项目工作',write:'正在写入文档',edit:'正在修改文档',web_fetch:'正在核对网络资料',web_search:'正在查找公开来源',update_shared_context:'正在整理共享纪要',ask_user:'等待你在私聊中确认'};
 const event=[...events].reverse().find(e=>(e.name==='contact_bot'||descriptions[e.name]));
 if(!event||event.state!=='running')return undefined;
 if(event.name==='contact_bot'){try{const input=typeof event.input==='string'?JSON.parse(event.input):event.input;const name=bots.find(b=>b.id===input.botId)?.name;return name?'正在与'+name+'核对，等待对方答复':'正在与另一位成员核对';}catch{return '正在与另一位成员核对';}}
 if(['write','edit'].includes(event.name)){try{const input=JSON.parse(event.input);if(input.file_path)return descriptions[event.name]+' '+String(input.file_path).split(/[\\/]/).pop();}catch{}}
 return descriptions[event.name];
}

export function RuntimeMessageContent({text,cards=[]}:{text:string;cards?:any[]}){
 const parts:React.ReactNode[]=[];let start=0;
 for(const [index,card]of cards.entries()){
  const offset=Math.max(start,Math.min(text.length,Number.isSafeInteger(card.offset)?card.offset:text.length));
  if(offset>start)parts.push(<Markdown key={'text-'+index} text={text.slice(start,offset)}/>);
  parts.push(<div className="runtime-card" key={card.artifactId??index}><A2uiArtifactRenderer artifactContent={card.content} artifactRef={{key:card.artifactId,artifactId:card.artifactId}}/></div>);start=offset;
 }
 if(start<text.length||!parts.length)parts.push(<Markdown key="text-final" text={text.slice(start)}/>);
 return <>{parts}</>;
}

export function BotQuestionCard({question,onAnswer}:{question:any;onAnswer:(text:string)=>Promise<void>}){
 const[value,setValue]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const answer=async(text:string)=>{if(!text.trim())return;setBusy(true);try{await onAnswer(text);}catch(e){setError(explain(e));}finally{setBusy(false);}};
 return <section className="tool-approval" aria-label="私聊确认"><h3>需要你确认一件事</h3><p>{question.question}</p><small>来源群：{question.sourceRoomTitle??'原群'} · 回答后继续原来的工作</small>{(question.options??[]).length>0&&<div>{question.options.map((label:string)=><button className="secondary" disabled={busy} key={label} onClick={()=>void answer(label)}>{label}</button>)}</div>}<form onSubmit={e=>{e.preventDefault();void answer(value);}}><input aria-label="回答问题" value={value} onChange={e=>setValue(e.target.value)} placeholder="你的回答（请勿填写密码或验证码）"/><button className="primary" disabled={busy||!value.trim()}>发送回答</button></form>{error&&<p role="alert">{error}</p>}</section>;
}
