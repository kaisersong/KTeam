/** App data inside an ordinary L0 string body; it is never execution authority. */
export const ATTACHMENT_EXTENSIONS=new Set(['md','txt','csv','json','log','html','pdf','docx','pptx','xlsx','png','jpg','jpeg','gif','webp']);
export interface MessageAttachment {fileId:string;name:string;bytes:number;sha256:string;hostId:string;extension:string}
export interface AttachmentMessage {kind:'kteam_message_with_attachments';version:1;text:string;attachments:MessageAttachment[]}
const keys=(value:any,allowed:string[])=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>allowed.includes(key));
export function parseAttachmentMessage(body:unknown):AttachmentMessage|undefined{
 if(typeof body!=='string'||body.length>32768||!body.startsWith('{'))return;try{const value=JSON.parse(body);if(!keys(value,['kind','version','text','attachments'])||value.kind!=='kteam_message_with_attachments'||value.version!==1||typeof value.text!=='string'||value.text.length>24000||!Array.isArray(value.attachments)||value.attachments.length<1||value.attachments.length>4)return;
  for(const file of value.attachments)if(!keys(file,['fileId','name','bytes','sha256','hostId','extension'])||!/^[a-f0-9]{64}$/.test(file.fileId??'')||!/^[a-f0-9]{64}$/.test(file.sha256??'')||typeof file.name!=='string'||!file.name||file.name.length>256||/[\\/\0]/.test(file.name)||!Number.isSafeInteger(file.bytes)||file.bytes<0||file.bytes>4*1024*1024||typeof file.hostId!=='string'||!/^[A-Za-z0-9_.:-]{1,256}$/.test(file.hostId)||typeof file.extension!=='string'||!ATTACHMENT_EXTENSIONS.has(file.extension)||!file.name.toLowerCase().endsWith('.'+file.extension))return;
  if(new Set(value.attachments.map((file:MessageAttachment)=>file.fileId)).size!==value.attachments.length)return;return value;
 }catch{return;}
}
export function encodeAttachmentMessage(text:string,attachments:MessageAttachment[]):string{const body=JSON.stringify({kind:'kteam_message_with_attachments',version:1,text,attachments});if(!parseAttachmentMessage(body))throw Error('attachment_message_invalid');return body;}
export function attachmentMessageView(message:any){return message?.sender?.kind==='user'&&message.sourceRef?.kind==='aimp_l0'&&message.sourceRef?.envelope?.body===message.text?parseAttachmentMessage(message.text):undefined;}
export const messageDisplayText=(message:any)=>attachmentMessageView(message)?.text??message?.text??'';
