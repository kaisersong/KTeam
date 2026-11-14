/** Conservative command inspection for reusable directory grants, never an execution replay rule. */
export function terminalCommands(core:any,command:string):string[]|undefined{
 if(!command||/[\n\r`$]/.test(command))return;
 const parsed=core.parseCommandSegments(command);if(!parsed.valid||!parsed.segments.length)return;
 return parsed.segments;
}
function unquotedEscape(text:string){
 let quote='';for(let index=0;index<text.length;index++){const char=text[index];if(quote){if(char===quote)quote='';else if(char==='\\'&&quote==='"')index++;}else if(char==='"'||char==="'")quote=char;else if(char==='\\')return true;}return false;
}
export function terminalRequiresConfirmation(core:any,command:string){
 const segments=terminalCommands(core,command);
 if(!segments||core.requiresAlwaysCommandConfirmation(command)||core.classifyBashCommand(command).level!=='safe')return true;
 // Keep deletion, credential/security changes, remote mutations and opaque wrappers per-call.
 return segments.some((segment:string)=>{
  const plain=segment.replace(/["']/g,'');
  if(unquotedEscape(segment))return true;
  if(/(?:^|[\s/])(?:rm|rmdir|unlink|shred|truncate|del|erase|Remove-Item|sudo|chmod|chown|eval|exec|xargs|ssh|scp|sftp|curl|wget|sh|bash|zsh|dash|ksh)(?:\s|$)/i.test(plain))return true;
  if(/\bgit\b.*\s(?:-c|--config-env|--exec-path)(?:[=\s]|$)/.test(plain))return true;
  if(/\bgit\b.*\b(?:push|reset|clean|restore|checkout|rebase|filter-branch)\b/.test(plain))return true;
  if(/\bgh\b.*\b(?:create|edit|delete|merge|close|reopen|rerun|cancel|upload|fork|sync|auth|api|secret|variable)\b/.test(plain))return true;
  return /\bfind\b.*(?:-delete|-exec|-ok)/.test(plain);
 });
}
export function lowRiskTerminalQuery(core:any,command:string){
 if(terminalRequiresConfirmation(core,command))return false;
 const segments=terminalCommands(core,command)!;
 return segments.every((raw:string)=>{
  const segment=raw.replace(/(?:^|\s)2>\s*\/dev\/null(?=\s|$)/g,' ').trim();
  if(/[<>]/.test(segment))return false;
  if(/^(?:ls|pwd|echo)(?:\s|$)/.test(segment))return true;
  // Read-only gh forms. Unknown subcommands/options remain covered by the explicit grant path.
  return /^gh\s+(?:run\s+(?:view|list)|pr\s+(?:view|list|checks|status)|issue\s+(?:view|list|status)|release\s+(?:view|list)|repo\s+view)(?:\s|$)/.test(segment);
 });
}
