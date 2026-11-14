// Deliberately absent from menus/skills. Only a human composer submission calls it.
export function splashCommand(text:string){return /^\/splash(?:\s|$)/.test(text.trim());}
export async function runSplashCommand(text:string,attachments:number,open:(input:{requestId:string})=>Promise<unknown>){
 if(!splashCommand(text))return false;
 if(!/^\/splash(?:\s+open)?$/.test(text.trim()))throw Error('隐藏命令用法：/splash 或 /splash open');
 if(attachments)throw Error('请先移除附件，再使用 /splash；网页目录在工作台内选择。');
 await open({requestId:crypto.randomUUID()});return true;
}
