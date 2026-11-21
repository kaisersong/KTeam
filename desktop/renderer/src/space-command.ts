// Only a human composer submission invokes this local action.
export function spaceCommand(text:string){return /^\/space(?:\s|$)/.test(text.trim());}
export function spaceCommandCandidate(value:string){
 const prefix=value.trim();
 return prefix.startsWith('/')&&'/space'.startsWith(prefix);
}
export async function runSpaceCommand(text:string,attachments:number,open:(input:{requestId:string})=>Promise<unknown>){
 if(!spaceCommand(text))return false;
 if(!/^\/space(?:\s+open)?$/.test(text.trim()))throw Error('命令用法：/space 或 /space open');
 if(attachments)throw Error('请先移除附件，再使用 /space；网页目录在工作台内选择。');
 await open({requestId:crypto.randomUUID()});return true;
}
