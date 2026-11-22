import {stageStatus} from '../../src/protocol/conversation-work';
import {useEffect,useRef,useState,type ReactNode} from "react";
import {Alert,Pressable,ScrollView,StyleSheet,Text,TextInput,View} from "react-native";
import {activityStateLabels} from "../../src/protocol/activity-records";
import {MAX_REVIEW_LINES,type ArtifactReviewNote,type ArtifactReviewView} from "../../src/protocol/artifact-review";
import {planReviewPreset} from "../../src/protocol/member-presets";
import {nextRoutineAt,type RoutineSchedule} from "../../src/protocol/routine-calendar";
import type {PluginCommandChoice,PluginPreview,PluginRegistryView} from "../../src/protocol/plugins";

type Colors={bg:string;panel:string;text:string;muted:string;green:string;line:string;user:string};
type Call=(method:string,input?:Record<string,unknown>)=>Promise<any>;
export type ToolProps={colors:Colors;call:Call;mutate:Call;disabled:boolean};
type Person={id:string;name:string};
type Failure={message?:string};
const message=(error:unknown)=>error instanceof Error?error.message:String(error);
const flags:Record<string,string>={unassigned:"待派发",missed:"错过，未补跑",overlap:"上次未结束，已跳过",enqueued:"等待执行",
 mobile_method_forbidden:"请更新已配对电脑上的 KTeam。",mobile_operation_unknown:"结果仍待核对，请保留当前操作并重试核对。",
 routine_run_active:"已有运行尚未结束。",routine_result_needs_review:"请先核对上次运行结果。",
 routine_scope_changed:"成员或会话范围已变化，请重新读取并保存。",routine_room_paused:"请先恢复会话工作。",
 routine_changed:"任务已更新，请重新读取。",artifact_review_changed:"产物版本已经变化。",plugin_changed:"插件已更新，请重新读取。"};
const label=(value:string)=>flags[value]??activityStateLabels[value]??value;
const zone=Intl.DateTimeFormat().resolvedOptions().timeZone;
const formatTime=(at:number,timeZone=zone)=>new Intl.DateTimeFormat("zh-CN",{timeZone,dateStyle:"short",timeStyle:"short"}).format(at);
const localInput=(at:number)=>{
 const date=new Date(at-dateOffset(at));
 return date.toISOString().slice(0,16);
};
const dateOffset=(at:number)=>new Date(at).getTimezoneOffset()*60000;

export function ToolButton({colors,children,onPress,disabled=false}:{colors:Colors;children:string;onPress:()=>void;disabled?:boolean}){
 return <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled} style={[styles.button,{borderColor:colors.line,backgroundColor:colors.panel,opacity:disabled?.46:1}]}>
  <Text style={{color:colors.text,fontSize:14}}>{children}</Text>
 </Pressable>;
}

function Body({colors,children}:{colors:Colors;children:ReactNode}){
 return <Text style={[styles.body,{color:colors.text}]}>{children}</Text>;
}

function Card({colors,children}:{colors:Colors;children:ReactNode}){
 return <View style={[styles.card,{borderColor:colors.line,backgroundColor:colors.panel}]}>{children}</View>;
}

function Field({colors,title,value,onChange,maxLength=80,multiline=false}:{colors:Colors;title:string;value:string;onChange:(value:string)=>void;maxLength?:number;multiline?:boolean}){
 return <View style={styles.field}>
  <Body colors={colors}>{title}</Body>
  <TextInput accessibilityLabel={title} value={value} onChangeText={onChange} maxLength={maxLength} multiline={multiline}
   autoCapitalize="none" style={[styles.input,{color:colors.text,borderColor:colors.line,backgroundColor:colors.bg,minHeight:multiline?76:44}]}/>
 </View>;
}

function useRead<T>(call:Call,method:string,roomId?:string,jobId?:string){
 const [data,setData]=useState<T>(),[error,setError]=useState(""),[version,update]=useState(0);
 useEffect(()=>{
  let live=true;
  setError("");
  void call(method,{...(roomId?{roomId}:{}),...(jobId?{jobId}:{})})
   .then(value=>{if(live)setData(value);})
   .catch(cause=>{if(live){setData(undefined);setError(message(cause));}});
  return ()=>{live=false;};
 },[call,method,roomId,jobId,version]);
 return {data,error,reload:()=>update(value=>value+1)};
}

