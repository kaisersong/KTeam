import {useEffect,useState} from 'react';
import {Pressable,ScrollView,Text,TextInput,View} from 'react-native';
import {activeWorkLabels,conversationWork} from '../../src/protocol/conversation-work';
import type {MessageReference} from '../../src/protocol/message-reference';

type Color={text:string;muted:string;green:string;line:string;panel:string};
type Button=(title:string,action:()=>void,icon?:undefined,disabled?:boolean)=>React.ReactNode;
type Call=(method:string,input:unknown)=>Promise<any>;

export function ActiveConversationWork({roomId,jobs,attention,bots,button,colors,disabled,onOpen,onAttention,onAppend,onStop}:{
 roomId:string;jobs:any[];attention:any[];bots:any[];button:Button;colors:Color;disabled:boolean;
 onOpen:(jobId:string)=>void;onAttention:(item:any)=>void;onAppend:(jobId:string,independent?:boolean)=>void;onStop:(jobId:string)=>void;
}){
 const [expanded,setExpanded]=useState(false);
 const rows=conversationWork(roomId,jobs,attention);
 if(!rows.length)return null;
 const waiting=rows.filter(row=>row.attention).length;
 return <View style={{paddingHorizontal:16,paddingVertical:6,borderBottomWidth:1,borderColor:colors.line}}>
  {button((waiting?waiting+' 项等待你处理':rows.length+' 项工作进行中')+(rows[0]?.progress?' · '+rows[0].progress:''),()=>setExpanded(value=>!value))}
  {expanded&&<ScrollView style={{maxHeight:220}}>{rows.map(({job,attention,progress})=><View key={job.id} style={{gap:4,marginVertical:6}}>
   <Text style={{color:colors.text}}>{bots.find(bot=>bot.id===job.activeBotId)?.name??'会话工作'} · {attention?'等待你处理':activeWorkLabels[job.state]}{progress?' · '+progress:''}</Text>
   <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>
    {!!attention&&button('去处理',()=>onAttention(attention))}
    {button('查看记录',()=>onOpen(job.id))}
    {job.state!=='stopping'&&button('补充要求',()=>onAppend(job.id),undefined,disabled)}
    {job.state!=='stopping'&&button('另提问题',()=>onAppend(job.id,true),undefined,disabled)}
    {job.state!=='stopping'&&button('停止',()=>onStop(job.id),undefined,disabled)}
   </View>
  </View>)}</ScrollView>}
 </View>;
}

export function MobileReferencePicker({room,rooms,call,button,colors,onInsert}:{
 room:{roomId:string;title:string};rooms:{roomId:string;title:string}[];call:Call;button:Button;colors:Color;onInsert:(ref:MessageReference)=>void;
}){
 const [source,setSource]=useState(''),[messages,setMessages]=useState<{messageId:string;text:string}[]>([]);
 const [preview,setPreview]=useState<MessageReference>(),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{
  if(!source)return;let current=true;
  void call('messages.page',{roomId:source,tail:true}).then(value=>{
   if(current)setMessages(value.messages.filter((message:any)=>message.text?.trim()).reverse());
  }).catch(error=>{if(current)setError(String(error.message??error));});
  return()=>{current=false;};
 },[source,call]);
 async function open(messageId:string){
  setBusy(true);setError('');
  try{setPreview((await call('messages.reference',{roomId:room.roomId,sourceRoomId:source,messageId})).reference);}
  catch(error){setError(String(error instanceof Error?error.message:error));}finally{setBusy(false);}
 }
 return <ScrollView contentContainerStyle={{padding:16,gap:12}}>
  {!!error&&<Text accessibilityRole="alert" style={{color:colors.text}}>{error}</Text>}
  {!source&&rooms.filter(value=>value.roomId!==room.roomId).map(value=><Pressable accessibilityRole="button" key={value.roomId} onPress={()=>{setError('');setSource(value.roomId);}}><Text style={{color:colors.green,paddingVertical:8}}>{value.title}</Text></Pressable>)}
  {source&&!preview&&<>
   {button('重选来源会话',()=>{setSource('');setMessages([]);setError('');},undefined,busy)}
   {messages.map(value=><Pressable accessibilityRole="button" key={value.messageId} disabled={busy} onPress={()=>void open(value.messageId)}>
    <Text numberOfLines={3} style={{color:colors.text,paddingVertical:8}}>{value.text}</Text>
   </Pressable>)}
  </>}
  {preview&&<>
   <Text style={{color:colors.muted}}>将随消息发到「{room.title}」</Text>
   <Text selectable style={{color:colors.text}}>{preview.text}</Text>
   {button('插入引用',()=>onInsert(preview))}
   {button('重选消息',()=>setPreview(undefined))}
  </>}
 </ScrollView>;
}

export function MobileWorkInput({cap,independent,colors,button,onSubmit}:{independent?:boolean;cap?:{supported?:boolean};colors:Color;button:Button;onSubmit:(text:string)=>Promise<void>}){
 const [value,setValue]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function submit(){
  setBusy(true);setError('');
  try{await onSubmit(value);}catch(error){setError(String(error instanceof Error?error.message:error));}finally{setBusy(false);}
 }
 return <View style={{padding:16,gap:12}}>
  <TextInput accessibilityLabel="补充要求" multiline value={value} onChangeText={setValue} maxLength={6000} style={{color:colors.text,borderWidth:1,borderColor:colors.line,padding:12,minHeight:100}}/>
  <Text style={{color:colors.muted}}>{independent?'单独安排这条消息。':cap?.supported?'将在可接入的执行边界送达。':'将在原工作结束后处理。'}</Text>
  {!!error&&<Text accessibilityRole="alert" style={{color:colors.text}}>{error}</Text>}
  {button(independent?'提交问题':'提交补充',()=>void submit(),undefined,busy||!value.trim())}
 </View>;
}
