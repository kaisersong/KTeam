/** Inspect GitHub CLI request semantics. Unknown operations never become read queries. */
export function readOnlyGh(args:{value:string;dynamic:boolean;quoted:boolean}[]):boolean{
 const fixed=(index:number)=>args[index]&&!args[index]!.dynamic?args[index]!.value:undefined;
 if(fixed(0)==='auth'){
  if(fixed(1)!=='status')return false;
  for(let i=2;i<args.length;i++){const flag=fixed(i);if(flag==='--active'||flag==='-a'||flag==='--no-refresh')continue;if(flag==='--hostname'||flag==='-h'){if(fixed(++i)!=='github.com')return false;continue;}if(flag==='--json'||flag==='--jq'||flag==='-q'||flag==='--template'||flag==='-t'){if(flag==='-t'||fixed(++i)===undefined)return false;continue;}return false;}return true;
 }
 if(fixed(0)==='api'){
  let endpoint=false;
  for(let i=1;i<args.length;i++){
   const word=args[i]!,flag=fixed(i);
   if(flag==='--method'||flag==='-X'){if(!['GET','HEAD'].includes(fixed(++i)??''))return false;continue;}
   if(flag?.startsWith('--method=')){if(!['GET','HEAD'].includes(flag.slice(9)))return false;continue;}
   if(['--jq','-q','--template','-t','--cache'].includes(flag??'')){if(fixed(++i)===undefined)return false;continue;}
   if(['--paginate','--slurp','--include','-i','--silent'].includes(flag??''))continue;
   if(word.value.startsWith('-')||endpoint||word.dynamic&&!word.quoted||!/^\/?[A-Za-z0-9_][A-Za-z0-9_./{}@?&=%:+-]*$/.test(word.value)||word.value.includes('://'))return false;
   endpoint=true;
  }
  // --field, --raw-field and --input can change the default method or send local
  // file bytes. GraphQL and credential-display commands keep separate approval.
  return endpoint&&args.every(word=>word.value!=='graphql');
 }
 return ['run','pr','issue','release','repo'].includes(fixed(0)??'')&&['view','list','checks','status'].includes(fixed(1)??'')&&args.slice(2).every(word=>!word.dynamic)&&!args.some(word=>['--web','-w','--log','--log-failed'].includes(word.value));
}