function useMutation(){
 const [busy,setBusy]=useState(false),[error,setError]=useState("");
 const active=useRef(false);
 async function run(action:()=>Promise<void>){
  if(active.current)return;
  active.current=true;setBusy(true);setError("");
  try{await action();}catch(cause){setError(message(cause));}finally{active.current=false;setBusy(false);}
 }
 return {busy,error,run};
}

function Feedback({colors,state}:{colors:Colors;state:Failure}){
 return state.message?<Text accessibilityRole="alert" style={[styles.body,{color:colors.text}]}>{label(state.message)}</Text>:null;
}

type WorkDetail={work:{
 groupPlan?:{ownerId:string;stages:{dependsOn?:number;doneWhen:string;witness?:string;review?:{decision:string;note?:string;revision:number};requests:{botId:string;state:string;deliverable:string;evidence?:{messageId:string}}[]}[]};
 workEvidence?:({id:string;kind:"file";path:string;operation:"write"|"edit";beforeSha256?:string|null;afterSha256?:string}|{id:string;kind:"command";exitCode:number|null})[];
 workEvidenceLimited?:boolean;peerReviewVersion?:string;peerReviewStale?:boolean;
}};
export function WorkListPanel({colors,call,roomId,onOpen}:ToolProps&{roomId:string;onOpen:(id:string)=>void}){
 type Row={id:string;createdAt:string;state:string;groupPlanAvailable:boolean;workEvidenceAvailable:boolean;peerReviewVersion?:string};
 const [rows,setRows]=useState<Row[]>([]),[cursor,setCursor]=useState<number>(),[loaded,setLoaded]=useState(false),[initialError,setInitialError]=useState("");
 const pending=useMutation();
 const load=async(before?:number)=>{
  const result=await call("work.list",{roomId,...(before===undefined?{}:{before})});
  setRows(previous=>before===undefined?result.jobs:[...previous,...result.jobs]);
  setCursor(result.nextBefore);setLoaded(true);setInitialError("");
 };
 useEffect(()=>{let live=true;void call("work.list",{roomId}).then(result=>{if(live){setRows(result.jobs);setCursor(result.nextBefore);setLoaded(true);}})
  .catch(error=>{if(live){setInitialError(message(error));setLoaded(true);}});return()=>{live=false;};},[call,roomId]);
 return <ScrollView contentContainerStyle={styles.page}>
  <Feedback colors={colors} state={{message:pending.error||initialError}}/>
  <ToolButton colors={colors} disabled={pending.busy} onPress={()=>void pending.run(()=>load())}>刷新工作记录</ToolButton>
  {!rows.length&&!initialError&&!pending.error&&<Body colors={colors}>{loaded?"这一页暂无计划或变更记录。":"正在读取工作记录…"}</Body>}
  {rows.map(row=><Card colors={colors} key={row.id}>
   <Body colors={colors}>{row.createdAt?formatTime(Date.parse(row.createdAt)):"原工作"} · {label(row.state)}</Body>
   <ToolButton colors={colors} onPress={()=>onOpen(row.id)}>{row.groupPlanAvailable?"查看群计划":row.peerReviewVersion?"查看复核记录":"查看本轮变更"}</ToolButton>
  </Card>)}
  {cursor!==undefined&&<ToolButton colors={colors} disabled={pending.busy} onPress={()=>void pending.run(()=>load(cursor))}>读取更早工作</ToolButton>}
 </ScrollView>;
}
export function WorkDetailPanel({colors,call,mutate,disabled,roomId,jobId,bots}:ToolProps&{roomId:string;jobId:string;bots:Person[]}){
 const read=useRead<WorkDetail>(call,"work.detail",roomId,jobId);
 const work=read.data?.work;
 const [detail,setDetail]=useState(''),[reviewError,setReviewError]=useState(''),[busy,setBusy]=useState(false),[notes,setNotes]=useState<Record<number,string>>({});
 async function run(action:()=>Promise<void>){setReviewError('');setBusy(true);try{await action();}catch(error){setReviewError(message(error));}finally{setBusy(false);}}
 function review(stage:NonNullable<WorkDetail["work"]["groupPlan"]>["stages"][number],index:number,decision:'pass'|'rework'){
  return run(async()=>{await mutate('work.stageReview',{roomId,jobId,index,decision,witness:stage.witness,expectedRevision:stage.review?.revision??0,...(decision==='rework'?{note:notes[index]?.trim()}:{})});read.reload();});
 }
 const name=(id:string)=>bots.find(person=>person.id===id)?.name??"原成员";
 return <ScrollView contentContainerStyle={styles.page}>
  <ToolButton colors={colors} onPress={read.reload}>刷新工作记录</ToolButton>
  <Feedback colors={colors} state={{message:read.error}}/>
  {!work&&!read.error&&<Body colors={colors}>正在读取原工作…</Body>}
  {!!reviewError&&<Feedback colors={colors} state={{message:reviewError}}/>}
  {!!detail&&<Card colors={colors}><ToolButton colors={colors} onPress={()=>setDetail('')}>关闭证据</ToolButton><Text selectable style={{color:colors.text}}>{detail}</Text></Card>}
  {work?.groupPlan&&<Card colors={colors}>
   <Text style={[styles.title,{color:colors.text}]}>群计划 · {name(work.groupPlan.ownerId)} 负责</Text>
   {work.groupPlan.stages.map((stage,index)=><View key={index} style={styles.section}>
    <Body colors={colors}>阶段 {index+1} · {stageStatus(stage)} · {stage.dependsOn?`依赖阶段 ${stage.dependsOn}`:"可先开始"}{stage.requests.length>1?" · 可并行":""}</Body>
    {stage.requests.map(item=><View key={item.botId}>
     <Text style={{color:colors.green,fontWeight:"600"}}>{name(item.botId)} · {label(item.state)}</Text>
     <Body colors={colors}>{item.deliverable}</Body>
     {item.evidence&&<ToolButton colors={colors} disabled={busy} onPress={()=>void run(async()=>setDetail((await call('work.stageEvidence',{roomId,jobId,index,botId:item.botId})).text))}>查看交付证据</ToolButton>}
    </View>)}
    <Body colors={colors}>验收条件 · {stage.doneWhen}</Body>
    {!!stage.review?.note&&<Body colors={colors}>{stage.review.note}</Body>}
    {stage.witness&&<>
     <ToolButton colors={colors} disabled={disabled||busy||stage.review?.decision==='pass'} onPress={()=>void review(stage,index,'pass')}>验收通过</ToolButton>
     <TextInput accessibilityLabel="返工原因" placeholder="返工原因" placeholderTextColor={colors.muted} maxLength={1200} value={notes[index]??''} onChangeText={text=>setNotes(value=>({...value,[index]:text}))} style={{padding:8,color:colors.text,borderWidth:1,borderColor:colors.line}}/>
     <ToolButton colors={colors} disabled={disabled||busy||!notes[index]?.trim()} onPress={()=>void review(stage,index,'rework')}>标记返工</ToolButton>
    </>}
   </View>)}
  </Card>}
  {!!work?.workEvidence?.length&&<Card colors={colors}>
   <Text style={[styles.title,{color:colors.text}]}>本轮变更与检查</Text>
   {work.workEvidence.map(item=><Body key={item.id} colors={colors}>{item.kind==="file"
    ?`${item.operation==="edit"?"编辑":item.beforeSha256===null?"新增":item.beforeSha256?"覆盖":"写入"} · ${item.path}${item.afterSha256?" · "+item.afterSha256.slice(0,12):""}`
    :`终端退出 · ${item.exitCode??"未确认"}`}</Body>)}
   <Text style={{color:colors.muted}}>{work.workEvidenceLimited?"仅显示最近 40 条。":""}记录范围为内置运行时已观测的文件写入与命令退出。</Text>
  </Card>}
  {work?.peerReviewVersion&&<Card colors={colors}>
   <Body colors={colors}>{work.peerReviewStale?"产物已更新，复核仅适用于旧版":"版本化只读复核"} · {work.peerReviewVersion.slice(0,12)}</Body>
  </Card>}
 </ScrollView>;
}

