import {contextBridge,ipcRenderer} from 'electron';
const methods=['status','bots','teams','models','runtimes','createBot','createTeam','send','messages','settings','work','pause','resume','seen','review','reconcile','bootstrap','direct','proposals','acceptProposal','inbox','resumeCreation','onboarding','saveOnboarding','createFirstBot','finishOnboarding','agentConnections','inviteAgent','agentInvitation','approveAgent','revokeAgent','useSystemAgent','editGroup','saveBot'];
contextBridge.exposeInMainWorld('kteam',Object.freeze(Object.fromEntries(methods.map(method=>[method,async(...args:unknown[])=>{
 const result=await ipcRenderer.invoke('kteam:semantic',method,args);
 if(result?.ok===false)throw new Error(typeof result.code==='string'?result.code:'desktop_request_failed');
 return result;
}]))));
