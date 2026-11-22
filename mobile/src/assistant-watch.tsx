import {useEffect,useRef,useState} from "react";
import {Linking,StyleSheet,Text,TextInput,View} from "react-native";
import {randomUUID} from "expo-crypto";
import {localWatchTime,parseWatchTime,watchActions,watchDefaults,watchDisplay,watchError,watchStates,watchStatuses,type WatchCommand,type WatchItem} from "../../src/protocol/assistant-watch";
import {ToolButton,type ToolProps} from "./conversation-tools";

type Editor={id:string;revision?:number;title:string;condition:string;kind:"waiting"|"commitment";check:string;stop:string;link:string;itemId?:string;sourceLinked?:boolean};
const labelTime=(at:number)=>localWatchTime(at).replace("T"," ");

export function AssistantWatches({roomId,colors,call,mutate,disabled,reference,onClearReference}:ToolProps&{roomId:string;reference?:string;onClearReference:()=>void}){
 const [snapshot,setSnapshot]=useState<{items:WatchItem[];at:number}>();
 const [clock,setClock]=useState(Date.now);
 const publish=(items:WatchItem[])=>{const at=Date.now();setSnapshot({items,at});setClock(at);};
 const [editor,setEditor]=useState<Editor>();
 const [error,setError]=useState("");
 const [pending,setPending]=useState(false);
 const [all,setAll]=useState(false);
 const epoch=useRef(0);
 useEffect(()=>{
  if(disabled){setSnapshot(undefined);setEditor(undefined);setError("");return;}
  const generation=++epoch.current;
  const refresh=()=>void call("dailyWork.watches",{roomId}).then(result=>{
   if(generation===epoch.current)publish(result.items);
  }).catch(()=>{if(generation===epoch.current)setSnapshot(undefined);});
  refresh();
  const timer=setInterval(()=>setClock(Date.now()),1000);
  return ()=>{epoch.current++;clearInterval(timer);};
 },[roomId,call,disabled]);
 const openEditor=(item?:WatchItem,itemId?:string)=>{
  const defaults=watchDefaults();
  const details=item?.details??defaults;
  setEditor({title:details.title,condition:details.condition,kind:details.kind,link:item?.details?.link??"",
   check:labelTime(item?.checkAt??defaults.checkAt),stop:labelTime(item?.stopAt??defaults.stopAt),
   id:item?.id??randomUUID(),revision:item?.revision,itemId,sourceLinked:item?.sourceLinked===true});
 };
 useEffect(()=>{
  if(reference&&!disabled){openEditor(undefined,reference);onClearReference();}
 },[reference,disabled,onClearReference]);
 const change=async(input?:WatchCommand)=>{
  const generation=epoch.current;
  setError("");setPending(true);
  try{
   const result=await (input?mutate("dailyWork.watch",{roomId,...input}):call("dailyWork.watches",{roomId}));
   if(generation!==epoch.current)return false;
   publish(result.items);
   return true;
  }catch(cause){if(generation===epoch.current)setError(watchError(cause));return false;}
  finally{setPending(false);}
 };
 const submit=async(value:Editor)=>{
  const draft={title:value.title,condition:value.condition,kind:value.kind,checkAt:parseWatchTime(value.check),stopAt:parseWatchTime(value.stop),link:value.link.trim()||undefined,itemId:value.itemId};
  if(await change(value.revision?{action:"edit",id:value.id,expectedRevision:value.revision,draft}:{action:"create",id:value.id,draft}))setEditor(undefined);
 };
 const openLink=async(item:WatchItem,kind:"link"|"originalLink")=>{
  const generation=epoch.current;
  setPending(true);setError("");
  try{
   const result=await call("dailyWork.watches",{roomId});
   if(generation!==epoch.current)return;
   publish(result.items);
   const url=(result.items as WatchItem[]).find(row=>row.id===item.id&&row.revision===item.revision)?.details?.[kind];
   if(!url)throw Error("daily_source_unavailable");
   await Linking.openURL(url);
  }catch(cause){if(generation===epoch.current)setError(watchError(cause));}
  finally{setPending(false);}
 };
 const items=snapshot?.items.map(item=>watchDisplay(item,snapshot.at,clock));
 if(disabled)return <Text style={{color:colors.muted}}>恢复电脑连接后可读取私有事项。</Text>;
 if(!items&&!editor)return null;
 const attention=items?.filter(item=>item.state==="active"&&["due","missed"].includes(item.status))??[];
 const render=(item:WatchItem)=><View key={item.id} style={[styles.card,{borderColor:colors.line}]}>
  <Text style={{color:colors.text,fontWeight:"600"}}>{item.details?.title??"来源暂不可见的事项"}</Text>
  <Text style={{color:colors.muted}}>{item.state==="active"?watchStatuses[item.status]:watchStates[item.state]} · {labelTime(item.checkAt)}</Text>
  {item.details&&<Text style={{color:colors.text}}>{item.details.condition}</Text>}
  <Text style={{color:colors.muted}}>停止时间 {labelTime(item.stopAt)}{item.checkedAt?" · 上次自查 "+labelTime(item.checkedAt):""}</Text>
  <View style={styles.actions}>
   {item.details?.originalLink&&<ToolButton colors={colors} disabled={pending} onPress={()=>void openLink(item,"originalLink")}>打开原消息</ToolButton>}
   {item.details?.link&&<ToolButton colors={colors} disabled={pending} onPress={()=>void openLink(item,"link")}>打开已登记链接</ToolButton>}
   {item.details&&["active","paused"].includes(item.state)&&<ToolButton colors={colors} onPress={()=>openEditor(item)}>修改</ToolButton>}
   {watchActions(item).map(({action,label})=><ToolButton key={action} colors={colors} disabled={pending} onPress={()=>void change({action,id:item.id,expectedRevision:item.revision})}>{label}</ToolButton>)}
  </View>
 </View>;
 return <View style={styles.section}>
  <Text accessibilityRole="header" style={{color:colors.text,fontWeight:"600"}}>我让小 K 盯着什么</Text>
  <View style={styles.actions}><ToolButton colors={colors} disabled={pending} onPress={()=>openEditor()}>登记事项</ToolButton><ToolButton colors={colors} disabled={pending} onPress={()=>void change()}>刷新事项</ToolButton></View>
  {error&&<Text accessibilityRole="alert" style={{color:colors.text}}>{error}</Text>}
  {editor&&(!editor.sourceLinked||items?.some(item=>item.id===editor.id&&item.details))&&<View style={[styles.card,{borderColor:colors.line}]}>
   <Text style={{color:colors.muted}}>{editor.itemId?"已选择原消息。小 K 只在你查看时复核可见性。":"到检查点后在今日页提示你自查。"}</Text>
   {([
    ["title","事项",160],["condition","要核对的结果",500],["check","检查时间（YYYY-MM-DD HH:mm）",16],
    ["stop","停止时间（YYYY-MM-DD HH:mm）",16],["link","来源链接（选填）",1000],
   ] as const).map(([field,label,maxLength])=><View key={field}>
    <Text style={{color:colors.text}}>{label}</Text>
    <TextInput accessibilityLabel={label} maxLength={maxLength} autoCapitalize="none" value={editor[field]}
     onChangeText={text=>setEditor({...editor,[field]:text})} style={[styles.input,{color:colors.text,borderColor:colors.line}]}/>
   </View>)}
   <View style={styles.actions}>
    <ToolButton colors={colors} onPress={()=>setEditor({...editor,kind:editor.kind==="waiting"?"commitment":"waiting"})}>{editor.kind==="waiting"?"等对方回音":"本人承诺"}</ToolButton>
    <ToolButton colors={colors} onPress={()=>setEditor(undefined)}>取消</ToolButton>
    <ToolButton colors={colors} disabled={pending} onPress={()=>void submit(editor)}>{"确认"+(editor.revision?"修改":"登记")}</ToolButton>
   </View>
  </View>}
  {!!attention.length&&<><Text style={{color:colors.text,fontWeight:"600"}}>今天需要我</Text>{attention.slice(0,3).map(render)}</>}
  {!!items?.length&&<ToolButton colors={colors} onPress={()=>setAll(!all)}>{(all?"收起事项":"全部事项")+"（"+items.length+"）"+(attention.length>3?" · 另有 "+(attention.length-3)+" 项待自查":"")}</ToolButton>}
  {all&&items?.map(render)}
 </View>;
}

const styles=StyleSheet.create({
 section:{gap:8},
 card:{borderWidth:1,borderRadius:12,padding:12,gap:8},
 input:{borderWidth:1,borderRadius:8,padding:8,marginTop:4},
 actions:{flexDirection:"row",flexWrap:"wrap",gap:6},
});