export function ArtifactReviewActions({colors,mutate,disabled,roomId,toolCallId,view,onRefresh}:ToolProps&{
 roomId:string;toolCallId:string;view:ArtifactReviewView;onRefresh:()=>void;
}){
 const edit=useMutation();
 const [choice,setChoice]=useState<"peer"|"notes">(),[requested,setRequested]=useState("");
 const [start,setStart]=useState(""),[end,setEnd]=useState(""),[note,setNote]=useState(""),[notes,setNotes]=useState<ArtifactReviewNote[]>([]);
 const scope={roomId,toolCallId,expectedSha256:view.sha256};
 const stop=disabled||edit.busy||view.historical;
 const selectable=view.lines.reduce((max,line)=>Math.max(max,line.after??0),0);
 const from=Number(start),to=end?Number(end):from;
 const canAdd=Number.isSafeInteger(from)&&Number.isSafeInteger(to)&&from>0&&to>=from&&to-from<20&&to<=Math.min(MAX_REVIEW_LINES,selectable)&&!!note.trim()&&notes.length<8;
 return <View style={styles.section}>
  <View style={styles.actions}>
   {!!view.peerReviewers?.length&&<ToolButton colors={colors} disabled={stop} onPress={()=>setChoice(choice==="peer"?undefined:"peer")}>请另一位成员复核</ToolButton>}
   {!view.decision&&!view.historical&&<ToolButton colors={colors} disabled={stop} onPress={()=>setChoice(choice==="notes"?undefined:"notes")}>验收或提交意见</ToolButton>}
  </View>
  {requested?<Body colors={colors}>已请 {requested} 复核，意见会回到原会话。</Body>:null}
  {view.decision&&<Body colors={colors}>{view.decision.status==="accepted"?"当前版本已验收":view.decision.status==="preparing"?"发送结果待核对":"返工意见 · "+label(view.decision.status)}</Body>}
  <Feedback colors={colors} state={{message:edit.error}}/>
  {choice==="peer"&&<View style={styles.actions}>
   {(view.peerReviewers??[]).map(bot=><ToolButton key={bot.id} colors={colors} disabled={stop} onPress={()=>Alert.alert("发起只读复核",`把当前版本交给 ${bot.name} 复核？`,[
    {text:"取消",style:"cancel"},
    {text:"发送",onPress:()=>void edit.run(async()=>{await mutate("artifacts.peerReview",{...scope,botId:bot.id});setRequested(bot.name);setChoice(undefined);})},
   ])}>{bot.name}</ToolButton>)}
  </View>}
  {choice==="notes"&&!view.decision&&<View style={styles.section}>
   <View style={styles.actions}>
    <Field colors={colors} title="起始行" value={start} onChange={setStart} maxLength={4}/>
    <Field colors={colors} title="结束行（可选）" value={end} onChange={setEnd} maxLength={4}/>
   </View>
   <Field colors={colors} title="审阅意见" value={note} onChange={setNote} maxLength={400}/>
   {notes.map((item,index)=><View key={index} style={styles.actions}>
    <Body colors={colors}>{item.start}–{item.end} 行 · {item.text}</Body>
    <ToolButton colors={colors} disabled={stop} onPress={()=>setNotes(value=>value.filter((_,offset)=>offset!==index))}>移除此条</ToolButton>
   </View>)}
   <View style={styles.actions}>
    <ToolButton colors={colors} disabled={stop||!canAdd} onPress={()=>{setNotes(value=>[...value,{start:from,end:to,text:note.trim()}]);setNote("");}}>加入意见</ToolButton>
    <ToolButton colors={colors} disabled={stop||(!notes.length&&!canAdd)} onPress={()=>void edit.run(async()=>{
     await mutate("artifacts.reviewDecision",{...scope,action:"request_changes",notes:canAdd?[...notes,{start:from,end:to,text:note.trim()}]:notes});setChoice(undefined);onRefresh();
    })}>提交返工意见</ToolButton>
    <ToolButton colors={colors} disabled={stop||!!notes.length||!!note.trim()} onPress={()=>Alert.alert("验收当前版本","确认接受这个产物版本？",[
     {text:"取消",style:"cancel"},{text:"确认验收",onPress:()=>void edit.run(async()=>{await mutate("artifacts.reviewDecision",{...scope,action:"accept",notes:[]});setChoice(undefined);onRefresh();})},
    ])}>验收当前版本</ToolButton>
   </View>
  </View>}
 </View>;
}

