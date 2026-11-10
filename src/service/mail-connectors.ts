import {createHash,createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {execFile} from 'node:child_process';
import {sharedRuntime} from '../runtime/native.js';
import {KTeamError,fields,record} from '../errors.js';
/** xiaok owns mail protocol, OAuth, generation fences and the send receipt journal. */
export class MailConnectors{
 private service?:Promise<any>;
 private get(){return this.service??=this.create();}
 private async create(){const core=await sharedRuntime(),root=core.getConfigDir(),vault=core.systemCredentialBackend();
 const hash=createHash('sha256').update(root+'kteam-mail-encryption-v1').digest('hex'),keyId=`${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20,32)}`;
 const key=(create=false)=>{let value=vault.get(keyId);if(!value&&create){value=randomBytes(32).toString('hex');vault.put(keyId,value);}if(!value||!/^[a-f0-9]{64}$/.test(value))throw Error('mail_secure_storage_unavailable');return Buffer.from(value,'hex');};
 const crypto={isEncryptionAvailable:()=>true,getSelectedStorageBackend:()=>`kteam-${core.getCredentialStore()}`,encryptString:(text:string)=>{const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(true),iv);const bytes=Buffer.concat([cipher.update(text,'utf8'),cipher.final()]);return Buffer.concat([Buffer.from('KTM1'),iv,cipher.getAuthTag(),bytes]);},decryptString:(bytes:Buffer)=>{if(bytes.length<32||bytes.subarray(0,4).toString()!=='KTM1')throw Error('mail_store_unavailable');const decipher=createDecipheriv('aes-256-gcm',key(),bytes.subarray(4,16));decipher.setAuthTag(bytes.subarray(16,32));return Buffer.concat([decipher.update(bytes.subarray(32)),decipher.final()]).toString('utf8');}};
 const openExternal=async(value:string)=>{const url=new URL(value);if(!['https://accounts.google.com','https://login.microsoftonline.com'].includes(url.origin))throw Error('mail_authorization_failed');await new Promise<void>((resolve,reject)=>execFile(process.platform==='darwin'?'/usr/bin/open':process.platform==='win32'?'rundll32.exe':'xdg-open',process.platform==='win32'?['url.dll,FileProtocolHandler',url.href]:[url.href],{timeout:10000},error=>error?reject(error):resolve()));};
 return new core.MailConnectorService({store:new core.MailAccountStore(root,crypto),openExternal});
 }
 async view(){const service=await this.get();return {ok:true,accounts:service.list(),oauth:service.getOAuthState()};}
 async control(value:unknown){const input=record(value);fields(input,['action','value']);const service=await this.get(),args=input.value;
 try{switch(input.action){case 'connect':await service.connect(args,'user');break;case 'oauth':await service.beginOAuth(args,'user');break;case 'cancel':{const v=record(args);fields(v,['operationId']);await service.cancelOAuth(v.operationId,'user');break;}case 'disconnect':await service.disconnect(args,'user');break;case 'test':await service.test(args,'user');break;case 'access':await service.setAccess(args,'user');break;case 'search':return {ok:true,result:await service.search(args,'user')};case 'read':return {ok:true,result:await service.read(args,'user')};default:throw new KTeamError('mail_invalid_input');}return this.view();}catch(error){const code=error instanceof Error?error.message:'';if(/^mail_[a-z_]+$/.test(code))throw new KTeamError(code);throw new KTeamError('mail_invalid_input');}
 }
 async tools(){const core=await sharedRuntime(),service=await this.get();if(!service.list().length)return [];const tools=core.createMailTools(service).filter((t:any)=>t.definition.name!=='mail_send');
 // The registry's send_mail path always requests a fresh human approval before execute.
 tools.push({permission:'write',definition:{name:'send_mail',description:'发送已授权邮箱的纯文本邮件。必须逐次批准收件人和完整正文。requestId 需保持不变；结果不明不得重发。',inputSchema:{type:'object',additionalProperties:false,properties:{accountId:{type:'string'},requestId:{type:'string',format:'uuid'},to:{type:'array',items:{type:'string'}},subject:{type:'string'},text:{type:'string'}},required:['accountId','requestId','to','subject','text']}},execute:async(input:any)=>JSON.stringify(await service.send(input,'user'))});return tools;
 }
 async close(){if(this.service)(await this.service).dispose();}
}
