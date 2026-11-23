import {useEffect,useRef,useState} from "react";
import {Linking,Pressable,ScrollView,StyleSheet,Text,TextInput,View} from "react-native";
import {AssistantWatches} from "./assistant-watch";
import * as Clipboard from "expo-clipboard";
import {ToolButton,type ToolProps} from "./conversation-tools";
import {dailyBriefDeliveryLabels,type DailyBriefDelivery,dailySlots,dailySlotLabels as labels,dailyPresetIds,dailyPresets,type DailyPreset,type DailySlot as Slot,type DailyChange,type DailyConfiguration,type DailyCoverage,type DailyItem,type DailySource} from "../../src/protocol/assistant-daily-types";

type Draft={id:string;previousRevision:number;config:DailyConfiguration;change:DailyChange;preset?:DailyPreset};
type Plan={config:DailyConfiguration|null;draft?:Draft;revision:number;next?:{slot:Slot;next:number}};
type Today=Plan&{items:DailyItem[];coverage:DailyCoverage[];briefs:{id:string;slot:Slot;day:string;items:DailyItem[];coverage:DailyCoverage[];missed?:boolean;delivery?:DailyBriefDelivery}[]};
type RoomTarget={roomId:string;title:string;kind?:string};
const sourceLabel:Record<DailySource["kind"],string>={mail:"邮件","yzj-message":"云之家消息","yzj-calendar":"云之家日程","yzj-doc":"云之家知识库",news:"公开资讯"};
const states:Record<DailyCoverage["state"],string>={ok:"已核对",partial:"覆盖不完整",unavailable:"暂不可用"};
const errors:Record<string,string>={
 mobile_method_forbidden:"请更新配对电脑上的 KTeam。",
 mobile_operation_unknown:"操作结果待核对。请保留原操作并重试。",
 daily_plan_changed:"方案已更新，请重新核对。",
 daily_source_unavailable:"这个事项的来源暂不可用。",
 daily_source_changed:"来源或账户已变化，请重新选择。",
 daily_reply_context_unavailable:"原消息内容不足，请到原会话核对。",
 daily_reply_model_unavailable:"请先为小 K 绑定可用模型。",
};
const errorText=(value:unknown)=>value instanceof Error?errors[value.message]??value.message:String(value);
const sourceKey=(source:DailySource)=>JSON.stringify([source.kind,source.account,source.id]);
const clock=(at:number,timeZone?:string)=>new Intl.DateTimeFormat("zh-CN",{timeZone,dateStyle:"short",timeStyle:"short"}).format(at);
const schedule=(config:DailyConfiguration)=>config.paused?"每日工作已暂停":dailySlots.flatMap(slot=>config.schedule[slot]?[labels[slot]+" "+config.schedule[slot]]:[]).join(" · ")||"未设置简报时段";