type Routine={id:string;revision:number;name:string;botId:string;prompt:string;schedule:RoutineSchedule;timeZone:string;maxRuns:number;runCount:number;endAt:number|null;enabled:boolean;nextAt:number|null;needsReview:boolean;reason?:string;lastError?:string;runs:{id:string;trial:boolean;state:string;scheduledAt:number;observedAt?:number;resultMessageIds:string[]}[]};
type Draft={id?:string;revision:number;name:string;botId:string;prompt:string;kind:RoutineSchedule["kind"];at:string;time:string;weekdays:number[];minutes:string;maxRuns:string;timeZone:string;end:string;enabled:boolean};
function toDraft(row:Routine|undefined,botId:string):Draft{
 const schedule=row?.schedule;
 const ended=schedule?.kind==="once"&&!!row?.runCount;
 const at=!ended&&(schedule?.kind==="once"?schedule.at:schedule?.kind==="interval"?schedule.startAt:0);
 return {
  id:ended?undefined:row?.id,revision:ended?0:row?.revision??0,name:row?.name??"",botId:row?.botId??botId,prompt:row?.prompt??"",
  kind:schedule?.kind??"daily",at:localInput(at||Date.now()+3600000),time:schedule?.kind==="daily"?schedule.time:"09:00",
  weekdays:schedule?.kind==="daily"?schedule.weekdays:[1,2,3,4,5],minutes:String(schedule?.kind==="interval"?schedule.minutes:60),
  maxRuns:String(row?.maxRuns??30),timeZone:row?.timeZone??zone,end:row?.endAt&&!ended?localInput(row.endAt):"",enabled:ended||row?.enabled!==false,
 };
}

