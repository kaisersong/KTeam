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
 const assignments:string[]=[];
 while(args.length&&(/^[A-Za-z_][A-Za-z0-9_]*=/.test(args[0]!)||['do','then','if','!'].includes(args[0]!))){
  const prefix=args.shift()!;
  if(prefix.includes('='))assignments.push(prefix);
 }
 // A literal deadline does not change the Git operation. Only recognize this
 // bounded wrapper for ls-remote, with Git's noninteractive prompt setting.
 if(args[0]==='timeout'&&/^[1-9]\d{0,3}s?$/.test(args[1]??'')&&args[2]==='git'&&args[3]==='ls-remote'){
  if(assignments.some(value=>value!=='GIT_TERMINAL_PROMPT=0'))return true;
  args.splice(0,2);
 }
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
 if(verb==='ls-remote')return args.some(arg=>{
  const name=arg.split('=')[0]!;
  return /^-u/.test(name)||(name.startsWith('--u')&&'--upload-pack'.startsWith(name))||/^[a-z][a-z0-9+.-]*::/i.test(arg);
 });
 if(verb==='grep')return args.some(arg=>arg.startsWith('-O')||/^--open-files-in-pager(?:=|$)/.test(arg));
 return false;
}
