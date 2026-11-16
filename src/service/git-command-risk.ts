/** Literal argv inspection: Git global options end at the subcommand. */
function words(segment:string):string[]|undefined{
 const result:string[]=[];let word='',quote='',started=false;
 for(let index=0;index<segment.length;index++){
  const char=segment[index]!;
  if(quote){if(char===quote){quote='';continue;}if(quote==='"'&&/[`$]/.test(char))return;if(char==='\\'&&quote==='"'&&/["\\$`]/.test(segment[index+1]??'')){word+=segment[++index];continue;}word+=char;continue;}
  if(char==='"'||char==="'"){quote=char;started=true;continue;}
  if(/\s/.test(char)){if(started){result.push(word);word='';started=false;}continue;}
  if(/[`$]/.test(char))return;
  if(char==='\\'&&process.platform!=='win32'){if(index+1>=segment.length)return;word+=segment[++index];started=true;continue;}
  word+=char;started=true;
 }
 if(quote)return;if(started)result.push(word);return result;
}

/** Undefined keeps the existing conservative path for opaque shell wrappers. */
export function gitCommandRisk(segment:string):boolean|undefined{
 const args=words(segment);if(!args?.length)return;
 while(args.length&&(/^[A-Za-z_][A-Za-z0-9_]*=/.test(args[0]!)||['do','then','if','!'].includes(args[0]!)))args.shift();
 if(args[0]==='command'){args.shift();while(['-p','--'].includes(args[0]??''))args.shift();}
 const program=args.shift()?.replaceAll('\\','/').split('/').at(-1)?.replace(/\.exe$/i,'').toLowerCase();if(program!=='git')return;
 while(args[0]?.startsWith('-')){
  const option=args.shift()!;if(option==='--')break;
  if(option.startsWith('-c')||/^--(?:config-env|exec-path)(?:=|$)/.test(option))return true;
  if(['-C','--git-dir','--work-tree','--namespace','--super-prefix'].includes(option)&&args.shift()===undefined)return true;
 }
 const verb=args.shift();if(!verb)return false;
 if(['push','reset','clean','restore','rebase','filter-branch','config','remote','gc'].includes(verb))return true;
 if(['checkout','switch'].includes(verb))return args.some(arg=>arg==='--'||/^(?:-[fBC]|--(?:force|discard-changes|force-create))(?:=|$)/.test(arg));
 if(verb==='merge')return args.some(arg=>/^--(?:abort|strategy)(?:-|=|$)/.test(arg)||/^-s/.test(arg));
 if(['branch','tag'].includes(verb))return args.some(arg=>/^-[dD]/.test(arg)||/^--delete(?:=|$)/.test(arg));
 if(verb==='worktree')return ['remove','prune','move','repair'].includes(args[0]??'');
 if(verb==='commit')return args.includes('--amend');
 if(verb==='grep')return args.some(arg=>arg.startsWith('-O')||/^--open-files-in-pager(?:=|$)/.test(arg));
 return false;
}