export function RoutinesPanel({colors,call,mutate,disabled,roomId,onResult}:ToolProps&{roomId:string;onResult:(id:string)=>void}){
 const read=useRead<{items:Routine[];candidates:Person[]}>(call,"routines.list",roomId);
 const write=useMutation();
 const [draft,setDraft]=useState<Draft>(),[trial,setTrial]=useState("");
 const [history,setHistory]=useState<string>();
 const stop=disabled||write.busy;
 const candidates=read.data?.candidates??[];
 const patch=(diff:Partial<Draft>)=>setDraft(value=>value?{...value,...diff}:value);
 const done=async(method:string,input:Record<string,unknown>)=>{await mutate(method,{roomId,...input});read.reload();};
 function payload(value:Draft){
  const schedule:RoutineSchedule=value.kind==="daily"?{kind:value.kind,time:value.time,weekdays:value.weekdays}:value.kind==="once"
   ?{kind:value.kind,at:new Date(value.at).getTime()}:{kind:value.kind,startAt:new Date(value.at).getTime(),minutes:Number(value.minutes)};
  const timeZone=new Intl.DateTimeFormat("en",{timeZone:value.kind==="daily"?value.timeZone:zone}).resolvedOptions().timeZone;
  const endAt=value.end?new Date(value.end).getTime():null;
  if(endAt!==null&&!Number.isFinite(endAt))throw Error("结束时间格式无效");
  return {id:value.id,expectedRevision:value.revision,name:value.name,prompt:value.prompt,botId:value.botId,
   schedule,timeZone,endAt,maxRuns:value.kind==="once"?1:Number(value.maxRuns),enabled:value.enabled,overlap:"skip"};
 }
 let next:number|null=null;
 if(draft){try{const value=payload(draft);next=nextRoutineAt(value.schedule,value.timeZone,Date.now(),value.endAt??undefined);}catch{/* incomplete draft */}}
 return <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
  <Feedback colors={colors} state={{message:read.error||write.error}}/>
  {!draft&&<View style={styles.actions}>
   <ToolButton colors={colors} disabled={stop||!candidates.length} onPress={()=>setDraft(toDraft(undefined,candidates[0].id))}>添加例行任务</ToolButton>
   <ToolButton colors={colors} onPress={read.reload}>刷新</ToolButton>
  </View>}
  {!read.data&&!read.error&&<Body colors={colors}>正在读取例行任务…</Body>}
  {read.data&&!read.data.items.length&&!draft&&<Body colors={colors}>这个会话还没有例行任务。</Body>}
  {draft&&<Card colors={colors}>
   <Field colors={colors} title="任务名称" value={draft.name} onChange={name=>patch({name})}/>
   <Body colors={colors}>交给谁 · {candidates.find(person=>person.id===draft.botId)?.name??"请选择成员"}</Body>
   <View style={styles.actions}>{candidates.map(person=><ToolButton key={person.id} colors={colors} disabled={stop} onPress={()=>patch({botId:person.id})}>{person.name}</ToolButton>)}</View>
   <Field colors={colors} title="每次要做什么" value={draft.prompt} onChange={prompt=>patch({prompt})} maxLength={8192} multiline/>
   <View style={styles.actions}>{([["daily","每周指定日"],["once","只执行一次"],["interval","固定间隔"]] as const).map(([kind,title])=><ToolButton key={kind} colors={colors} disabled={stop||draft.kind===kind} onPress={()=>patch({kind})}>{title}</ToolButton>)}</View>
   {draft.kind==="daily"?<>
    <Field colors={colors} title="时间（HH:mm）" value={draft.time} onChange={time=>patch({time})} maxLength={5}/>
    <Field colors={colors} title="时区" value={draft.timeZone} onChange={timeZone=>patch({timeZone})} maxLength={64}/>
    <View style={styles.actions}>{[1,2,3,4,5,6,7].map(day=><ToolButton key={day} colors={colors} disabled={stop} onPress={()=>patch({weekdays:draft.weekdays.includes(day)?draft.weekdays.filter(item=>item!==day):[...draft.weekdays,day]})}>
     {(draft.weekdays.includes(day)?"✓ ":"")+"周"+"一二三四五六日"[day-1]}
    </ToolButton>)}</View>
   </>:<Field colors={colors} title="首次执行（YYYY-MM-DDTHH:mm）" value={draft.at} onChange={at=>patch({at})} maxLength={16}/>}
   {draft.kind==="interval"&&<Field colors={colors} title="间隔分钟" value={draft.minutes} onChange={minutes=>patch({minutes})} maxLength={5}/>}
   {draft.kind!=="once"&&<Field colors={colors} title="最多触发次数" value={draft.maxRuns} onChange={maxRuns=>patch({maxRuns})} maxLength={3}/>}
   <Field colors={colors} title="结束时间（可选，YYYY-MM-DDTHH:mm）" value={draft.end} onChange={end=>patch({end})} maxLength={16}/>
   {next!==null&&<Body colors={colors}>启用后下一期 · {formatTime(next,draft.kind==="daily"?draft.timeZone:zone)}</Body>}
   <View style={styles.actions}>
    <ToolButton colors={colors} disabled={stop} onPress={()=>patch({enabled:!draft.enabled})}>{draft.enabled?"启用定时触发":"保存为暂停"}</ToolButton>
    <ToolButton colors={colors} disabled={stop||!draft.name.trim()||!draft.prompt.trim()||!draft.botId} onPress={()=>void write.run(async()=>{await done("routines.save",payload(draft));setDraft(undefined);})}>保存</ToolButton>
    <ToolButton colors={colors} disabled={stop} onPress={()=>setDraft(undefined)}>取消</ToolButton>
   </View>
  </Card>}
  {!draft&&read.data?.items.map(row=><Card colors={colors} key={row.id}>
   <Text style={[styles.title,{color:colors.text}]}>{row.name}</Text>
   <Body colors={colors}>{row.needsReview?"结果待核对":row.enabled?row.nextAt?"下次 · "+formatTime(row.nextAt,row.timeZone):"后续触发已结束":"已暂停"} · 已触发 {row.runCount}/{row.maxRuns} 次</Body>
   {row.lastError&&<Feedback colors={colors} state={{message:row.lastError}}/>}
   {trial===row.id&&<Body colors={colors}>已提交试运行。结果会回到本会话。</Body>}
   <View style={styles.actions}>
    <ToolButton colors={colors} disabled={stop||row.needsReview||row.runs.some(run=>["queued","held","routing","running","waiting","stopping","paused","enqueued"].includes(run.state))}
     onPress={()=>void write.run(async()=>{await done("routines.trial",{id:row.id,expectedRevision:row.revision});setTrial(row.id);setHistory(row.id);})}>试运行一次</ToolButton>
    <ToolButton colors={colors} disabled={stop} onPress={()=>setDraft(toDraft(row,candidates[0]?.id??""))}>{row.schedule.kind==="once"&&row.runCount>0?"再次安排":"编辑"}</ToolButton>
    {row.enabled&&row.nextAt!==null&&<ToolButton colors={colors} disabled={stop} onPress={()=>void write.run(()=>done("routines.pause",{id:row.id,expectedRevision:row.revision}))}>暂停</ToolButton>}
    {!row.enabled&&!(row.schedule.kind==="once"&&row.runCount>0)&&<ToolButton colors={colors} disabled={stop} onPress={()=>setDraft({...toDraft(row,""),enabled:true})}>重新安排并启用</ToolButton>}
    <ToolButton colors={colors} disabled={stop} onPress={()=>Alert.alert("移除例行任务",row.name,[
     {text:"取消",style:"cancel"},{text:"移除",style:"destructive",onPress:()=>void write.run(()=>done("routines.remove",{id:row.id,expectedRevision:row.revision}))},
    ])}>移除</ToolButton>
    <ToolButton colors={colors} onPress={()=>setHistory(history===row.id?undefined:row.id)}>{history===row.id?"收起历史":"运行历史"}</ToolButton>
   </View>
   {history===row.id&&(row.runs.length?row.runs.map(run=><View key={run.id} style={styles.section}>
    <Body colors={colors}>{run.trial?"试运行 · ":""}{formatTime(run.scheduledAt,row.timeZone)} · {label(run.state)}</Body>
    {run.state==="missed"&&run.observedAt&&<Body colors={colors}>恢复检查 · {formatTime(run.observedAt,row.timeZone)}</Body>}
    {run.resultMessageIds.map(id=><ToolButton key={id} colors={colors} onPress={()=>onResult(id)}>查看原答复</ToolButton>)}
   </View>):<Body colors={colors}>还没有运行记录。</Body>)}
  </Card>)}
 </ScrollView>;
}

