import {isPluginCommand,type PluginCommandChoice} from '../../../src/protocol/plugins';
import {parseSkillCommand,skillCommandNeedsList} from '../../../src/protocol/skill-command';
import {useEffect,useRef,useState} from 'react';
import {api,explain} from './api';
import {spaceCommand,spaceCommandCandidate} from './space-command';

export function SkillCommands({roomId,botId,kind,value,onSelect}:{roomId:string;botId?:string;kind?:string;value:string;onSelect:(text:string)=>void}){
 const skillInput=skillCommandNeedsList(value)||!!parseSkillCommand(value);
 const showSpace=spaceCommandCandidate(value);
 const pluginOnly=isPluginCommand(value);
 const showPlugins=pluginOnly||(skillInput&&'/plugin'.startsWith(value.trim()));
 const active=skillInput||showSpace||showPlugins;
 const [pluginChoices,setPluginChoices]=useState<PluginCommandChoice[]>();
 const [pluginError,setPluginError]=useState('');
 const selection=useRef(0);
 const latest=useRef({roomId,value});
 latest.current={roomId,value};
 useEffect(()=>{
  setPluginChoices(undefined);setPluginError('');
  if(!showPlugins)return;
  let live=true;
  void api.pluginCommands().then(result=>{if(live)setPluginChoices(result.commands);})
    .catch(error=>{if(live)setPluginError(explain(error));});
  return()=>{live=false;selection.current++;};
 },[showPlugins,roomId]);
 const selectPlugin=async(choice:PluginCommandChoice)=>{
  const request=++selection.current;
  setPluginError('');
  const current=()=>request===selection.current&&latest.current.roomId===roomId&&latest.current.value===value;
  try{
   const result=await api.pluginDraft({pluginId:choice.pluginId,commandId:choice.commandId,revision:choice.revision});
   if(current())onSelect(result.draft);
  }catch(error){if(current())setPluginError(explain(error));}
 };
 const supportsSkills=kind==='direct'||kind==='assistant';
 const showSkills=skillInput&&supportsSkills&&!spaceCommand(value)&&!pluginOnly;
 const [data,setData]=useState<any>(),[error,setError]=useState('');
 useEffect(()=>{
  setData(undefined);setError('');
  if(!showSkills||!botId)return;
  let live=true;
  void api.botCapabilities({botId,roomId}).then(result=>{if(live)setData(result);}).catch(e=>{if(live)setError(explain(e));});
  return()=>{live=false;};
 },[showSkills,botId,roomId]);
 if(!active||!showSpace&&spaceCommand(value))return null;
 if(!showSpace&&!supportsSkills&&!showPlugins)return <p className="form-note" role="status">Skill 命令仅限单聊。请打开某位 Bot 的私聊后调用。</p>;
 const query=value.replace(/^\/(?:skill\s+)?/,'').split(/\s/)[0];
 const skills=(data?.skills??[]).filter((skill:any)=>skill.enabled&&!skill.sourceError&&!skill.versionChanged&&
  (!query||['skill','skills','help'].includes(query)||skill.name.toLowerCase().includes(query.toLowerCase())));
 const pluginQuery=value.trim().replace(/^\/plugin\s*/i,'').toLowerCase();
 const plugins=(pluginChoices??[]).filter(choice=>!pluginOnly||!pluginQuery||
  [choice.pluginId+'/'+choice.commandId,choice.title,choice.pluginName].some(text=>text.toLowerCase().includes(pluginQuery)));
 return <section className="slash-commands" aria-label="输入命令">
  {showSpace&&<>
   <button type="button" className="secondary" onClick={()=>onSelect('/space')}><strong>/space</strong><span>打开本机空间工作台</span></button>
   <button type="button" className="secondary" onClick={()=>onSelect('/space create ')}><strong>/space create</strong><span>按名称创建本机空间</span></button>
  </>}
  {showPlugins&&<>
   {plugins.length>0&&<p className="form-note">插件命令会填入草稿，发送前可编辑。</p>}
   {plugins.slice(0,20).map(choice=><button type="button" className="secondary"
    key={choice.pluginId+'/'+choice.commandId} onClick={()=>void selectPlugin(choice)}>
    <strong>{choice.title}</strong><span>{choice.pluginName} · /plugin {choice.pluginId}/{choice.commandId}</span>
   </button>)}
   {pluginError&&<p role="alert">{pluginError}</p>}
   {pluginOnly&&!pluginError&&!plugins.length&&<p role="status">
    {!pluginChoices?'正在读取插件命令…':'没有匹配的插件命令。可在设置的「插件」中启用。'}
   </p>}
  </>}
  {showSkills&&<>
   <p className="form-note">输入 /技能名 要求，或选择技能。沿用当前 Bot 的目录和工具批准。</p>
   {error?<p role="alert">{error}</p>:!data?<p role="status">正在读取可用技能…</p>:data.supported===false?<p role="status">{data.reason}</p>:skills.length?
    skills.slice(0,20).map((skill:any)=>{
     const command=['space','plugin'].includes(skill.name)?'/skill '+skill.name:'/'+skill.name;
     return <button type="button" className="secondary" key={skill.name} onClick={()=>onSelect(command+' ')}><strong>{command}</strong><span>{skill.description?.slice(0,100)}</span></button>;
    }):<p role="status">没有匹配的可用技能。可在 Bot 设置的“技能”中查看。</p>}
  </>}
 </section>;
}
