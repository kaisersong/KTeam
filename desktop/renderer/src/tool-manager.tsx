import {useEffect,useState} from 'react';
import {Check,RefreshCw,RotateCcw,Pencil,Monitor} from 'lucide-react';
import {api,explain} from './api';
import {WebToolsSettings} from './integration-settings';
import {CUASettings} from './integration-settings';
import {SettingsSection,SettingsFeedback,SettingsLoading,SettingsSearch,SettingsTabs,SettingToggle,SettingField,useIntegrationSettings} from './settings-shared';
const groupOf=(name:string)=>/^(read|write|edit|glob|grep)$/.test(name)?'files':/bash|shell|command/.test(name)?'terminal':/^web_/.test(name)?'web':/^skill/.test(name)?'skills':/^notebook|memory/.test(name)?'memory':/^mcp__|cua|computer/.test(name)?'mcp':'other';
const groups=[['all','全部工具'],['files','文件'],['terminal','终端'],['web','网页'],['skills','技能'],['memory','记忆'],['other','其它']];
export function ToolsSettings({initialTab='catalog'}:{initialTab?:'catalog'|'web'|'computer'}){
 const [tab,setTab]=useState(initialTab);return <><SettingsSection title="工具管理" description="查看内置 Agent 可用的工具，管理启停与说明，并配置网页服务和电脑操作。外部 CLI 使用它自己的工具设置。"><SettingsTabs label="工具管理分类" value={tab} onChange={setTab} tabs={[{id:'catalog',label:'内置工具'},{id:'web',label:'网页搜索与读取'},{id:'computer',label:'电脑操作'}]}/></SettingsSection>{tab==='catalog'?<ToolCatalog/>:tab==='web'?<WebToolsSettings/>:<CUASettings/>}</>;
}
function ToolCatalog(){
 const state=useIntegrationSettings(),[resources,setResources]=useState<any>(),[resourceError,setResourceError]=useState(''),[query,setQuery]=useState(''),[group,setGroup]=useState('all'),[editing,setEditing]=useState<any>(),[description,setDescription]=useState('');
 async function load(){setResourceError('');try{setResources(await api.appResources());}catch(e){setResourceError(explain(e));}}
 useEffect(()=>{void load();},[]);
 const config=state.data?.settings.tools,tools=resources?.tools??[],filtered=tools.filter((tool:any)=>(group==='all'||groupOf(tool.name)===group)&&(tool.name+' '+tool.description).toLowerCase().includes(query.toLowerCase()));
 async function update(patch:any){const result=await state.save('tools',{...config,...patch});if(result)await load();return !!result;}
 return <SettingsSection title="内置工具" description="停用后，工具从内置 Agent 目录移除，进行中的旧配置停止继续调用。修改说明只改变模型看到的说明，操作仍遵守原有授权。" actions={<button className="icon-button" aria-label="刷新工具列表" disabled={state.busy} onClick={()=>{void load();void state.reload();}}><RefreshCw size={16}/></button>}>
  <SettingsFeedback state={state}/>{resourceError&&<p role="alert" className="settings-error">{resourceError}</p>}
  {!config||!resources?<SettingsLoading/>:<><div className="settings-toolbar"><SettingsSearch label="搜索工具名称或说明" value={query} onChange={setQuery}/><select aria-label="工具分组" value={group} onChange={e=>setGroup(e.target.value)}>{groups.map(([id,label])=><option value={id} key={id}>{label}</option>)}</select><span className="settings-badge">{tools.length-config.disabled.filter((n:string)=>tools.some((t:any)=>t.name===n)).length} / {tools.length} 已启用</span></div>
   <div className="settings-list">{filtered.map((tool:any)=><div className="settings-tool-row" key={tool.name}><div><strong>{tool.name}</strong><span className="settings-badge">{tool.permission==='safe'?'默认可用':'按授权执行'}</span>{config.descriptions[tool.name]&&<span className="settings-badge">自定义说明</span>}<p>{config.descriptions[tool.name]??tool.defaultDescription}</p><button className="text-link" disabled={state.busy} onClick={()=>{setEditing(tool);setDescription(config.descriptions[tool.name]??tool.defaultDescription);}}><Pencil size={12}/>编辑说明</button></div><SettingToggle label={'启用工具 '+tool.name} checked={!config.disabled.includes(tool.name)} disabled={state.busy} onChange={enabled=>void update({disabled:enabled?config.disabled.filter((name:string)=>name!==tool.name):[...config.disabled,tool.name]})}/></div>)}</div>
   {!filtered.length&&<div className="settings-empty"><p>没有匹配的工具。</p></div>}
   <details className="advanced"><summary>批量管理</summary><div className="settings-actions"><button className="secondary" disabled={state.busy} onClick={()=>void update({disabled:[]})}>启用全部工具</button><button className="secondary" disabled={state.busy} onClick={()=>void update({disabled:tools.map((t:any)=>t.name)})}>停用全部工具</button></div><p className="settings-description">此处仅影响所列内置工具，MCP、邮箱与电脑操作在各自配置中管理。</p></details>
   {editing&&<div className="settings-editor"><h3>{editing.name} · 工具说明</h3><SettingField label="说明内容"><textarea aria-label="工具说明内容" rows={8} maxLength={16000} value={description} onChange={e=>setDescription(e.target.value)}/></SettingField><div className="settings-actions"><button className="secondary" disabled={state.busy} onClick={()=>setEditing(undefined)}>取消</button><button className="secondary" disabled={state.busy||!config.descriptions[editing.name]} onClick={()=>{const next={...config.descriptions};delete next[editing.name];void update({descriptions:next}).then(ok=>{if(ok)setEditing(undefined);});}}><RotateCcw size={14}/>恢复原说明</button><button className="primary" disabled={state.busy||!description.trim()} onClick={()=>void state.save('tools',{...config,descriptions:{...config.descriptions,[editing.name]:description}}).then(result=>{if(result){setEditing(undefined);void load();}})}><Check size={14}/>保存说明</button></div></div>}
  </>}
 </SettingsSection>;
}
