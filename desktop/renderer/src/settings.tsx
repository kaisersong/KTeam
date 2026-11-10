import {settingsAutosave} from './autosave-api';
import React,{useEffect,useRef,useState} from 'react';
import {ArrowLeft,ArrowRight,Check,ChevronDown,Cpu,FolderOpen,Info,LoaderCircle,Monitor,Palette,RefreshCw,Search,Settings,Shield,SlidersHorizontal,Sparkles,Users} from 'lucide-react';
import {api,explain,type Bot} from './api';
import type {AppPreferences} from '../../../src/service/app-preferences';
import {ensureBuiltinAgent,ensureLocalAgent} from './local-agents';
import './settings.css';
import {ModelSettingsPanel,DecisionModelSettings} from './model-settings';
import {WebToolsSettings,MemorySettings,MailSettings,VoiceSettings} from './integration-settings';
import {ConnectorsSettings} from './connector-settings';
import {MCPSettings} from './mcp-settings';
import {ComputerSettings as CUASettings} from './computer-settings';
import {ProfileSettings} from './profile-settings';

function useResource<T=any>(method:'appPreferences'|'status'|'modelSettings'|'appResources'|'localAgents'|'assistantState'){
 const [data,setData]=useState<T>(),[error,setError]=useState(''),[loading,setLoading]=useState(true),[generation,setGeneration]=useState(0);
 useEffect(()=>{let current=true;setLoading(true);setError('');void api[method]().then(value=>{if(current)setData(value);}).catch(e=>{if(current)setError(explain(e));}).finally(()=>{if(current)setLoading(false);});return()=>{current=false;};},[method,generation]);
 return {data,setData,error,loading,reload:()=>setGeneration(n=>n+1)};
}
function Loading(){return <p className="settings-loading" role="status"><LoaderCircle size={17} className="spinner"/>正在读取…</p>;}
function Failure({error,retry}:{error:string;retry:()=>void}){return <div className="settings-error" role="alert"><p>{error}</p><button className="secondary" onClick={retry}><RefreshCw size={14}/>重新读取</button></div>;}
function Section({title,description,children}:{title:string;description?:string;children:React.ReactNode}){return <section className="settings-block"><h2>{title}</h2>{description&&<p className="settings-description">{description}</p>}{children}</section>;}
const sections=[['general','通用设置',SlidersHorizontal],['models','模型设置',Cpu],['decision','决策与主动性',Settings],['connectors','连接器',Users],['skills','技能管理',Sparkles],['tools','Search / Fetch',Search],['mcp','MCP 服务器',Shield],['cua','电脑操作 CUA',Monitor],['memory','记忆',Info],['voice','语音',SlidersHorizontal],['appearance','外观设置',Palette],['permissions','授权管理',Shield],['data','数据与关于',Info]] as const;
type Page=typeof sections[number][0];

