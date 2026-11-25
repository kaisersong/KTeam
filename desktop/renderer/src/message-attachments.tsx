import {useEffect,useRef,useState} from 'react';
import {Paperclip,Image as ImageIcon,RefreshCw} from 'lucide-react';
import {attachmentMessageView,attachmentImageType,type MessageAttachment} from '../../../src/protocol/message-attachments';
import {api,explain,type Message} from './api';
import {showMessageAttachment} from './artifact-viewer';
function ImageAttachment({message,file,onOpen}:{message:Message;file:MessageAttachment;onOpen:()=>void}){
 const button=useRef<HTMLButtonElement>(null),[visible,setVisible]=useState(false),[image,setImage]=useState<string>(),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
 useEffect(()=>{const node=button.current;if(!node)return;if(!('IntersectionObserver'in window)){setVisible(true);return;}const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){setVisible(true);observer.disconnect();}},{rootMargin:'200px'});observer.observe(node);return()=>observer.disconnect();},[]);
 useEffect(()=>{if(!visible)return;let live=true;setImage(undefined);setError('');void api.previewMessageAttachment({roomId:message.roomId!,messageId:message.messageId,fileId:file.fileId,variant:'thumbnail'}).then(value=>{if(!value.image)throw Error('attachment_image_invalid');if(live)setImage('data:'+value.image.mediaType+';base64,'+value.image.base64);}).catch(e=>{if(live)setError(explain(e));});return()=>{live=false;};},[visible,message.roomId,message.messageId,file.fileId,attempt]);
 return <div className="message-image-attachment"><button ref={button} className="message-image-button" type="button" aria-label={'查看图片 '+file.name} onClick={onOpen}>{image?<img src={image} alt={file.name} loading="lazy" onError={()=>{setImage(undefined);setError('图片加载失败');}}/>:<span className="message-image-loading"><ImageIcon size={22}/>{error?'图片暂时无法显示':'正在加载图片…'}</span>}</button>{error&&<button className="text-button" type="button" onClick={()=>setAttempt(value=>value+1)}><RefreshCw size={12}/>重新加载</button>}</div>;
}
export function MessageAttachments({message}:{message:Message}){
 const payload=attachmentMessageView(message);
 if(!payload||!message.roomId)return null;
 const roomId=message.roomId;
 const open=(file:MessageAttachment)=>showMessageAttachment({roomId,messageId:message.messageId,fileId:file.fileId,name:file.name,extension:file.extension});
 return <div className="message-attachments" aria-label="这条消息的附件">{payload.attachments.map(file=>attachmentImageType(file.extension)
  ? <ImageAttachment key={file.fileId} message={message} file={file} onOpen={()=>open(file)}/>
  : <button className="message-attachment" type="button" key={file.fileId} onClick={()=>open(file)}>
     <Paperclip size={15}/><span>{file.name}<small>{(file.bytes/1024).toFixed(1)} KiB</small></span>
    </button>)}</div>;
}
