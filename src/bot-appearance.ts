/** Supplied KTeam V3 hairstyles identify roles. Never use a list position as identity. */
export const BOT_FAMILIES = ['k', 'dev', 'design', 'pm', 'data', 'qa'] as const;
export type BotFamily = typeof BOT_FAMILIES[number];
export interface BotAppearanceIdentity {name:string; id?:string; description?:string; isAssistant?:boolean}
export function botFamily(identity:BotAppearanceIdentity):BotFamily {
 if(identity.isAssistant)return 'k';
 const name=identity.name.replace(/ · KTeam .+$/,'').trim().toLowerCase();
 const classify=(text:string):BotFamily|undefined=>{
  if(/质量|测试|\b(?:qa|test(?:er|ing)?)\b/.test(text))return 'qa';
  if(/设计|创意|\bdesign(?:er)?\b/.test(text))return 'design';
  if(/开发|工程|程序|技术|\b(?:dev(?:eloper)?|engineer|cto|codex|zcode)\b/.test(text))return 'dev';
  if(/产品|项目经理|\b(?:pm|product)\b/.test(text))return 'pm';
  if(/数据|分析|财务|研究|\b(?:data|analyst|finance|research)\b/.test(text))return 'data';
  if(/小\s*k|助理|助手|\b(?:ceo|assistant|master)\b/.test(text))return 'k';
 };
 const role=classify(name)??classify(identity.description?.toLowerCase()??'');
 if(role)return role;
 let hash=2166136261;
 for(const character of identity.id??name)hash=Math.imul(hash^character.codePointAt(0)!,16777619)>>>0;
 return BOT_FAMILIES[hash%BOT_FAMILIES.length]!;
}
export function botAvatarSource(family:BotFamily,options:{expressive?:boolean;animated?:boolean;front?:boolean;angle?:BotAngle}={}) {
 if(family==='k'&&options.expressive&&!options.angle)return `./brand/lively/curious-avatar${options.animated?'-animated':''}.svg`;
 return `./brand/${options.animated?'motion':'bot-v3'}/${family}-${options.angle??(options.front?'front':familyAngles[family])}.svg`;
}

export const BOT_ANGLES=['front','left34','right34','left','right','up','down'] as const;
export type BotAngle=typeof BOT_ANGLES[number];
const familyAngles:Record<BotFamily,BotAngle>={k:'front',dev:'left34',design:'right',pm:'left',data:'right34',qa:'up'};
export function botAngle(identity:BotAppearanceIdentity):BotAngle{
 const family=botFamily(identity);if(identity.isAssistant||family==='k')return 'front';if(!identity.id)return familyAngles[family];
 let hash=2166136261;for(const character of identity.id)hash=Math.imul(hash^character.codePointAt(0)!,16777619)>>>0;
 // Stable per-Bot variation; unaffected by sidebar ordering, display rename or job progress.
 const choices:BotAngle[]=[familyAngles[family],'front','left34','right34','left','right','up'];return choices[hash%choices.length]!;
}
export function workingBotAngle(base:BotAngle,step:number,faceForward=false):BotAngle{
 if(faceForward){const angles:BotAngle[]=['front','left34','front','right34'];return angles[((step%angles.length)+angles.length)%angles.length]!;}
 const sweep:BotAngle[]=base==='front'?['front','left34','front','down','front','right34','front','up']:base==='left'||base==='left34'?['left34','front','down','front','left34',base]:base==='right'||base==='right34'?['right34','front','down','front','right34',base]:[base,'front','left34','front','down','front','right34','front'];
 return sweep[((step%sweep.length)+sweep.length)%sweep.length]!;
}
