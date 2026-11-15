/** Local branch creation and integration can reuse a human directory grant. */
export function localGitWorkflow(verb:string,args:string[]):boolean{
 const ref=(value:string)=>!!value&&!value.startsWith('-')&&!value.startsWith('/')&&!value.includes('..')&&!/[\s\\~^:?*\[\]@{}]/.test(value);
 if(verb==='checkout')return args.length>=2&&args.length<=3&&args[0]==='-b'&&args.slice(1).every(ref);
 if(verb==='switch')return args.length>=2&&args.length<=3&&(args[0]==='-c'||args[0]==='--create')&&args.slice(1).every(ref);
 if(verb==='merge'){const refs=args.filter(value=>!value.startsWith('-'));return refs.length===1&&refs.every(ref)&&args.every(value=>ref(value)||['--no-edit','--ff','--ff-only','--no-ff','--no-commit','--squash'].includes(value));}
 return false;
}
