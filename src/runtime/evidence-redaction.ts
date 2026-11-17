import {openSync,constants,closeSync,fstatSync,readFileSync,writeFileSync,realpathSync,statSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {KTeamError,fields,record,text} from '../errors.js';
const secretField=/(?:api[_-]?key|password|passwd|secret|token|credential|private[_-]?key|authorization)/i;
/** Redact by field identity as well as recognizable credential formats. Never publish the original config. */
export function redactEvidence(value:string,redact:(text:string)=>{text:string}){
 let parsed:unknown;try{parsed=JSON.parse(value);}catch{return redact(value).text.replace(/((?:api[_-]?key|password|passwd|secret|token|credential)\s*[:=]\s*)([^\s\n]+)/gi,'$1<redacted>');}
 const scrub=(node:unknown):unknown=>Array.isArray(node)?node.map(scrub):node&&typeof node==='object'?Object.fromEntries(Object.entries(node).map(([key,item])=>[key,secretField.test(key)?'<redacted>':scrub(item)])):typeof node==='string'?redact(node).text:node;
 return JSON.stringify(scrub(parsed),null,2);
}
export async function exportEvidence(input:unknown,cwd:string,guard:()=>Promise<void>,assertPath:(name:string,args:Record<string,unknown>,cwd:string)=>void,redact:(text:string)=>{text:string}){
 const value=record(input);fields(value,['source','destination']);const requested=resolve(cwd,text(value.source,'source',4096)),source=realpathSync(requested),destination=resolve(cwd,text(value.destination,'destination',4096));
 await guard();assertPath('read',{file_path:source},cwd);assertPath('write',{file_path:destination},cwd);
 const fd=openSync(source,constants.O_RDONLY|constants.O_NOFOLLOW);let content:string;try{const stat=fstatSync(fd);if(!stat.isFile()||stat.size>1024*1024)throw new KTeamError('evidence_source_invalid',409);const bytes=readFileSync(fd);content=bytes.toString('utf8');if(!Buffer.from(content,'utf8').equals(bytes))throw new KTeamError('evidence_text_required',409);}finally{closeSync(fd);}
 const body=redactEvidence(content,redact);await guard();assertPath('write',{file_path:destination},cwd);if(realpathSync(dirname(destination))!==dirname(destination)||!statSync(dirname(destination)).isDirectory())throw new KTeamError('evidence_target_changed',409);
 const output=openSync(destination,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{writeFileSync(output,body);}finally{closeSync(output);}
 return {ok:true,source,destination,redacted:true,notice:'已按凭据字段和已知密钥格式脱敏；分享前仍须核对业务敏感内容。原配置未修改，无需回写恢复。'};
}
