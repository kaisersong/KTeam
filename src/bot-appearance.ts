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
export function botAvatarSource(family:BotFamily,options:{expressive?:boolean;animated?:boolean;front?:boolean}={}) {
 if(family==='k'&&options.expressive)return `./brand/lively/curious-avatar${options.animated?'-animated':''}.svg`;
 return `./brand/bot-v3/${family}-${options.front?'front':'right34'}.svg`;
}