export function SettingsWorkspace({initialPage='general',preferences,onPreferences,onModelsSaved,onClose,onCreate,onBot,bots}:{initialPage?:Page;onModelsSaved?:()=>Promise<void>;preferences?:AppPreferences;onPreferences:(value:AppPreferences)=>void;onClose:()=>void;onCreate:()=>void;onBot:(bot:Bot)=>void;bots:Bot[]}){
 const [page,setPage]=useState<Page>(initialPage);
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!e.isComposing&&e.keyCode!==229&&!e.defaultPrevented){if(document.activeElement instanceof HTMLElement)document.activeElement.blur();onClose();}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[onClose]);
 return <div className="settings-workspace"><aside className="settings-nav"><button className="settings-back" onClick={onClose}><ArrowLeft size={17}/>返回会话</button><h1>设置</h1><nav aria-label="设置分类">{sections.map(([id,label,Icon])=><button key={id} aria-current={page===id?'page':undefined} onClick={()=>setPage(id)}><Icon size={18}/><span>{label}</span></button>)}</nav><p>KTeam<span>你的本地 AI 工作空间</span></p></aside><div className="settings-content" key={page} tabIndex={-1}>
 {page==='general'&&<><ProfileSettings preferences={preferences} onSaved={onPreferences}/><PreferencesPanel kind="general" preferences={preferences} onSaved={onPreferences}/><Services/><Section title="你的 AI 团队" description="创建成员后，在 Bot 设置中选择模型、职责与工作目录。"><button className="secondary" onClick={onCreate}>创建 Bot / 接入 Agent<ArrowRight size={15}/></button></Section></>}
 {page==='models'&&<ModelsPanel onSaved={onModelsSaved}/>}
 {page==='decision'&&<DecisionPanel/>}
 {page==='connectors'&&<ConnectorsSettings agents={<AgentsPanel bots={bots} onBot={onBot} onCreate={onCreate}/>}/>}
 {page==='skills'&&<ResourcesPanel kind="skills" preferences={preferences} onSaved={onPreferences}/>}
 {page==='tools'&&<WebToolsSettings/>}
 {page==='mcp'&&<MCPSettings/>}{page==='cua'&&<CUASettings/>}{page==='memory'&&<MemorySettings/>}{page==='voice'&&<VoiceSettings/>}
 {page==='appearance'&&<PreferencesPanel kind="appearance" preferences={preferences} onSaved={onPreferences}/>}
 {page==='permissions'&&<PermissionsPanel bots={bots}/>}
 {page==='data'&&<DataPanel/>}
 </div></div>;
}

function PreferencesPanel({kind,preferences,onSaved}:{kind:'general'|'appearance';preferences?:AppPreferences;onSaved:(value:AppPreferences)=>void}){
 const resource=useResource('appPreferences'),[draft,setDraft]=useState<AppPreferences>(),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const loaded=resource.data?.preferences as AppPreferences|undefined,base=preferences&&(!loaded||preferences.revision>loaded.revision)?preferences:loaded;
 const previousBase=useRef<AppPreferences|undefined>(undefined);
 useEffect(()=>{if(!base)return;const previous=previousBase.current;previousBase.current=base;setDraft(current=>{const next={...base};for(const key of ['sendShortcut','theme','fontSize','density'] as const)if(current&&previous&&current[key]!==previous[key])(next as any)[key]=current[key];return next;});},[base]);
 const change=(patch:Partial<AppPreferences>)=>{setDraft(v=>v?{...v,...patch}:v);void save(patch);};
 async function save(patch:Partial<AppPreferences>){if(!base)return;setBusy(true);setError('');try{const result=await settingsAutosave.preferences(patch);resource.setData(result);onSaved(result.preferences);}catch(e){setError(explain(e));setDraft(base);}finally{setBusy(false);}}
 if(resource.loading)return <Loading/>;if(resource.error)return <Failure error={resource.error} retry={resource.reload}/>;if(!draft)return null;
 return <><Section title={kind==='general'?'通用设置':'外观设置'} description={kind==='general'?'让日常交流更顺手。':'沿用当前配色与字体。'}>
 {kind==='general'?<label className="settings-field"><span>发送消息<small>输入法选词时不会发送消息。</small></span><select aria-label="发送快捷键" disabled={busy} value={draft.sendShortcut} onChange={e=>change({sendShortcut:e.target.value as AppPreferences['sendShortcut']})}><option value="enter">Enter 发送，Shift Enter 换行</option><option value="modifier-enter">⌘ / Ctrl + Enter 发送，Enter 换行</option></select></label>:<>
 <label className="settings-field"><span>主题</span><select aria-label="界面主题" disabled={busy} value={draft.theme} onChange={e=>change({theme:e.target.value as AppPreferences['theme']})}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label>
 <label className="settings-field"><span>消息字号</span><select aria-label="消息字号" disabled={busy} value={draft.fontSize} onChange={e=>change({fontSize:Number(e.target.value) as AppPreferences['fontSize']})}><option value="13">小 · 13</option><option value="14">标准 · 14</option><option value="16">大 · 16</option></select></label>
 <label className="settings-field"><span>会话密度</span><select aria-label="会话密度" disabled={busy} value={draft.density} onChange={e=>change({density:e.target.value as AppPreferences['density']})}><option value="comfortable">舒适</option><option value="compact">紧凑</option></select></label><div className="appearance-preview" style={{fontSize:draft.fontSize}}><span className="preview-avatar">K</span><div><strong>小K</strong><p>把想做的事告诉我，我们一起推进。</p></div></div></>}
 {error&&<Failure error={error} retry={resource.reload}/>}</Section></>;
}

