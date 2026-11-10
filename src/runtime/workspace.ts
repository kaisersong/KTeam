import {realpathSync,statSync} from 'node:fs';
import {resolve} from 'node:path';
import {sharedRuntime} from './native.js';
import {KTeamError} from '../errors.js';
/** The runtime-core tools and search guard are used as-is; the host binds cwd. */
export async function workspaceTools(workspace:string,assertCurrent:()=>void|Promise<void>){
 if(!workspace)return [];
 let root:string;try{root=realpathSync(workspace);if(root!==workspace||!statSync(root).isDirectory())throw Error();}catch{throw new KTeamError('bot_workspace_invalid');}
 const core=await sharedRuntime(),policy=core.createSandboxPolicy({pathAllowlist:[root],network:'deny'}),enforcer=core.createSandboxEnforcer(policy);
 return [core.createReadTool({cwd:root,allowOutsideCwd:false}),core.globTool,core.grepTool].map((tool:any)=>({...tool,async execute(input:Record<string,unknown>,context:any){
  await assertCurrent();if(realpathSync(root)!==root)throw new KTeamError('bot_workspace_changed',409);
  const name=tool.definition.name,key=name==='read'?'file_path':'path',path=resolve(root,String(input[key]??'.'));
  if(!enforcer.enforceFile(path).allowed)throw new KTeamError('workspace_path_forbidden',403);
  const scoped=core.withSandboxSearchScope(core.createNativeReadonlyExecutionContext(context),enforcer);
  const result=await tool.execute({...input,[key]:path,max_chars:Math.min(16000,Math.max(100,Number(input.max_chars)||12000))},scoped);await assertCurrent();return result;
 }}));
}
