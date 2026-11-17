import {resolve} from 'node:path';
/** Display facts only. Never a shell parser, authorization decision, or proof a path is empty. */
export interface OperationFact {kind:'delete'|'overwrite'|'copy'|'process'|'path'|'unknown';target:string;reason:string}
export function inspectOperation(toolName:string,input:Record<string,unknown>,cwd:string){
 const facts:OperationFact[]=[],add=(kind:OperationFact['kind'],target:string,reason:string)=>{if(target&&!facts.some(f=>f.kind===kind&&f.target===target))facts.push({kind,target,reason});};
 if(toolName!=='bash'){if(typeof input.file_path==='string')add(toolName==='write'||toolName==='edit'?'overwrite':'path',resolve(cwd,input.file_path),toolName==='read'?'读取文件':'写入或修改文件');return {facts,destructive:false,mixedInspection:false};}
 const command=String(input.command??''),tokens=command.match(/"[^"\n]*"|'[^'\n]*'|[^\s;|&]+|[;|&]+/g)??[];
 let directory=cwd;const literal=(v:string)=>v.replace(/^(['"])(.*)\1$/,'$2'),path=(v:string)=>/[`$*?{}]/.test(v)?v:resolve(directory,v);
 for(let i=0;i<tokens.length;i++){
  const word=literal(tokens[i]!);
  if(word==='cd'&&tokens[i+1]){directory=path(literal(tokens[++i]!));add('path',directory,'命令显式切换工作目录');continue;}
  if(/^(?:rm|rmdir|unlink|shred|truncate|Remove-Item)$/i.test(word)){
   let found=false;for(let j=i+1;j<tokens.length&&!/^[;|&]+$/.test(tokens[j]!);j++){const value=literal(tokens[j]!);if(!value.startsWith('-')){add('delete',path(value),'删除或清空；现有内容及恢复方案须先检查');found=true;}}
   if(!found)add('unknown',word,'删除目标未能静态解析，须单独检查');
  }
  if(word==='cp'&&tokens[i+1]){const operands=tokens.slice(i+1).slice(0,tokens.slice(i+1).findIndex(t=>/^[;|&]+$/.test(t))<0?undefined:tokens.slice(i+1).findIndex(t=>/^[;|&]+$/.test(t))).filter(t=>!t.startsWith('-')).map(literal);if(operands.length>=2){add('copy',path(operands[0]!),'复制来源');add('overwrite',path(operands.at(-1)!),'复制目标，可能覆盖已有文件');}}
  if(/^(?:kill|pkill|killall|nohup)$/.test(word)||['npm','pnpm','yarn'].includes(word)&&/\b(?:start|dev|serve)\b/.test(command))add('process',tokens.slice(i,i+4).join(' '),'启动或结束进程');
  if(word==='>'||word==='>>'){if(tokens[i+1])add('overwrite',path(literal(tokens[i+1]!)),word==='>'?'重定向覆盖文件':'追加输出文件');}
  else if(word.startsWith('/')&&!word.startsWith('//'))add('path',word,'命令包含绝对路径');
 }
 const destructive=facts.some(f=>f.kind==='delete'||f.kind==='unknown');
 return {facts,destructive,mixedInspection:destructive&&/(?:^|[;&|]\s*|\s)(?:ls|stat|du|find|test|lsof|head|cat|pwd)(?:\s|$)/.test(command)&&/[;&|]/.test(command)};
}
