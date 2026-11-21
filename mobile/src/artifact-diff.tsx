import {useEffect,useMemo,useRef,useState} from "react";
import {FlatList,Pressable,StyleSheet,Text,View} from "react-native";
import type {ArtifactReviewView,ReviewLine} from "../../src/protocol/artifact-review";

type Colors = { text:string; muted:string; green:string; line:string };
type Row = { key:string; line:ReviewLine } | { key:string; folded:ReviewLine[] };

function diffRows(lines:ReviewLine[], expanded:Set<string>):Row[] {
  const rows:Row[] = [];
  let index = 0;
  while (index < lines.length) {
    const start = index++;
    if (lines[start].kind === "context") {
      while (lines[index]?.kind === "context") index++;
    }
    const key = String(start);
    if (index - start > 8 && !expanded.has(key)) {
      rows.push({ key, folded:lines.slice(start,index) });
    } else {
      for (let offset = start; offset < index; offset++) {
        rows.push({key:String(offset), line:lines[offset]});
      }
    }
  }
  return rows;
}

export function ArtifactDiff({view,colors,position,onPosition}:{
  view:ArtifactReviewView;
  colors:Colors;
  position?:{offset:number; expanded:string[]};
  onPosition:(position:{offset:number; expanded:string[]})=>void;
}){
  const [expanded,setExpanded]=useState(()=>new Set(position?.expanded));
  const offset=useRef(position?.offset??0);
  const restore=useRef(offset.current>0);
  const list=useRef<FlatList<Row>>(null);
  const rows=useMemo(()=>diffRows(view.lines,expanded),[view.lines,expanded]);
  const added=view.lines.filter(line=>line.kind==="added").length;
  const removed=view.lines.filter(line=>line.kind==="removed").length;
  useEffect(()=>{onPosition({offset:offset.current,expanded:[...expanded]});},[expanded,onPosition]);
  return <FlatList<Row>
    ref={list} data={rows} keyExtractor={row=>row.key}
    onContentSizeChange={()=>{
      if(!restore.current)return;
      restore.current=false;
      list.current?.scrollToOffset({offset:offset.current,animated:false});
    }}
    onScroll={event=>{
      if(restore.current)return;
      offset.current=event.nativeEvent.contentOffset.y;
      onPosition({offset:offset.current,expanded:[...expanded]});
    }}
    scrollEventThrottle={128}
    ListHeaderComponent={<View style={styles.header}>
      <Text style={{color:colors.text,fontWeight:"600"}}>{view.historical?"历史版本":"当前版本"} {view.sha256.slice(0,12)}</Text>
      <Text style={{color:colors.muted}}>
        {view.baselineSha256?"基线 "+view.baselineSha256.slice(0,12)+" · 新增 "+added+" 行 · 删除 "+removed+" 行":"首次审阅 · "+view.lines.length+" 行"}
      </Text>
    </View>}
    renderItem={({item})=>"folded" in item ? <Pressable accessibilityRole="button"
      onPress={()=>setExpanded(old=>new Set([...old,item.key]))} style={styles.folded}>
      <Text style={{color:colors.green}}>展开 {item.folded.length} 行{view.baselineSha256?"未改内容":""}</Text>
    </Pressable> : <View style={[styles.line,{borderColor:colors.line}]}>
      <Text style={[styles.number,{color:colors.muted}]}>
        {item.line.kind==="added"?"+":item.line.kind==="removed"?"−":""} {item.line.after??item.line.before}
      </Text>
      <Text selectable style={[styles.text,{color:item.line.kind==="added"?colors.green:colors.text}]}>{item.line.text||" "}</Text>
    </View>}
  />;
}

const styles=StyleSheet.create({
  header:{padding:16,gap:6},
  line:{flexDirection:"row",borderTopWidth:StyleSheet.hairlineWidth,paddingVertical:5,paddingHorizontal:12,gap:8},
  number:{minWidth:48,textAlign:"right"},
  text:{flex:1,fontFamily:"monospace"},
  folded:{paddingHorizontal:20,minHeight:44,justifyContent:"center"},
});