function Services(){const value=useResource('status');return <Section title="服务状态" description="连接状态来自正在运行的本地服务。">{value.loading?<Loading/>:value.error?<Failure error={value.error} retry={value.reload}/>:<div className="settings-list">{[['broker','消息服务 · Intent Broker'],['kswarm','成员服务 · KSwarm']].map(([key,label])=><div className="settings-row" key={key}><span>{label}</span><span className={'settings-badge '+(value.data?.upstream?.[key]?.available?'ready':'')}>{value.data?.upstream?.[key]?.available?'已连接':'未连接'}</span></div>)}</div>}<button className="secondary" disabled={value.loading} onClick={value.reload}><RefreshCw size={14}/>重新检查</button></Section>;}

function ModelsPanel({onSaved}:{onSaved?:()=>Promise<void>}){return <Section title="模型设置" description="模型与凭证独立保存在 KTeam。添加、编辑和测试已保存的模型；支持导入已有 API 配置，或选择服务商添加模型。"><ModelSettingsPanel onSaved={onSaved}/></Section>;}
function DecisionPanel(){
 const state=useResource('assistantState'),[busy,setBusy]=useState(false),[error,setError]=useState('');
 return <><Section title="决策模型" description="按需启用辅助判断。无需部署 K-IM；关闭时仍使用现有模型完成分工和选人。"><DecisionModelSettings/></Section><Section title="小K主动跟进" description="关注团队进展，有重要交付、阻塞或待决策事项时在小K会话提醒。相同进展不重复提醒，每日最多 4 条。">{state.loading?<Loading/>:state.error?<Failure error={state.error} retry={state.reload}/>:<label className="settings-field"><span>关注团队工作<small>关闭后停止新提醒；不会中断已经授权的工作。</small></span><button role="switch" aria-label="小K主动跟进" aria-checked={state.data?.enabled!==false} disabled={busy} className={'settings-switch '+(state.data?.enabled!==false?'on':'')} onClick={()=>{setBusy(true);setError('');void api.setAssistantProactivity({enabled:state.data?.enabled===false}).then(state.setData).catch(e=>setError(explain(e))).finally(()=>setBusy(false));}}><span/></button></label>}{error&&<p className="settings-error" role="alert">{error}</p>}</Section></>;
}

