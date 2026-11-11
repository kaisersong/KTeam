import {useState} from 'react';
import {Paperclip} from 'lucide-react';
import {attachmentMessageView} from '../../../src/protocol/message-attachments';
import {api,explain,type Message} from './api';
import {Modal} from './components';
export function MessageAttachments({message}:{message:Message}){
 const payload=attachmentMessageView(message),[preview,setPreview]=useState<any>(),[busy,setBusy]=useState(false),[error,setError]=useState('');if(!payload)return null;
 const read=async(fileId:string)=>{setBusy(true);setError('');try{setPreview(await api.previewMessageAttachment({roomId:message.roomId,messageId:message.messageId,fileId}));}catch(e){setError(explain(e));}finally{setBusy(false);}};
 return <div className="message-attachments" aria-label="这条消息的附件">{payload.attachments.map(file=><button className="message-attachment" type="button" key={file.fileId} disabled={busy} onClick={()=>void read(file.fileId)}><Paperclip size={15}/><span>{file.name}<small>{(file.bytes/1024).toFixed(1)} KiB</small></span></button>)}{error&&<p className="flow-error" role="alert">{error}</p>}{preview&&<Modal title={preview.file.name} onClose={()=>setPreview(undefined)}>{preview.preview!==null?<><pre className="raw-markdown">{preview.preview}</pre>{preview.truncated&&<p>预览已截断，完整文件保留在会话资料库。</p>}</>:<p className="form-note">资料已核对。此格式请在资料库中打开完整文件；成员会沿当前会话权限读取。</p>}<button className="secondary" onClick={()=>void api.openLibrary({roomId:message.roomId,fileId:preview.file.fileId}).catch(e=>setError(explain(e)))}>打开资料副本</button></Modal>}</div>;
}
