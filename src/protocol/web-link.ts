/** Only an explicit web navigation; never a file, shell command or custom protocol. */
export function webLinkUrl(value:unknown):string|undefined{
 if(typeof value!=='string'||!value||value.length>8192||/[\x00-\x20\x7f]/.test(value)||!/^https?:\/\//i.test(value))return;
 try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)&&url.hostname&&!url.username&&!url.password?url.href:undefined;}catch{return;}
}
