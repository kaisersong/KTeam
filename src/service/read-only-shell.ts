import {localGitWorkflow} from './git-local-workflow.js';
/** A bounded recognizer for local read-only shell checks, not a general shell parser.
 * Unknown grammar stays on the ordinary approval path. No shell is run to classify it. */
type Word={kind:'word';value:string;raw:string;refs:string[];subs:Token[][]};
type Token=Word|{kind:'op';value:string};
const reserved=/^(?:PATH|IFS|ENV|BASH_ENV|SHELL|SHELLOPTS|BASHOPTS|CDPATH|HOME|PWD|OLDPWD|GLOBIGNORE|GREP_OPTIONS|ZDOTDIR|LD_.*|DYLD_.*|BASH_.*|ZSH_.*|PS[0-9]|PROMPT_COMMAND|HIST.*)$/;
function inspectShell(command:string,literalAllowed:(word:string)=>boolean,onCommand:(command:string)=>void,allowLocalChanges:boolean):boolean{
 if(!command.trim()||command.length>8192||command.includes('\0'))return false;
 let index=0,count=0;
 const fail=()=>{throw Error('unsupported_shell');};
 function scan(depth=0,sub=false):Token[]{
  if(depth>4)fail();const tokens:Token[]=[];
  while(index<command.length){
   const char=command[index]!;
   if(char===')'&&sub){index++;return tokens;}
   if(/[ \t\r]/.test(char)){index++;continue;}
   if(char==='\n'){tokens.push({kind:'op',value:';'});index++;continue;}
   if(command.startsWith('>&1',index)||command.startsWith('>&2',index)){tokens.push({kind:'op',value:command.slice(index,index+3)});index+=3;continue;}
   if(/[;&|<>]/.test(char)){let value=char;index++;if(command[index]===char){value+=char;index++;}if(![';','&&','||','|','>'].includes(value))fail();tokens.push({kind:'op',value});continue;}
   if(/[(){}#`]/.test(char))fail();
   const start=index,word:Word={kind:'word',value:'',raw:'',refs:[],subs:[]};let quote='';
   while(index<command.length){
    const c=command[index]!;
    if(!quote&&(/[\s;&|<>()]/.test(c)))break;
    if(c==="'"&&quote!=='"'){quote=quote==="'"?'':"'";index++;continue;}
    if(c==='"'&&quote!=="'"){quote=quote==='"'?'':'"';index++;continue;}
    if(c==='\\'&&!quote&&['"',"'"].includes(command[index+1]??'')){word.value+=command[index+1];index+=2;continue;}
    if(c==='\\'&&quote==='"'){const next=command[index+1];if(!next||next==='\n')fail();word.value+=['$','"','\\'].includes(next!)?next:'\\'+next;index+=2;continue;}
    if(quote!=="'"&&c==='$'){
     if(command[index+1]==='('){index+=2;word.subs.push(scan(depth+1,true));word.value+='@sub';continue;}
     const match=command.slice(index+1).match(/^[A-Za-z_][A-Za-z0-9_]*/);if(!match)fail();word.refs.push(match![0]);word.value+='@var';index+=match![0].length+1;continue;
    }
    if(quote!=="'"&&(/[{}#`\\]/.test(c)))fail();word.value+=c;index++;
   }
   word.raw=command.slice(start,index);if(quote||++count>512||!literalAllowed(word.value.replace(/^[A-Za-z_][A-Za-z0-9_]*=/,'')))fail();tokens.push(word);
  }
  if(sub)fail();return tokens;
 }
 function inspect(tokens:Token[],variables=new Set<string>(),depth=0,safeGitVariables=new Set<string>()):boolean{
  if(depth>4||!tokens.length)return false;
  const blocks:('test'|'body'|'else'|'loop-await'|'loop')[]=[];let segment:Token[]=[];let good=true,seen=false;
  const wordOK=(word:Word)=>word.refs.every(name=>variables.has(name))&&word.subs.every(sub=>inspect(sub,new Set(variables),depth+1,new Set(safeGitVariables)));
  function check(){
   if(!segment.length)return;seen=true;let words:Word[]=[];
   for(let i=0;i<segment.length;i++){
    const token=segment[i]!;
    if(token.kind==='op'){
     if(['>&1','>&2'].includes(token.value)){if(words.at(-1)?.value==='2'||words.at(-1)?.value==='1')words.pop();continue;}
     const target=segment[++i];if(token.value!=='>'||target?.kind!=='word'||target.value!=='/dev/null'||target.refs.length||target.subs.length){good=false;return;}
     if(words.at(-1)?.value==='2'||words.at(-1)?.value==='1')words.pop();continue;
    }
    if(!wordOK(token)){good=false;return;}words.push(token);
   }
   segment=[];if(!words.length){good=false;return;}
   const fixed=(word:Word|undefined)=>word&&!word.refs.length&&!word.subs.length?word.value:undefined;
   let head=fixed(words[0]);
   if(head==='then'||head==='else'){
    const expected=head==='then'?'test':'body';if(blocks.at(-1)!==expected){good=false;return;}blocks[blocks.length-1]=head==='then'?'body':'else';words=words.slice(1);if(!words.length)return;head=fixed(words[0]);
   }
   if(head==='do'){if(blocks.at(-1)!=='loop-await'){good=false;return;}blocks[blocks.length-1]='loop';words=words.slice(1);if(!words.length)return;head=fixed(words[0]);}
   if(head==='done'){if(words.length!==1||blocks.pop()!=='loop')good=false;return;}
   if(head==='for'){const variable=fixed(words[1]);if(!variable||!/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable)||(reserved.test(variable)||Object.hasOwn(process.env,variable))||fixed(words[2])!=='in'||words.length<4||words.length>35||words.slice(3).some(word=>fixed(word)===undefined||/[?*\[]/.test(word.value))){good=false;return;}variables.add(variable);if(words.slice(3).every(word=>/^[A-Za-z0-9_./:@~+-]+$/.test(word.value)&&!word.value.startsWith('-')))safeGitVariables.add(variable);else safeGitVariables.delete(variable);blocks.push('loop-await');return;}
   if(head==='fi'){if(words.length!==1||!['body','else'].includes(blocks.pop()??''))good=false;return;}
   if(head==='if'){blocks.push('test');words=words.slice(1);head=fixed(words[0]);}
   if(head==='['){onCommand(words.map(word=>word.raw).join(' '));if(words.length!==4||!['-n','-z','-d','-f','-e','-r','-s','-L','-h'].includes(fixed(words[1])??'')||fixed(words[3])!==']')good=false;return;}
   const assignment=words[0]?.value.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
   if(assignment){if(words.length!==1||(reserved.test(assignment[1]!)||Object.hasOwn(process.env,assignment[1]!))){good=false;return;}variables.add(assignment[1]!);const value=words[0]!.value.slice(assignment[0].length);if(!words[0]!.refs.length&&!words[0]!.subs.length&&/^[A-Za-z0-9_./:@~+-]+$/.test(value)&&!value.startsWith('-'))safeGitVariables.add(assignment[1]!);else safeGitVariables.delete(assignment[1]!);return;}
   if(!head||!['ls','pwd','echo','head','grep','cd','cat','printf','tail','stat','du','true','false','git','cut','wc','sed',...(allowLocalChanges?['mkdir','cp','mv','ln','touch','tee','npm','pnpm','yarn','make','cmake','swift','xcodebuild','cargo','go']:[])].includes(head)){good=false;return;}
   if(head==='sed'){const script=fixed(words[2]);if(fixed(words[1])!=='-n'||!script||!/^([0-9]+|\$)?(,([0-9]+|\$))?p$/.test(script)||words.slice(3).some(word=>word.value.startsWith('-')||word.subs.length||word.refs.some(name=>!safeGitVariables.has(name)))){good=false;return;}}
   if(head==='git'){
    let args=words.slice(1);while(fixed(args[0])==='--no-pager'||fixed(args[0])==='-C'){if(fixed(args[0])==='-C'){if(!args[1]||args[1].subs.length||args[1].refs.some(name=>!safeGitVariables.has(name))||args[1].value.startsWith('-')){good=false;return;}args=args.slice(2);}else args=args.slice(1);}
    const verb=fixed(args.shift());if(!verb||!['show','log','status','diff','rev-parse','ls-files','ls-tree','cat-file','--version','version',...(allowLocalChanges?['add','commit','worktree','checkout','switch','merge']:[])].includes(verb)){good=false;return;}
    if(['checkout','switch','merge'].includes(verb)&&(!allowLocalChanges||args.some(word=>fixed(word)===undefined)||!localGitWorkflow(verb,args.map(word=>word.value)))){good=false;return;}
    if(verb==='worktree'&&(fixed(args[0])!=='add'||!args.some(word=>fixed(word)==='--detach'))){good=false;return;}
    if(args.some(word=>word.subs.length||word.refs.some(name=>!safeGitVariables.has(name))||/[*?\[]/.test(word.value)||word.value==='-o'||['--output','--ext-diff','--textconv','--filters','--open-files-in-pager','--exec','--upload-pack','--receive-pack'].some(option=>{const name=word.value.split('=')[0]!;return name.startsWith('--')&&name!=='--'&&option.startsWith(name);}))){good=false;return;}
   }
   onCommand(words.map(word=>word.raw).join(' '));
   if(head==='printf'){const format=fixed(words[1]);if(!format||format.startsWith('-')||/%(?:[-+ #0]*[0-9]*(?:\.[0-9]+)?)n/.test(format.replaceAll('%%','')))good=false;}
   if(head==='cd'&&(words.length!==2||!words[1]!.value||words[1]!.value.startsWith('-')))good=false;
  }
  for(const token of tokens){if(token.kind==='op'&&[';','&&','||','|'].includes(token.value)){check();if(!good)return false;}else segment.push(token);}
  check();return good&&seen&&!blocks.length;
 }
 try{return inspect(scan());}catch{return false;}
}

export const readOnlyShell=(command:string,literalAllowed:(word:string)=>boolean=()=>true,onCommand:(command:string)=>void=()=>{})=>inspectShell(command,literalAllowed,onCommand,false);
/** Eligibility for a scoped human grant, never automatic permission for local writes. */
export const routineShell=(command:string,literalAllowed:(word:string)=>boolean=()=>true,onCommand:(command:string)=>void=()=>{})=>inspectShell(command,literalAllowed,onCommand,true);