function ResourcesPanel({kind,preferences,onSaved}:{kind:'skills';preferences?:AppPreferences;onSaved?:(value:AppPreferences)=>void}){
 const resource=useResource('appResources'),prefs=useResource('appPreferences'),[query,setQuery]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const current=(prefs.data?.preferences??preferences) as AppPreferences|undefined;
 async function toggle(name:string){if(!current)return;setBusy(true);setError('');try{const disabledSkills=current.disabledSkills.includes(name)?current.disabledSkills.filter(n=>n!==name):[...current.disabledSkills,name];const result=await api.saveAppPreferences({expectedRevision:current.revision,disabledSkills});prefs.setData(result);onSaved?.(result.preferences);}catch(e){setError(explain(e));}finally{setBusy(false);}}
 if(resource.loading)return <Loading/>;if(resource.error)return <Failure error={resource.error} retry={resource.reload}/>;
 const items=(kind==='skills'?resource.data?.skills:resource.data?.tools)??[];
 return <><Section title={kind==='skills'?'技能管理':'工具与权限'} description={kind==='skills'?'复用小K技能机制，读取 KTeam 全局技能与内置技能。启停只影响 KTeam 内置 Agent，不修改外部 Agent。':'来自内置 xiaok 运行时的实际工具。文件、命令等操作仍遵守原权限规则，需批准时在会话里确认。'}>
 {error&&<Failure error={error} retry={prefs.reload}/>}<div className="settings-toolbar"><label className="settings-search"><Search size={15}/><input aria-label={kind==='skills'?'搜索技能':'搜索工具'} placeholder={kind==='skills'?'搜索技能…':'搜索工具…'} value={query} onChange={e=>setQuery(e.target.value)}/></label><button className="icon-button" aria-label="刷新资源列表" onClick={resource.reload}><RefreshCw size={16}/></button></div>
 <div className="settings-list">{items.filter((v:any)=>(v.name+' '+v.description).toLowerCase().includes(query.toLowerCase())).map((v:any)=><div className="settings-resource" key={v.name}><div><strong>{v.name}</strong><p>{v.description?.slice(0,230)}</p>{kind==='skills'&&<small>{v.source==='project'?'项目技能':v.source==='global'?'全局技能':'内置技能'}</small>}</div>{kind==='skills'&&<button role="switch" aria-label={'启用技能 '+v.name} aria-checked={!current?.disabledSkills.includes(v.name)} disabled={busy||!current||!!prefs.error} className={'settings-switch '+(!current?.disabledSkills.includes(v.name)?'on':'')} onClick={()=>void toggle(v.name)}><span/></button>}</div>)}</div>{!items.length&&<p className="settings-description">暂未发现{kind==='skills'?'技能':'工具'}，请刷新后重试。</p>}{kind==='skills'&&prefs.error&&<Failure error={prefs.error} retry={prefs.reload}/>}</Section>
 </>;
}

function DataPanel(){const status=useResource('status'),[error,setError]=useState('');async function open(location:string){setError('');try{await api.openSettingsLocation({location});}catch(e){setError(explain(e));}}
 return <><Section title="数据与关于" description="会话、成员与工作记录保留在既有服务中。凭证由 KTeam 自己的安全存储管理。">{error&&<p className="settings-error" role="alert">{error}</p>}<div className="settings-list">{[['data','KTeam 数据目录','本地偏好、Bot 绑定与工作记录'],['config','模型配置目录','KTeam 的独立模型与安全凭证引用'],['skills','全局技能目录','KTeam 全局安装的技能'],['logs','主机运行日志','本机后台诊断日志']].map(([id,title,description])=><button key={id} className="settings-member" onClick={()=>void open(id)}><span><strong>{title}</strong><small>{description}</small></span><FolderOpen size={17}/></button>)}</div></Section><Section title="关于 KTeam"><div className="about-kteam"><img src="./icon.svg" alt=""/><div><h3>KTeam</h3><p>组建你的 AI 团队，让工作主动向前。</p></div></div>{status.loading?<Loading/>:status.error?<Failure error={status.error} retry={status.reload}/>:<><div className="settings-row"><span>版本</span><strong>{status.data?.desktop?.version??'开发预览版'}</strong></div>{status.data?.desktop?.revision&&<div className="settings-row"><span>构建</span><code>{status.data.desktop.revision.slice(0,12)}</code></div>}</>}<p className="settings-description">复用 xiaok 运行时、Intent Broker 消息服务与 KSwarm 成员服务。</p></Section></>;
}