export function PluginsPanel({colors,call,mutate,disabled}:ToolProps){
 const read=useRead<PluginRegistryView>(call,"plugins.list");
 const write=useMutation();
 const [raw,setRaw]=useState(""),[preview,setPreview]=useState<PluginPreview>();
 const stop=disabled||write.busy;
 return <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
  <Feedback colors={colors} state={{message:read.error||write.error}}/>
  <Field colors={colors} title="插件清单 JSON" value={raw} onChange={value=>{setRaw(value);setPreview(undefined);}} maxLength={491520} multiline/>
  <View style={styles.actions}>
   <ToolButton colors={colors} disabled={stop||!raw.trim()} onPress={()=>void write.run(async()=>setPreview(await call("plugins.preview",{manifest:JSON.parse(raw)})))}>预览清单</ToolButton>
   <ToolButton colors={colors} onPress={read.reload}>刷新列表</ToolButton>
  </View>
  {preview&&<Card colors={colors}>
   <Body colors={colors}>{preview.manifest.name} · {preview.manifest.version}</Body>
   {preview.manifest.contributes.commands.map(command=><View key={command.id}><Text style={{color:colors.green,fontWeight:"600"}}>{command.title}</Text><Body colors={colors}>{command.draft}</Body></View>)}
   <ToolButton colors={colors} disabled={stop} onPress={()=>void write.run(async()=>{
    await mutate("plugins.install",{manifest:preview.manifest,expectedRevision:preview.revision,expectedDigest:preview.digest});setPreview(undefined);setRaw("");read.reload();
   })}>确认安装</ToolButton>
  </Card>}
  {read.data?.plugins.map(plugin=><Card key={plugin.manifest.id} colors={colors}>
   <Body colors={colors}>{plugin.manifest.name} · {plugin.manifest.version} · {plugin.enabled?"已启用":"未启用"}</Body>
   <View style={styles.actions}>
    <ToolButton colors={colors} disabled={stop} onPress={()=>void write.run(async()=>{await mutate("plugins.change",{id:plugin.manifest.id,action:plugin.enabled?"disable":"enable",expectedRevision:read.data?.revision});read.reload();})}>{plugin.enabled?"停用":"启用"}</ToolButton>
    <ToolButton colors={colors} disabled={stop} onPress={()=>Alert.alert("移除插件",plugin.manifest.name,[
     {text:"取消",style:"cancel"},{text:"移除",style:"destructive",onPress:()=>void write.run(async()=>{await mutate("plugins.change",{id:plugin.manifest.id,action:"remove",expectedRevision:read.data?.revision});read.reload();})},
    ])}>移除</ToolButton>
   </View>
  </Card>)}
 </ScrollView>;
}

