/** Official release builds keep the wordmark quiet. Local/branch builds expose their actual stamp. */
export function buildTooltip(info:any){
 if(!info||info.official===true||typeof info.version!=='string'||typeof info.revision!=='string'||typeof info.builtAt!=='string')return undefined;
 const date=new Date(info.builtAt);if(!Number.isFinite(date.getTime()))return undefined;
 return `版本：${info.version}\n构建号：${info.buildNumber??info.revision.slice(0,7)}${info.dirty?'（含未提交修改）':''}\n提交：${info.revision.slice(0,7)}\n构建时间：${date.toLocaleString('zh-CN',{hour12:false,timeZoneName:'short'})}`;
}