function PlanCard({draft,previous,roomId,colors,call,mutate,disabled,onSaved,onChoose}:ToolProps&{
 draft:Draft;previous:DailyConfiguration|null;roomId:string;onSaved:()=>Promise<void>;onChoose:()=>void;
}){
 const [selected,setSelected]=useState(draft.config.sources);
 const [available,setAvailable]=useState<DailySource[]>([]);
 const [showSources,setShowSources]=useState(!draft.preset);
 const [topic,setTopic]=useState("");
 const [error,setError]=useState("");
 const [pending,setPending]=useState(false);
 const busy=useRef(false);
 const act=async(action:()=>Promise<void>)=>{
  if(busy.current||disabled)return;
  busy.current=true;
  setPending(true);
  setError("");
  try{await action();}catch(cause){setError(errorText(cause));}
  finally{busy.current=false;setPending(false);}
 };
 const discover=(yzj:boolean)=>void act(async()=>{
  const result=await call("dailyWork.sources",{roomId,yzj});
  const sources:DailySource[]=result.sources;
  setAvailable(current=>[...new Map([...current,...sources].map(source=>[sourceKey(source),source])).values()]);
  if(yzj&&!result.yzjAvailable)setError("云之家暂未连接，可先选择其他来源。");
  else if(!yzj&&!sources.length)setError("还没有连接邮箱。");
 });
 const visible=[...new Map([...selected,...available].map(source=>[sourceKey(source),source])).values()];
 return <View style={[styles.card,{borderColor:colors.line,backgroundColor:colors.panel}]}>
  <Text accessibilityRole="header" style={[styles.heading,{color:colors.text}]}>{draft.preset?dailyPresets[draft.preset].label:"每日工作方案"}</Text>
  {previous&&<Text style={{color:colors.muted}}>当前 · {schedule(previous)}</Text>}
  <Text style={{color:colors.text}}>确认后 · {schedule(draft.config)}</Text>
  <Text style={{color:colors.muted}}>{draft.config.timeZone} · 工作日 {draft.config.weekdays.join("、")}</Text>
  {draft.config.middayUrgentOnly&&<Text style={{color:colors.muted}}>午报只显示紧急事项</Text>}
  {!!draft.change.removeSourceKinds?.length&&<Text style={{color:colors.muted}}>停用后台读取 · {draft.change.removeSourceKinds.map(kind=>sourceLabel[kind]).join("、")}</Text>}
  {draft.change.skipToday&&<Text style={{color:colors.muted}}>今日跳过{labels[draft.change.skipToday]}</Text>}
  <Pressable accessibilityRole="button" accessibilityState={{expanded:showSources}} onPress={()=>setShowSources(open=>!open)} style={styles.check}>
   <Text style={{color:colors.text}}>读取来源 · {selected.length?"已选 "+selected.length+" 项":"尚未选择"} {showSources?"⌃":"⌄"}</Text>
  </Pressable>
  {showSources&&<>
  {visible.map(source=>{
   const key=sourceKey(source);
   const checked=selected.some(item=>sourceKey(item)===key&&item.revision===source.revision);
   return <Pressable key={key} disabled={pending||disabled} accessibilityRole="checkbox" accessibilityState={{checked}} onPress={()=>setSelected(values=>[...values.filter(item=>sourceKey(item)!==key),...(checked?[]:[source])])} style={styles.check}>
    <Text style={{color:colors.text}}>{checked?"✓ ":"○ "}{sourceLabel[source.kind]} · {source.label}</Text>
   </Pressable>;
  })}
  <View style={styles.actions}>
   <ToolButton colors={colors} disabled={pending||disabled} onPress={()=>discover(false)}>选择邮箱</ToolButton>
   <ToolButton colors={colors} disabled={pending||disabled} onPress={()=>discover(true)}>选择云之家来源</ToolButton>
  </View>
  <TextInput accessibilityLabel="可公开搜索的资讯关键词" placeholder="可公开搜索的资讯关键词" placeholderTextColor={colors.muted} maxLength={160} value={topic} onChangeText={setTopic} style={[styles.input,{color:colors.text,borderColor:colors.line}]}/>
  <View style={styles.actions}>
   <ToolButton colors={colors} disabled={pending||disabled||!topic.trim()} onPress={()=>void act(async()=>{
    const {source}=await call("dailyWork.news",{roomId,topic:topic.trim()});
    setSelected(values=>[...values.filter(item=>sourceKey(item)!==sourceKey(source)),source]);
    setTopic("");
   })}>添加订阅</ToolButton>
  </View>
  </>}
  <View style={styles.actions}>
   <ToolButton colors={colors} disabled={pending||disabled} onPress={onChoose}>换个方案</ToolButton>
   <ToolButton colors={colors} disabled={pending||disabled} onPress={()=>void act(async()=>{
    await mutate("dailyWork.confirm",{roomId,id:draft.id,expectedRevision:draft.previousRevision,sources:selected});
    await onSaved();
   })}>确认并应用</ToolButton>
  </View>
  {error&&<Text accessibilityRole="alert" style={{color:colors.text}}>{error}</Text>}
 </View>;
}

