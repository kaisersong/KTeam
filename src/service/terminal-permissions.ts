export const HARNESS_PERMISSION_POLICY_VERSION='directory-shell-9';
import {readOnlyShell,routineShell} from './read-only-shell.js';
import {readOnlyWindowsShell} from './windows-shell.js';
import {gitCommandRisk} from './git-command-risk.js';
/** Conservative command inspection for reusable directory grants, never an execution replay rule. */
export function terminalCommands(core:any,command:string):string[]|undefined{
 if(!command||/[\n\r`$]/.test(command))return;
 const parsed=core.parseCommandSegments(command);if(!parsed.valid||!parsed.segments.length)return;
 return parsed.segments;
}
/** A trusted working directory admits commands by risk, never by a command-name allowlist. */
export interface TerminalConfirmation {reason:string;segment?:string}
export function terminalRequiresConfirmation(core:any,command:string){
 return !!terminalConfirmation(core,command);
}
export function terminalConfirmation(core:any,command:string):TerminalConfirmation|undefined{
 const classification=core.classifyBashCommand(command);
 const genericWarnings=new Set(['interpreter eval may execute system commands','pipe to interpreter','eval executes dynamically constructed commands','pipe to shell interpreter']);
 // Generic interpreter capability warnings are not evidence of a dangerous action.
 // Actual destructive operations below and core hard denies still require confirmation.
 if(!command.trim()||command.length>65536||command.includes('\0'))return {reason:'命令内容无法安全核对'};
 const parsed=core.parseCommandSegments(command),segments:string[]=parsed.segments;
 if(classification.level!=='safe'&&!(classification.level==='warn'&&genericWarnings.has(classification.reason))){
  const segment=parsed.valid?segments.find(value=>core.classifyBashCommand(value).reason===classification.reason):undefined;
  return {reason:'终端策略要求单独核对这项操作',segment};
 }
 if(readOnlyShell(command,word=>!core.isSensitiveToolInvocation('read',{file_path:word})))return;
 if(process.platform==='win32'&&readOnlyWindowsShell(command,word=>!core.isSensitiveToolInvocation('read',{file_path:word})))return;
 const inspected=segments.filter(segment=>!readOnlyShell(segment,word=>!core.isSensitiveToolInvocation('read',{file_path:word})));
 const git=inspected.map(segment=>({segment,risk:gitCommandRisk(segment)})),restrictedGit=git.find(value=>value.risk===true);
 if(restrictedGit)return {reason:'这段 Git 操作需要单独确认',segment:parsed.valid?restrictedGit.segment:undefined};
 const opaqueGit=git.filter(value=>value.risk===undefined).map(value=>value.segment);
 const checks=[
  {pattern:/(?:^|[\s/;&|=])(?:rm|rmdir|rd|unlink|shred|truncate|del|erase|Remove-Item|sudo|chmod|chown)(?:\s|$)/i,reason:'删除文件、修改权限或请求系统提权',source:inspected},
  {pattern:/\bgit\b[^;|&\n]*\b(?:push|reset|clean|restore|rebase|filter-branch)\b/,reason:'推送或改写 Git 历史',source:opaqueGit},
  {pattern:/\bgit\b[^;|&\n]*(?:\s(?:-c|--config-env|--exec-path)(?:[=\s]|$)|\b(?:config|remote|gc)\b)/,reason:'修改 Git 配置或维护仓库',source:opaqueGit},
  {pattern:/\bgit\b[^;|&\n]*\b(?:checkout|switch)\b[^;|&\n]*(?:\s(?:-[fBC]|--force|--discard-changes|--force-create)(?:\s|=|$)|\s--\s)/,reason:'强制切换分支或替换工作区文件',source:opaqueGit},
  {pattern:/\bgit\b[^;|&\n]*\bmerge\b[^;|&\n]*(?:--abort|--strategy|\s-s(?:\s|$))/,reason:'更改 Git 合并行为',source:opaqueGit},
  {pattern:/(?:^|[;\s])(?:PATH|ENV|BASH_ENV|LD_PRELOAD|DYLD_INSERT_LIBRARIES)=/,reason:'修改命令执行环境',source:inspected},
  {pattern:/\bgit\b[^;|&\n]*\b(?:branch|tag)\b[^;|&\n]*(?:\s-[dD](?:\s|$)|--delete)/,reason:'删除 Git 分支或标签',source:opaqueGit},
  {pattern:/\bgit\b[^;|&\n]*\bworktree\s+(?:remove|prune|move|repair)\b/,reason:'删除、移动或修复 Git 工作树',source:opaqueGit},
  {pattern:/\bgit\b[^;|&\n]*\bcommit\b[^;|&\n]*--amend/,reason:'修改最近一次提交',source:opaqueGit},
  {pattern:/(?:\.git|\$gitdir|\$GIT_DIR)\/(?:hooks|config)(?:\/|\s|$)/i,reason:'访问 Git 钩子或配置',source:inspected},
  {pattern:/\bgh\b[^;|&\n]*\b(?:create|edit|delete|merge|close|reopen|rerun|cancel|upload|fork|sync|auth|api|secret|variable)\b/,reason:'可能更改 GitHub 状态或访问账户配置',source:inspected},
  {pattern:/\bfind\b[^;|&\n]*(?:-delete|-exec|-ok|-fprint)/,reason:'搜索命令同时执行其他操作或写入结果',source:inspected},
  {pattern:/\b(?:unlinkSync|rmdirSync|rmSync|rmtree|remove|unlink)\s*\(/,reason:'脚本含文件删除操作',source:inspected},
  {pattern:/\b(?:curl|wget)\b[^;|&\n]*(?:--upload-file|--data|-d\s|-X\s+(?:POST|PUT|PATCH|DELETE))/,reason:'网络请求携带写入方法或上传内容',source:inspected},
 ];
 const plain=(value:string)=>value.replace(/["']/g,'');
 for(const {pattern,source,reason} of checks){
  if(pattern.test(plain(source.join(';')))){
   return {reason,segment:parsed.valid?source.find(value=>pattern.test(plain(value))):undefined};
  }
 }
}

export function lowRiskTerminalQuery(core:any,command:string){
 if(readOnlyTerminalCommands(core,command))return true;
 if(terminalRequiresConfirmation(core,command))return false;
 const segments=terminalCommands(core,command);if(!segments)return false;
 return segments.every((raw:string)=>{
  const segment=raw.replace(/(?:^|\s)2>\s*\/dev\/null(?=\s|$)/g,' ').trim();
  if(/[<>]/.test(segment))return false;
  if(/^(?:ls|pwd|echo)(?:\s|$)/.test(segment))return true;
  // Read-only gh forms. Unknown subcommands/options remain covered by the explicit grant path.
  return /^gh\s+(?:run\s+(?:view|list)|pr\s+(?:view|list|checks|status)|issue\s+(?:view|list|status)|release\s+(?:view|list)|repo\s+view)(?:\s|$)/.test(segment);
 });
}

/** Individual read commands also pass through original deny rules, including inside branches. */
export function readOnlyTerminalCommands(core:any,command:string):string[]|undefined{
 if(core.classifyBashCommand(command).level!=='safe')return;
 if(process.platform==='win32')return readOnlyWindowsShell(command,word=>!core.isSensitiveToolInvocation('read',{file_path:word}))?[command]:undefined;
 const commands:string[]=[];if(!readOnlyShell(command,word=>!core.isSensitiveToolInvocation('read',{file_path:word}),value=>commands.push(value)))return;return commands;
}

/** These commands still require an initial human grant; they are never read-only auto approval. */
export function routineTerminalCommands(core:any,command:string):string[]|undefined{
 const commands:string[]=[];if(process.platform==='win32')return;if(core.classifyBashCommand(command).level!=='safe'||!routineShell(command,word=>!core.isSensitiveToolInvocation('read',{file_path:word}),value=>commands.push(value)))return;return commands;
}
