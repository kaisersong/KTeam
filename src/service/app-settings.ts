import {readIntegrations} from './integration-settings.js';
import {creatorSkillRoots} from '../runtime/creator-plugins.js';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {homedir} from 'node:os';
import {sharedRuntime} from '../runtime/native.js';

export async function appResources(cwd=homedir()){
 const core=await sharedRuntime(),roots=[...creatorSkillRoots(),process.env.KTEAM_SKILLS_ROOT,resolve(process.cwd(),'desktop/skills')].filter((p):p is string=>typeof p==='string'&&existsSync(p));
 const catalog=core.createSkillCatalog(core.getConfigDir(),cwd,{extraRoots:roots});await catalog.reload();
 const tools=core.buildToolList(core.createSkillTool(catalog),{cwd,allowOutsideCwd:false},[],new Map(),{isYolo:()=>false}).filter((t:any)=>!['install_skill','uninstall_skill','render_ui','kim_judge_messages'].includes(t.definition.name));
 const integration=await readIntegrations('catalog');const allTools=[...new Map(tools.flatMap((t:any)=>[t,...(t.companionTools??[])]).map((t:any)=>[t.definition.name,t])).values()] as any[];
 const rules=core.mergeRules(await core.loadSettings(cwd));
 return {skills:catalog.list().map((s:any)=>({name:s.name,description:s.description,source:s.source})),tools:allTools.map((t:any)=>({name:t.definition.name,description:integration.tools.descriptions[t.definition.name]??t.definition.description,defaultDescription:t.definition.description,disabled:integration.tools.disabled.includes(t.definition.name),permission:t.permission})),permissions:{mode:'default',allow:rules.allowRules,deny:rules.denyRules}};
}