export function PluginCommandsPanel({colors,call,disabled,onDraft}:ToolProps&{onDraft:(draft:string)=>void}){
 const read=useRead<{commands:PluginCommandChoice[]}>(call,"plugins.commands");
 const write=useMutation();
 return <ScrollView contentContainerStyle={styles.page}>
  <Feedback colors={colors} state={{message:read.error||write.error}}/>
  {read.data?.commands.length===0&&<Body colors={colors}>请先在「我 → 插件」启用命令。</Body>}
  {read.data?.commands.map(command=><ToolButton key={command.pluginId+":"+command.commandId} colors={colors} disabled={disabled||write.busy}
   onPress={()=>void write.run(async()=>{const {draft}=await call("plugins.draft",{pluginId:command.pluginId,commandId:command.commandId,revision:command.revision});onDraft(draft);})}>
   {command.pluginName+" · "+command.title}
  </ToolButton>)}
 </ScrollView>;
}

export function MemberPanel({colors,call,mutate,disabled,onCreated}:ToolProps&{onCreated:(result:{roomId:string;bot:Person;presetId?:string})=>void}){
 const read=useRead<{models:{id:string;label:string}[];defaultModelId:string}>(call,"members.models");
 const write=useMutation();
 const [name,setName]=useState(""),[description,setDescription]=useState(planReviewPreset.description as string);
 const [instructions,setInstructions]=useState(planReviewPreset.instructions),[preset,setPreset]=useState(true);
 const [chosenModel,setModel]=useState("");
 const modelId=chosenModel||read.data?.defaultModelId||read.data?.models[0]?.id;
 return <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
  <Feedback colors={colors} state={{message:read.error||write.error}}/>
  <View style={styles.actions}>
   <ToolButton colors={colors} disabled={write.busy||!preset} onPress={()=>setPreset(false)}>自定义成员</ToolButton>
   <ToolButton colors={colors} disabled={write.busy||preset} onPress={()=>setPreset(true)}>方案评审</ToolButton>
  </View>
  <Field colors={colors} title="名字" value={name} onChange={setName}/>
  {preset&&<>
   <Field colors={colors} title="职责简介" value={description} onChange={setDescription} maxLength={512}/>
   <Field colors={colors} title="评审要求" value={instructions} onChange={setInstructions} maxLength={8192} multiline/>
  </>}
  <Body colors={colors}>模型 · {read.data?.models.find(model=>model.id===modelId)?.label??"请先在电脑配置模型"}</Body>
  <View style={styles.actions}>{read.data?.models.map(model=><ToolButton key={model.id} colors={colors} disabled={write.busy||model.id===modelId} onPress={()=>setModel(model.id)}>{model.label}</ToolButton>)}</View>
  <ToolButton colors={colors} disabled={disabled||write.busy||!modelId||!name.trim()||(preset&&(!description.trim()||!instructions.trim()))}
   onPress={()=>void write.run(async()=>onCreated(await mutate("members.create",{name,modelId,
    ...(preset?{setup:{presetId:planReviewPreset.id,description,instructions}}:{})})))}>
   创建并开聊
  </ToolButton>
 </ScrollView>;
}

const styles=StyleSheet.create({
 page:{padding:16,gap:12},
 section:{gap:8,marginVertical:6},
 card:{gap:8,padding:12,borderWidth:1,borderRadius:12},
 title:{fontSize:16,fontWeight:"600"},
 body:{fontSize:14,lineHeight:21},
 button:{alignSelf:"flex-start",borderWidth:1,borderRadius:10,paddingHorizontal:11,paddingVertical:10,minHeight:40},
 actions:{flexDirection:"row",flexWrap:"wrap",gap:8,alignItems:"center"},
 field:{gap:5,minWidth:110},
 input:{fontSize:15,borderWidth:1,borderRadius:9,padding:9,textAlignVertical:"top"},
});
