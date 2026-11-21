import {splashTitle,type SplashOpenInput,type SplashOpenResult} from '../../splash-input.js';

// Only a human composer submission invokes this local action.
export function spaceCommand(text:string){return /^\/space(?:\s|$)/.test(text.trim());}
export function spaceCommandCandidate(value:string){
 const prefix=value.trim();
 return prefix.startsWith('/')&&'/space'.startsWith(prefix);
}
export async function runSpaceCommand(text:string,attachments:number,open:(input:SplashOpenInput)=>Promise<SplashOpenResult>){
 const command=text.trim();
 if(!spaceCommand(command))return false;
 const args=command.slice('/space'.length).trim();
 let title:string|undefined;
 if(args&&args!=='open'){
  const explicit=/^create(?:\s+(.*))?$/i.exec(args);
  const chinese=/^(?:请\s*)?(?:(?:新建|创建)\s*(?:(?:一|1)\s*个\s*)?|建\s*(?:一|1)\s*个\s*)(?:空间[：:\s]+)?(.*)$/u.exec(args);
  if(!explicit&&!chinese)throw Error('命令用法：/space、/space open 或 /space create 空间名称');
  const name=explicit?(explicit[1]??''):chinese![1]!.replace(/(?:的\s*)?空间[。！？]?$/u,'');
  title=splashTitle(name);
 }
 if(attachments)throw Error('请先移除附件，再使用 /space；网页目录在工作台内选择。');
 return open({requestId:crypto.randomUUID(),...(title===undefined?{}:{title})});
}