function AgentsPanel({bots,onBot,onCreate}:{bots:Bot[];onBot:(bot:Bot)=>void;onCreate:()=>void}){
 const resource=useResource('localAgents'),[busy,setBusy]=useState(''),[message,setMessage]=useState(''),[error,setError]=useState('');
 const controller=useRef<AbortController|undefined>(undefined);useEffect(()=>()=>controller.current?.abort(),[]);
 async function probe(driver:string){controller.current?.abort();const active=new AbortController();controller.current=active;setBusy(driver);setError('');setMessage('');try{if(driver==='builtin'){const models=await api.models();await ensureBuiltinAgent(models.defaultModelId,active.signal);}else await ensureLocalAgent(driver,active.signal);if(!active.signal.aborted){setMessage('真实调用已通过');resource.reload();}}catch(e){if(!active.signal.aborted)setError(explain(e));}finally{if(!active.signal.aborted)setBusy('');}}
 return <><Section title="CLI 与本机 Agent" description="复用已安装 Agent 的模型、登录与工具。检测会执行一次最小调用，现有 Bot 不会自动换绑。">{error&&<p className="settings-error" role="alert">{error}</p>}{message&&<p className="settings-success" role="status"><Check size={15}/>{message}</p>}<div className="settings-row"><div><strong>xiaok · 内置</strong><p className="settings-description">随 KTeam 提供，使用模型设置中的默认模型。</p></div><button className="secondary" disabled={!!busy} onClick={()=>void probe('builtin')}>{busy==='builtin'?'检测中…':'检测连接'}</button></div>{resource.loading?<Loading/>:resource.error?<Failure error={resource.error} retry={resource.reload}/>:resource.data?.agents.map((agent:any)=><div className="settings-row" key={agent.id}><div><strong>{agent.id==='xiaok-cli'?'xiaok CLI · 独立安装':agent.label}</strong><p className="settings-description">{agent.reason?explain(agent.reason):agent.state==='ready'?'真实调用已通过':agent.detected?'本机已安装，尚未验证调用':'尚未安装'}</p></div><button className="secondary" disabled={!!busy||!agent.detected} onClick={()=>void probe(agent.id)}>{busy===agent.id?'检测中…':'检测连接'}</button></div>)}<button className="secondary" disabled={!!busy||resource.loading} onClick={resource.reload}><RefreshCw size={14}/>重新发现</button></Section><Section title="成员运行方式" description="每位成员可以使用不同 Agent；在成员设置中修改绑定。"><div className="settings-list">{bots.map(bot=><button key={bot.id} className="settings-member" onClick={()=>onBot(bot)}><span><strong>{bot.name}</strong><small>{bot.binding?.model??bot.connection?.driver??'尚未绑定 Agent'}</small></span><ArrowRight size={16}/></button>)}</div><button className="secondary" onClick={onCreate}>创建新成员<ArrowRight size={15}/></button></Section></>;
}

function PermissionsPanel({bots}:{bots:Bot[]}){
 const [data,setData]=useState<any>(),[error,setError]=useState(''),[busy,setBusy]=useState('');
 const load=()=>{setError('');void api.toolPermissions().then(setData).catch(e=>setError(explain(e)));};useEffect(load,[]);
 return <Section title="已保存的授权" description="仅适用于所列成员、工作目录与工具。撤销后，下次调用重新确认。">{error&&<Failure error={error} retry={load}/>}<div className="settings-list">{!data?<Loading/>:!data.permissions.length?<p className="settings-description">暂无已保存的授权。</p>:data.permissions.map((grant:any)=><div className="settings-row" key={grant.id}><div><strong>{bots.find(bot=>bot.id===grant.botId)?.name??'已移除的成员'} · {grant.toolName}</strong><p className="settings-description">{grant.cwd}</p></div><button className="secondary" disabled={!!busy} onClick={()=>{setBusy(grant.id);setError('');void api.revokeToolPermission({id:grant.id}).then(setData).catch(e=>setError(explain(e))).finally(()=>setBusy(''));}}>撤销授权</button></div>)}</div></Section>;
}
