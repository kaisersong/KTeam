import {contextBridge,ipcRenderer} from 'electron';
import {DESKTOP_METHODS as methods} from './semantic-methods.js';
contextBridge.exposeInMainWorld('kteam',Object.freeze({...Object.fromEntries(methods.map(method=>[method,async(...args:unknown[])=>{
 const result=await ipcRenderer.invoke('kteam:semantic',method,args);
 if(result?.ok===false)throw new Error(typeof result.code==='string'?result.code:'desktop_request_failed');
 return result;
}])),onNotificationOpen:(listener:()=>void)=>{const handler=()=>listener();ipcRenderer.on('kteam:notification-open',handler);return ()=>ipcRenderer.removeListener('kteam:notification-open',handler);}}));
