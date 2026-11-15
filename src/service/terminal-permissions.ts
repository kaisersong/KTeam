export const HARNESS_PERMISSION_POLICY_VERSION='read-only-shell-1';
import {readOnlyShell,routineShell} from './read-only-shell.js';
/** Conservative command inspection for reusable directory grants, never an execution replay rule. */
export function terminalCommands(core:any,command:string):string[]|undefined{
 if(!command||/[\n\r`$]/.test(command))return;
 const parsed=core.parseCommandSegments(command);if(!parsed.valid||!parsed.segments.length)return;
 return parsed.segments;
}
/** A trusted working directory admits commands by risk, never by a command-name allowlist. */
export function terminalRequiresConfirmation(core:any,command:string){
 const classification=core.classifyBashCommand(command);
 // Generic interpreter capability warnings are not evidence of a dangerous action.
 // Actual destructive operations below and core hard denies still require confirmation.
 if(!command.trim()||command.length>65536||command.includes('\0')||(classification.level!=='safe'&&!(classification.level==='warn'&&classification.reason==='interpreter eval may execute system commands')))return true;
 if(readOnlyShell(command,word=>!core.isSensitiveToolInvocation('read',{file_path:word})))return false;
 const plain=command.replace(/["']/g,'');
 return /(?:^|[\s/;&|=])(?:rm|rmdir|unlink|shred|truncate|del|erase|Remove-Item|sudo|chmod|chown|ssh|scp|sftp)(?:\s|$)/i.test(plain)
  || /\bgit\b[^;|&\n]*\b(?:push|reset|clean|restore|rebase|filter-branch)\b/.test(plain)
  || /\bgit\b[^;|&\n]*(?:\s(?:-c|--config-env|--exec-path)(?:[=\s]|$)|\b(?:config|remote|gc)\b)/.test(plain)
  || /\bgit\b[^;|&\n]*\b(?:checkout|switch)\b[^;|&\n]*(?:\s(?:-[fBC]|--force|--discard-changes|--force-create)(?:\s|=|$)|\s--\s)/.test(plain)
  || /\bgit\b[^;|&\n]*\bmerge\b[^;|&\n]*(?:--abort|--strategy|\s-s(?:\s|$))/.test(plain)
  || /(?:^|[;\s])(?:PATH|ENV|BASH_ENV|LD_PRELOAD|DYLD_INSERT_LIBRARIES)=/.test(plain)
  || /(?:^|[;&|]\s*)\$[A-Za-z_{]/.test(plain)
  || /\bgit\b[^;|&\n]*\b(?:branch|tag)\b[^;|&\n]*(?:\s-[dD](?:\s|$)|--delete)/.test(plain)
  || /\bgit\b[^;|&\n]*\bworktree\s+(?:remove|prune|move|repair)\b/.test(plain)
  || /\bgit\b[^;|&\n]*\bcommit\b[^;|&\n]*--amend/.test(plain)
  || /(?:\.git|\$gitdir|\$GIT_DIR)\/(?:hooks|config)(?:\/|\s|$)/i.test(plain)
  || /\bgh\b[^;|&\n]*\b(?:create|edit|delete|merge|close|reopen|rerun|cancel|upload|fork|sync|auth|api|secret|variable)\b/.test(plain)
  || /\bfind\b[^;|&\n]*(?:-delete|-exec|-ok|-fprint)/.test(plain)
  || /\b(?:unlinkSync|rmdirSync|rmSync|rmtree|remove|unlink|system|popen)\s*\(/.test(plain)
  || /\b(?:curl|wget)\b[^;|&\n]*(?:--upload-file|--data|-d\s|-X\s+(?:POST|PUT|PATCH|DELETE))/.test(plain);
}
export function lowRiskTerminalQuery(core:any,command:string){
 if(process.platform!=='win32'&&core.classifyBashCommand(command).level==='safe'&&readOnlyShell(command,word=>!core.isSensitiveToolInvocation('read',{file_path:word})))return true;
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
 const commands:string[]=[];if(process.platform==='win32')return;if(core.classifyBashCommand(command).level!=='safe'||!readOnlyShell(command,word=>!core.isSensitiveToolInvocation('read',{file_path:word}),value=>commands.push(value)))return;return commands;
}

/** These commands still require an initial human grant; they are never read-only auto approval. */
export function routineTerminalCommands(core:any,command:string):string[]|undefined{
 const commands:string[]=[];if(process.platform==='win32')return;if(core.classifyBashCommand(command).level!=='safe'||!routineShell(command,word=>!core.isSensitiveToolInvocation('read',{file_path:word}),value=>commands.push(value)))return;return commands;
}
