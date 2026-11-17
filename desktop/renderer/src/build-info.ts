/** Official release builds keep the wordmark quiet. Local/branch builds expose their actual stamp. */
export function buildTooltip(info:any){
 if(!info||info.official===true||typeof info.version!=='string'||typeof info.revision!=='string'||typeof info.builtAt!=='string')return undefined;
 const date=new Date(info.builtAt);if(!Number.isFinite(date.getTime()))return undefined;
 return `版本：${info.version}\n构建号：${info.buildNumber??info.revision.slice(0,7)}${info.dirty?'（含未提交修改）':''}\n提交：${info.revision.slice(0,7)}\n构建时间：${date.toLocaleString('zh-CN',{hour12:false,timeZoneName:'short'})}`;
}

/** A user-copyable identity remains available for official releases too. */
export function buildDetails(info:any){
 if(!info||typeof info.version!=='string'||typeof info.revision!=='string')return undefined;
 const lock=typeof info.lockfileSha256==='string'?info.lockfileSha256:'未记录';
 return `版本：${info.version}\n提交：${info.revision}\n构建号：${info.buildNumber??'未记录'}\n依赖指纹：${lock}\n依赖指纹短号：${lock.slice(0,12)}\n构建时间：${info.builtAt??'未记录'}\n来源：${info.official?'正式发布':'本地验证构建'}${info.dirty?'（含未提交修改）':''}`;
}
