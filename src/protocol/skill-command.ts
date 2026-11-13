/** A leading slash names a Skill, never a shell command or an absolute file path. */
export function parseSkillCommand(text:string):{name:string;arguments:string}|undefined{
 const match=/^\/(?:skill\s+)?([\p{L}\p{N}_.:-]+)(?:\s+([\s\S]*))?$/u.exec(text.trim());
 return match?{name:match[1]!,arguments:match[2]?.trim()??''}:undefined;
}
export function skillCommandNeedsList(text:string){return /^\/(?:skills?|help)?\s*$/.test(text.trim());}
