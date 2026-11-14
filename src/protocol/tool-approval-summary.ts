/** Presentation only. Never used to grant permission or classify a command as safe. */
export interface ApprovalSummary {summary:string;target?:string}
const short=(value:string)=>value.length>100?value.slice(0,97)+'…':value;
const name=(value:unknown)=>typeof value==='string'?short(value.replace(/[\\/]+$/,'').split(/[\\/]/).pop()||value):undefined;
function words(value:string):string[]|undefined {
 if(/[\n\r`$;|<>\\]/.test(value))return;
 const tokens:string[]=[];let rest=value.trim();
 while(rest){
  const match=/^(?:"[^"\n]*"|'[^'\n]*'|[^\s"']+)(?=\s|$)/.exec(rest);if(!match)return;
  const token=match[0];tokens.push(/^['"]/.test(token)?token.slice(1,-1):token);rest=rest.slice(token.length).trimStart();
 }
 return tokens;
}
function gitAction(command:string){
 const tokens=words(command.trim());if(!tokens||tokens.shift()!=='git')return;
 let target:string|undefined;if(tokens[0]==='-C'){tokens.shift();target=name(tokens.shift());if(!target)return;}
 const action=tokens.shift(),flags=tokens;
 const knownFlags=flags.every(flag=>/^(?:-\d+|-n\d*|\d+|--oneline|--short|--stat|--name-only|--name-status|--branch|--porcelain(?:=v[12])?|--max-count=\d+|-s|-sb|-b)$/.test(flag));
 if(action==='log'&&knownFlags)return {label:'最近的提交记录',target};
 if(action==='status'&&knownFlags)return {label:'项目当前的修改情况',target};
 if(action==='diff'&&knownFlags)return {label:'项目文件的改动',target};
 if(action==='branch'&&flags.length===1&&flags[0]==='--show-current')return {label:'当前分支',target};
 const labels:Record<string,string>={commit:'创建 Git 提交',push:'向远程仓库推送内容',pull:'拉取并合并远程仓库的更新',fetch:'获取远程仓库的更新',checkout:'切换或恢复项目文件',switch:'切换项目分支',reset:'重置项目的 Git 状态',clean:'清理未跟踪的项目文件',merge:'合并项目分支',rebase:'调整项目提交历史',add:'将项目修改加入暂存区'};
 // Unrecognised options and shell syntax stay generic; never label them as a read.
 return {label:labels[action??'']??'执行 Git 操作',target,operation:true};
}
export function toolApprovalSummary(toolName:string,display:string):ApprovalSummary {
 let input:Record<string,unknown>;try{input=JSON.parse(display);if(!input||Array.isArray(input)||typeof input!=='object')throw Error();}catch{return {summary:'执行一项需要你确认的操作'};}
 if(toolName==='bash'){
  if(typeof input.command==='string'){
   const parts=input.command.split('&&').map(gitAction);
   if(parts.length&&parts.length<=4&&parts.every(Boolean)){
    const actions=parts as NonNullable<ReturnType<typeof gitAction>>[];
    const targets=[...new Set(actions.map(action=>action.target).filter(Boolean))];
    const labels=[...new Set(actions.map(action=>action.label))];
    return {summary:actions.every(action=>!action.operation)?'查看'+labels.join('和'):actions.map(action=>action.operation?action.label:'查看'+action.label).join('，然后'),...(targets.length===1?{target:targets[0]}:{})};
   }
  }
  return {summary:'在电脑上运行终端命令'};
 }
 const files:Record<string,string>={read:'读取文件',write:'保存文件（可能覆盖已有内容）',edit:'修改文件',glob:'查找文件',grep:'搜索文件内容'};
 if(files[toolName])return {summary:files[toolName]!,target:name(input.file_path??input.path)};
 if(toolName==='web_fetch'){let target:string|undefined;try{const url=new URL(String(input.url));target=url.hostname;}catch{}return {summary:'读取网页内容',target};}
 if(toolName==='web_search')return {summary:'搜索网络资料'};
 return {summary:'执行一项需要你确认的操作'};
}
