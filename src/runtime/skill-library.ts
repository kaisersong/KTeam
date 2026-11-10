import {creatorSkillRoots} from './creator-plugins.js';
import {createHash} from 'node:crypto';
import {existsSync,realpathSync,statSync,openSync,closeSync,fstatSync,readSync,constants} from 'node:fs';
import {join,resolve,relative,isAbsolute,dirname} from 'node:path';
import {KTeamError} from '../errors.js';

export interface SkillScope {root:string;botId:string;roomId:string}
export interface SkillPin {roomId:string;name:string;version:string}
export const skillBindingRoot=(scope:SkillScope)=>join(scope.root,'harness-assets',createHash('sha256').update(scope.botId+'\n'+scope.roomId).digest('hex'));
export function skillRoots(scope?:SkillScope){return [...(scope?[join(skillBindingRoot(scope),'skills')]:[]),...creatorSkillRoots(),process.env.KTEAM_SKILLS_ROOT,resolve(process.cwd(),'desktop/skills')].filter((path):path is string=>typeof path==='string'&&existsSync(path));}
export function scopedCatalog(core:any,cwd:string,scope?:SkillScope,onIssue?:(issue:any)=>void){
 const original=core.createSkillCatalog(core.getConfigDir(),cwd,{extraRoots:skillRoots(scope),onDiscoveryIssue:onIssue}),reported=new Set<string>();
 const allowed=(skill:any)=>{if(!scope)return true;try{const paths=[skill.path,...[...(skill.referencesManifest??[]),...(skill.scriptsManifest??[]),...(skill.assetsManifest??[])].map(file=>file.absolutePath)],valid=paths.every(path=>{const actual=realpathSync(path),stat=statSync(actual);return stat.isFile()&&stat.nlink===1&&(!within(resolve(scope.root),actual)||within(join(skillBindingRoot(scope),'skills'),actual)||within(join(core.getConfigDir(),'skills'),actual));});if(valid)return true;}catch{}if(!reported.has(skill.path)){reported.add(skill.path);onIssue?.({kind:'skill_read_unavailable',path:skill.path});}return false;};
 return {...original,reload:async()=>{reported.clear();await original.reload();return original.list().filter(allowed);},list:()=>original.list().filter(allowed),get:(name:string)=>{const skill=original.get(name);return skill&&allowed(skill)?skill:undefined;},resolve:(names:string[])=>original.resolve(names).filter(allowed)};
}
const within=(root:string,path:string)=>{const part=relative(root,path);return !isAbsolute(part)&&part!=='..'&&!part.startsWith('../');};
/** Bounds reads and rejects path substitution; versions include all declared resources. */
function bytes(path:string,root:string,max:number){
 if(!within(root,path)||realpathSync(path)!==resolve(path)||!within(realpathSync(root),realpathSync(path)))throw new KTeamError('skill_source_unavailable',409);
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);try{const before=fstatSync(fd);if(!before.isFile()||before.nlink!==1||before.size>max)throw new KTeamError('skill_source_unavailable',409);const buffer=Buffer.alloc(before.size+1),count=readSync(fd,buffer,0,buffer.length,0),after=fstatSync(fd);if(count!==before.size||after.nlink!==1||before.ino!==after.ino||before.dev!==after.dev||before.size!==after.size||before.mtimeMs!==after.mtimeMs||realpathSync(path)!==path)throw new KTeamError('skill_source_changed',409);return buffer.subarray(0,count);}finally{closeSync(fd);}
}
export function skillSnapshot(skill:any,budget={remaining:16*1024*1024}){
 try{
  let total=0;const root=resolve(skill.rootDir??dirname(skill.path)),path=resolve(skill.path);
  const read=(path:string,limit:number)=>{const body=bytes(path,root,Math.min(limit,budget.remaining,16*1024*1024-total));total+=body.length;budget.remaining-=body.length;return body;};
  const raw=read(path,256*1024),resources=[...(skill.referencesManifest??[]),...(skill.scriptsManifest??[]),...(skill.assetsManifest??[])].sort((a,b)=>a.relativePath.localeCompare(b.relativePath));
  if(resources.length>1000)throw new KTeamError('skill_source_unavailable',409);
  const hash=createHash('sha256').update(path+'\n').update(raw);
  for(const file of resources)hash.update('\n'+file.relativePath+'\n').update(read(resolve(file.absolutePath),2*1024*1024));
  return {version:hash.digest('hex'),content:raw.toString('utf8'),bytes:total,resources:resources.map(file=>({path:file.relativePath,kind:file.kind,bytes:file.size}))};
 }catch(error){if(error instanceof KTeamError)throw error;throw new KTeamError('skill_source_unavailable',409);}
}
export function skillSource(skill:any,scope?:SkillScope){return typeof skill.path!=='string'?'missing':scope&&within(join(skillBindingRoot(scope),'skills'),resolve(skill.path))?'room':skill.source;}
export function parseSkillPins(value:unknown):SkillPin[]{
 if(value===undefined)return [];if(!Array.isArray(value)||value.length>500)throw new KTeamError('skill_pins_invalid',409);const keys=new Set<string>();return value.map(pin=>{if(!pin||typeof pin!=='object'||Object.keys(pin).some(key=>!['roomId','name','version'].includes(key))||typeof pin.roomId!=='string'||!pin.roomId||pin.roomId.length>256||typeof pin.name!=='string'||!pin.name||pin.name.length>256||typeof pin.version!=='string'||!/^[a-f0-9]{64}$/.test(pin.version))throw new KTeamError('skill_pins_invalid',409);const key=JSON.stringify([pin.roomId,pin.name]);if(keys.has(key))throw new KTeamError('skill_pins_invalid',409);keys.add(key);return {...pin};});
}
export function assertSkillPins(catalog:any,pins:SkillPin[],roomId:string){const budget={remaining:64*1024*1024};for(const pin of parseSkillPins(pins).filter(pin=>pin.roomId===roomId)){const skill=catalog.get(pin.name);if(!skill||skillSnapshot(skill,budget).version!==pin.version)throw new KTeamError('skill_version_changed',409);}}

// Serialize writes to one existing Bot/Room asset directory, including runtime tools.
const mutations=new Map<string,Promise<unknown>>();
export async function withSkillMutation<T>(scope:SkillScope,action:()=>Promise<T>):Promise<T>{const key=skillBindingRoot(scope),prior=mutations.get(key)??Promise.resolve(),running=prior.catch(()=>{}).then(action);mutations.set(key,running);try{return await running;}finally{if(mutations.get(key)===running)mutations.delete(key);}}
