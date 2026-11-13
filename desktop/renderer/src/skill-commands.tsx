import {useEffect,useState} from 'react';
import {api,explain} from './api';
export function SkillCommands({roomId,botId,kind,value,onSelect}:{roomId:string;botId?:string;kind?:string;value:string;onSelect:(text:string)=>void}){
 const active=value.startsWith('/'),[data,setData]=useState<any>(),[error,setError]=useState('');
 useEffect(()=>{setData(undefined);setError('');if(!active||!botId||!['direct','assistant'].includes(kind??''))return;let live=true;void api.botCapabilities({botId,roomId}).then(result=>{if(live)setData(result);}).catch(e=>{if(live)setError(explain(e));});return()=>{live=false;};},[active,botId,roomId,kind]);
 if(!active)return null;
 if(!['direct','assistant'].includes(kind??''))return <p className="form-note" role="status">Skill 命令仅限单聊。请打开某位 Bot 的私聊后调用。</p>;
 const query=value.replace(/^\/(?:skill\s+)?/,'').split(/\s/)[0],skills=(data?.skills??[]).filter((skill:any)=>skill.enabled&&!skill.sourceError&&!skill.versionChanged&&(!query||['skill','skills','help'].includes(query)||skill.name.toLowerCase().includes(query.toLowerCase())));
 return <section className="slash-commands" aria-label="Skill 命令"><p className="form-note">输入 /技能名 要求，或选择技能。沿用当前 Bot 的目录和工具批准。</p>{error?<p role="alert">{error}</p>:!data?<p role="status">正在读取可用技能…</p>:data.supported===false?<p role="status">{data.reason}</p>:skills.length?skills.slice(0,20).map((skill:any)=><button type="button" className="secondary" key={skill.name} onClick={()=>onSelect('/'+skill.name+' ')}><strong>/{skill.name}</strong><span>{skill.description?.slice(0,100)}</span></button>):<p role="status">没有匹配的可用技能。可在 Bot 设置的“技能”中查看。</p>}</section>;
}