export function AssistantDailyPanel({roomId,rooms,onDraft,onAttention,...props}:ToolProps&{
 roomId:string;rooms:RoomTarget[];onDraft:(roomId:string,text:string)=>void;onAttention:()=>void;
}){
 const {colors,call,mutate,disabled}=props;
 const [plan,setPlan]=useState<Plan>();
 const [showChoices,setShowChoices]=useState(false);
 const [view,setView]=useState<Today>();
 const [error,setError]=useState("");
 const [pending,setPending]=useState(false);
 const [opened,setOpened]=useState<{subject:string;body:string}>();
 const [reply,setReply]=useState<{item:DailyItem;text?:string}>();
 const [watchReference,setWatchReference]=useState<string>();
 const [task,setTask]=useState<DailyItem>();
 const [expanded,setExpanded]=useState<string>();
 const busy=useRef(false);
 const lastId=useRef(0);
 const load=async()=>{
  const id=++lastId.current;
  const result:Today=await call("dailyWork.today",{roomId});
  if(id===lastId.current){setView(result);setPlan(result);}
 };
 useEffect(()=>{
  let active=true;
  if(disabled){setOpened(undefined);setReply(undefined);setTask(undefined);setView(undefined);setPlan(undefined);return;}
  void load().catch(cause=>{if(active)setError(errorText(cause));});
  const timer=setInterval(()=>{
   const request=lastId.current;
   void call("dailyWork.plan",{roomId}).then(next=>{
    if(active&&request===lastId.current)setPlan(current=>!current||next.revision>=current.revision?next:current);
   }).catch(()=>{});
  },3000);
  const verifySources=setInterval(()=>void load().catch(()=>{
   if(active){setView(undefined);setOpened(undefined);setReply(undefined);setTask(undefined);}
  }),30000);
  return ()=>{active=false;lastId.current++;clearInterval(timer);clearInterval(verifySources);};
 },[roomId,call,disabled]);
 const act=async(action:()=>Promise<void>)=>{
  if(busy.current||disabled)return;
  busy.current=true;
  setPending(true);
  setError("");
  try{await action();}catch(cause){setError(errorText(cause));}
  finally{busy.current=false;setPending(false);}
 };
 const tz=plan?.config?.timeZone;
 const items=(rows:DailyItem[],today=false)=>rows.map(item=><View key={item.id} style={[styles.card,{borderColor:colors.line,backgroundColor:colors.panel}]}>
  <Text style={[styles.heading,{color:colors.text}]}>{item.title}</Text>
  <Text style={{color:colors.muted}}>{item.source.label}{item.deadline?" · "+clock(item.deadline,tz):""}</Text>
  <Text style={{color:colors.text}}>{item.detail}</Text>
  <View style={styles.actions}>
   {(item.url||item.source.kind==="mail")&&<ToolButton colors={colors} disabled={disabled||pending} onPress={()=>void act(async()=>{
    const original=await call("dailyWork.original",{roomId,id:item.id});
    if(original.mail)setOpened(original.mail);
    else if(typeof original.url==="string"&&original.url.startsWith("https://"))await Linking.openURL(original.url);
    else setError("来源没有提供可打开的原文链接。");
   })}>看原文</ToolButton>}
   {(item.source.kind==="mail"||item.source.kind==="yzj-message"&&item.originalId)&&<ToolButton colors={colors} disabled={disabled||pending} onPress={()=>{setReply({item});setOpened(undefined);setTask(undefined);}}>准备回复</ToolButton>}
   {item.source.kind==="yzj-message"&&item.originalId&&<ToolButton colors={colors} disabled={disabled||pending} onPress={()=>setWatchReference(item.id)}>请小 K 盯这件事</ToolButton>}
   {!!rooms.length&&<ToolButton colors={colors} disabled={disabled||pending} onPress={()=>{setTask(item);setOpened(undefined);setReply(undefined);}}>转任务</ToolButton>}
   {today&&<ToolButton colors={colors} disabled={disabled||pending} onPress={()=>void act(async()=>setView(await mutate("dailyWork.snooze",{roomId,id:item.id})))}>一小时后再看</ToolButton>}
  </View>
 </View>);
 const coverage=(rows:DailyCoverage[])=>rows.map(row=><Text key={sourceKey(row.source)} style={{color:colors.muted}}>
  {row.source.label} · {states[row.state]}{row.checkedAt?" · "+clock(row.checkedAt,tz):""}{row.from?" · 起点 "+clock(row.from,tz):""}
 </Text>);
 return <ScrollView style={{flex:1}} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
  {error&&<Text accessibilityRole="alert" style={{color:colors.text}}>{error}</Text>}
  <AssistantWatches {...props} roomId={roomId} reference={watchReference} onClearReference={()=>setWatchReference(undefined)}/>
  {!plan&&!error&&<Text style={{color:colors.muted}}>正在读取每日工作…</Text>}
  {plan&&(showChoices||!plan.config&&!plan.draft)&&<View style={[styles.card,{borderColor:colors.line,backgroundColor:colors.panel}]}>
   <Text accessibilityRole="header" style={[styles.heading,{color:colors.text}]}>选一个简报安排</Text>
   {!plan.config&&<Text style={{color:colors.muted}}>默认在周一到周五运行。选好后可以添加读取来源。</Text>}
   {dailyPresetIds.map(preset=>{
    const choice=dailyPresets[preset],selected=plan.draft?.preset===preset;
    return <Pressable key={preset} accessibilityRole="button" accessibilityState={{selected,disabled:pending||disabled}} disabled={pending||disabled}
     style={[styles.choice,{borderColor:selected?colors.muted:colors.line}]}
     onPress={()=>void act(async()=>{
      try {
       const next=await mutate("dailyWork.preset",{roomId,preset,expectedRevision:plan.revision,expectedDraftId:plan.draft?.id??null});
       lastId.current++;
       setPlan(next);setShowChoices(false);
      }catch(cause){void load().catch(()=>{});throw cause;}
     })}>
     <View style={{flex:1}}><Text style={{color:colors.text,fontWeight:"600"}}>{choice.label}</Text><Text style={{color:colors.muted,marginTop:3}}>{choice.detail}</Text></View>
     <Text style={{color:colors.muted}}>{selected?"✓":"›"}</Text>
    </Pressable>;
   })}
   <View style={styles.actions}>
    {(plan.config||plan.draft)&&<ToolButton colors={colors} disabled={pending||disabled} onPress={()=>setShowChoices(false)}>{plan.draft?"返回待确认方案":"取消"}</ToolButton>}
    <ToolButton colors={colors} disabled={pending||disabled} onPress={()=>onDraft(roomId,"我想自定义每日工作。")}>在对话中自定义</ToolButton>
   </View>
  </View>}
  {!showChoices&&plan?.draft&&<PlanCard key={plan.draft.id} {...props} roomId={roomId} draft={plan.draft} previous={plan.config} onSaved={load} onChoose={()=>setShowChoices(true)}/>}
  {!showChoices&&plan?.config&&!plan.draft&&<View style={styles.actions}>
   <ToolButton colors={colors} disabled={disabled||pending} onPress={()=>void act(async()=>{
    const next=await mutate("dailyWork.preset",{roomId,preset:"sources",expectedRevision:plan.revision,expectedDraftId:null});
    lastId.current++;setPlan(next);
   })}>{plan.config.sources.length?"调整读取来源":"选择读取来源"}</ToolButton>
   <ToolButton colors={colors} disabled={disabled} onPress={()=>setShowChoices(true)}>更换简报安排</ToolButton>
   <ToolButton colors={colors} disabled={disabled} onPress={()=>onDraft(roomId,"我想自定义每日工作。")}>在对话中调整</ToolButton>
  </View>}
  {plan?.config&&<View style={[styles.card,{borderColor:colors.line}]}>
   <Text style={[styles.heading,{color:colors.text}]}>{schedule(plan.config)}</Text>
   {plan.next&&<Text style={{color:colors.muted}}>下次{labels[plan.next.slot]} {clock(plan.next.next,tz)}</Text>}
   <View style={styles.actions}><ToolButton colors={colors} disabled={disabled||pending||plan.config.paused} onPress={()=>void act(async()=>setView(await mutate("dailyWork.refresh",{roomId})))}>运行一次</ToolButton></View>
  </View>}
  {!!view?.coverage.length&&<View style={[styles.card,{borderColor:colors.line}]}>
   <Text style={[styles.heading,{color:colors.text}]}>来源覆盖</Text>{coverage(view.coverage)}
  </View>}
  {opened&&<View style={[styles.card,{borderColor:colors.line}]}>
   <Text style={[styles.heading,{color:colors.text}]}>{opened.subject}</Text><Text selectable style={{color:colors.text}}>{opened.body}</Text>
   <ToolButton colors={colors} onPress={()=>setOpened(undefined)}>关闭原文</ToolButton>
  </View>}
  {reply&&<View style={[styles.card,{borderColor:colors.line}]}>
   <Text style={[styles.heading,{color:colors.text}]}>回复草稿</Text>
   <Text style={{color:colors.muted}}>{reply.item.title} · {reply.item.source.label}</Text>
   {reply.text===undefined?<Text style={{color:colors.text}}>生成草稿时，会将裁剪后的当前消息交给小 K 绑定的模型处理。</Text>:
    <TextInput accessibilityLabel="编辑回复草稿" multiline value={reply.text} onChangeText={text=>setReply({...reply,text})} style={[styles.input,{color:colors.text,borderColor:colors.line,minHeight:80}]}/>}
   <View style={styles.actions}>
    <ToolButton colors={colors} disabled={pending} onPress={()=>setReply(undefined)}>关闭草稿</ToolButton>
    {reply.text===undefined?<ToolButton colors={colors} disabled={pending||disabled} onPress={()=>void act(async()=>{
     const result=await mutate("dailyWork.replyDraft",{roomId,id:reply.item.id,allowModel:true});
     setReply({...reply,text:result.text});
    })}>允许并生成草稿</ToolButton>:<ToolButton colors={colors} disabled={!reply.text.trim()} onPress={()=>void Clipboard.setStringAsync(reply.text!)}>复制草稿</ToolButton>}
   </View>
  </View>}
  {task&&<View style={[styles.card,{borderColor:colors.line}]}>
   <Text style={[styles.heading,{color:colors.text}]}>选择接手会话</Text>
   <Text style={{color:colors.muted}}>{task.title}</Text>
   {rooms.map(room=><ToolButton key={room.roomId} colors={colors} disabled={disabled} onPress={()=>onDraft(room.roomId,[
    "请跟进事项「"+task.title+"」。","来源："+sourceLabel[task.source.kind]+" · "+task.source.label,
    ...(task.url?[task.url]:[]),"完成时请回报可核对结果与仍待确认的事项。",
   ].join("\n"))}>{room.title}</ToolButton>)}
   <ToolButton colors={colors} onPress={()=>setTask(undefined)}>取消转任务</ToolButton>
  </View>}
  {!!view?.items.some(item=>item.urgent)&&<>
   <Text accessibilityRole="header" style={[styles.heading,{color:colors.text}]}>需要你处理</Text>
   {items(view.items.filter(item=>item.urgent),true)}
  </>}
  {!!view?.items.some(item=>!item.urgent)&&<>
   <Text accessibilityRole="header" style={[styles.heading,{color:colors.text}]}>接下来的安排和关注事项</Text>
   {items(view.items.filter(item=>!item.urgent),true)}
  </>}
  {!!view?.briefs.length&&<Text accessibilityRole="header" style={[styles.heading,{color:colors.text}]}>简报</Text>}
  <ToolButton colors={colors} disabled={disabled} onPress={onAttention}>团队事项</ToolButton>
  {view?.briefs.map(brief=><View key={brief.id} style={[styles.card,{borderColor:colors.line}]}>
   <ToolButton colors={colors} onPress={()=>setExpanded(id=>id===brief.id?undefined:brief.id)}>{brief.day+" "+labels[brief.slot]+(brief.missed?" · 已错过":brief.delivery?" · "+dailyBriefDeliveryLabels[brief.delivery]:"")}</ToolButton>
   {expanded===brief.id&&<>
    {brief.items.length?items(brief.items):<Text style={{color:colors.muted}}>{brief.missed?"本期未补投。":brief.coverage.some(row=>row.state==="ok")?"已核对的范围内没有新增事项。":"本期没有可确认的来源结果。"}</Text>}
    {coverage(brief.coverage)}
   </>}
  </View>)}
 </ScrollView>;
}

const styles=StyleSheet.create({
 page:{padding:16,gap:12,paddingBottom:30},
 card:{borderWidth:1,borderRadius:16,padding:12,gap:8},
 heading:{fontSize:16,fontWeight:"600"},
 check:{minHeight:42,justifyContent:"center"},
 choice:{minHeight:48,padding:10,borderWidth:1,borderRadius:10,flexDirection:"row",alignItems:"center",gap:12},
 input:{borderWidth:1,borderRadius:10,padding:10},
 actions:{flexDirection:"row",flexWrap:"wrap",gap:8},
});
