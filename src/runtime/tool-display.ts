/** Document bodies belong to their files/runtime session, never chat diagnostics. */
export function documentTool(name:string){return ['write','edit','notebook_write'].includes(name);}
export function toolInputMetadata(name:string,value:unknown):Record<string,unknown>|undefined{
 let input:any=value;
 if(typeof input==='string'){try{input=JSON.parse(input);}catch{return documentTool(name)?{summary:'文档操作（历史正文已省略）'}:undefined;}}
 if(!input||typeof input!=='object'||Array.isArray(input))return undefined;
 if(!documentTool(name))return input;
 const result:Record<string,unknown>={};
 if(typeof input.file_path==='string')result.file_path=input.file_path.slice(0,4096);
 if(typeof input.summary==='string')result.summary=input.summary.slice(0,120);
 for(const key of ['characters','lines'])if(Number.isSafeInteger(input[key]))result[key]=input[key];
 const body=typeof input.content==='string'?input.content:typeof input.new_string==='string'?input.new_string:undefined;
 if(body!==undefined){result.characters=body.length;result.lines=body.split('\n').length;}
 return result;
}
export function toolInputDisplay(name:string,value:unknown){
 const metadata=toolInputMetadata(name,value);
 return (metadata?JSON.stringify(metadata,null,2):typeof value==='string'?value:JSON.stringify(value))?.slice(0,8192);
}
export function toolResultDisplay(name:string,value:unknown){
 const text=typeof value==='string'?value:JSON.stringify(value);
 if(name==='edit'&&text?.includes('已编辑:'))return text.slice(text.lastIndexOf('已编辑:')).slice(0,1024);
 return text?.slice(0,8192);
}
/** Minimal recovery/activity facts; verbose transports and output stay in logs. */
export function executionEventSummary(event:any){
 if(event.type&&!['tool_started','tool_finished','model_request_started','run_aborted','run_failed'].includes(event.type))return undefined;
 const {id,name,type,state,botId,startedAt,code}=event;
 let input:string|undefined;
 const metadata=toolInputMetadata(name,event.input);
 if(metadata){const facts=name==='contact_bot'?{botId:metadata.botId}:documentTool(name)?metadata:undefined;if(facts)input=JSON.stringify(facts).slice(0,4096);}
 return {id,name,type,state,botId,startedAt,...code?{code:String(code).slice(0,160)}:{},...input?{input}:{}};
}
