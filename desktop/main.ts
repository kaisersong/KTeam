import {initStandalone} from '../src/runtime/managed-services.js';
import {app,BrowserWindow,dialog,ipcMain,Menu,Notification} from 'electron';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {existsSync,openSync,closeSync,readFileSync,appendFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {nativeActions} from './native-actions.js';
import {dataRoot,initConfig} from '../src/service/config.js';
import {hostRequest} from '../src/service/client.js';
import {createDesktopAPI,dispatchDesktop,trustedFrame} from './semantic-api.js';
import {NotificationDelivery} from './notification-delivery.js';
import {hostConnection} from './host-connection.js';
import {createKTeamUpdater,defaultUpdaterEnvironment,redactUpdaterDiagnostic} from './updater.js';

app.setName('KTeam');
const locked=app.requestSingleInstanceLock();
if(!locked)app.quit();
let window:BrowserWindow|undefined;let pendingNotificationNavigation:any;let notificationDelivery:NotificationDelivery|undefined;let notificationTimer:NodeJS.Timeout|undefined;
const root=dataRoot();
const environment=()=>Object.fromEntries(Object.entries(process.env).filter(([name,value])=>value!==undefined&&(['PATH','HOME','USER','LOGNAME','SHELL','TMPDIR','TEMP','TMP','TZ','LANG','LANGUAGE','NODE_EXTRA_CA_CERTS','SSL_CERT_FILE','SSL_CERT_DIR','HTTP_PROXY','HTTPS_PROXY','NO_PROXY','CODEX_HOME','KIMI_HOME','KIMI_CODE_HOME','ZCODE_HOME','XIAOK_HOME','http_proxy','https_proxy','no_proxy'].includes(name)||name.startsWith('LC_'))));
// Auto-update: KTeam's own GitHub Releases only (see desktop/updater.ts). Log lives in KTeam's data dir.
function logUpdater(event:string,diagnostic?:string){try{appendFileSync(join(root,'updater.log'),`${new Date().toISOString()} ${event}${diagnostic?' '+redactUpdaterDiagnostic(diagnostic):''}\n`,{mode:0o600});}catch{}}
const updater=createKTeamUpdater(defaultUpdaterEnvironment({isPackaged:app.isPackaged}),{onDownloaded:version=>void promptRestartForUpdate(version)});
const updaterHandoff=updater.createHandoff();
async function promptRestartForUpdate(version:string){
 const options={type:'info' as const,buttons:['立即重启并更新','稍后'],defaultId:0,cancelId:1,title:'KTeam 更新',message:`KTeam ${version} 已下载`,detail:'重启 KTeam 即可完成更新。选择「稍后」的话，下次退出 KTeam 时会自动安装。'};
 const picked=window&&!window.isDestroyed()?await dialog.showMessageBox(window,options):await dialog.showMessageBox(options);
 if(picked.response===0){const outcome=updaterHandoff.begin({requestSource:'user'});logUpdater('install-requested',outcome.status);}
}
async function checkForUpdatesFromMenu(){
 await updater.checkForUpdates({requestSource:'user'});
 const status=updater.getStatus();
 if(status.downloaded&&status.version){await promptRestartForUpdate(status.version);return;}
 const message=status.error?`检查更新失败：${redactUpdaterDiagnostic(status.error)}`:status.available?`正在后台下载 KTeam ${status.version??''}，下载完成后会提示你重启。`:`KTeam ${app.getVersion()} 已是最新版本。`;
 await dialog.showMessageBox({type:status.error?'warning':'info',buttons:['好'],title:'KTeam 更新',message});
}
function resources(){return app.getAppPath().endsWith('.asar')?app.getAppPath()+'.unpacked':app.getAppPath();}
let ensuringHost:Promise<void>|undefined;
function ensureHost(){return ensuringHost??=(ensureHostBody().finally(()=>{ensuringHost=undefined;}));}
async function ensureHostBody(){
 await initStandalone(root);
 try{await hostRequest(root,'kteam-main','/v1/handshake');return;}catch(error){
  const code=(error as NodeJS.ErrnoException).code;
  if(!['ENOENT','ECONNREFUSED','ECONNRESET'].includes(code??''))throw error;
 }
 const output=openSync(join(root,'host.log'),'a',0o600);
 let child;
 try{child=spawn(process.execPath,[join(resources(),'build','host.cjs')],{detached:true,windowsHide:true,stdio:['ignore',output,output],env:{...environment(),ELECTRON_RUN_AS_NODE:'1',KTEAM_DATA_DIR:root,KTEAM_SKILLS_ROOT:join(process.resourcesPath,'skills'),KTEAM_NATIVE_CHILD:join(resources(),'build','native-child.cjs'),KTEAM_RUNTIME_ENTRY:join(resources(),'build','shared','kteam-runtime.mjs')}});}finally{closeSync(output);}
 child.unref();
 const deadline=Date.now()+15000;
 let failed:Error|undefined;child.once('error',error=>{failed=error;});
 while(Date.now()<deadline){if(failed)throw failed;try{await hostRequest(root,'kteam-main','/v1/handshake');return;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
 throw Error('host_start_timeout');
}
async function show(){
 if(window&&!window.isDestroyed()){window.show();window.focus();return;}
 window=new BrowserWindow({width:1440,height:960,minWidth:950,minHeight:650,title:'KTeam',backgroundColor:'#ffffff',titleBarStyle:'hiddenInset',trafficLightPosition:{x:16,y:18},show:false,
  webPreferences:{preload:join(app.getAppPath(),'build','preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true}});
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 window.webContents.on('will-navigate',(event,url)=>{if(url!==window?.webContents.getURL())event.preventDefault();});
 window.once('ready-to-show',()=>window?.show());
 if(!app.isPackaged&&process.env.KTEAM_DEV_URL)await window.loadURL(process.env.KTEAM_DEV_URL);
 else await window.loadFile(join(app.getAppPath(),'build','renderer','index.html'));
 window.once('closed',()=>{window=undefined;});
}
if(locked){
 app.on('second-instance',()=>void show());
 app.whenReady().then(async()=>{
  try{await ensureHost();}catch(error){console.error('KTeam host unavailable:',(error as {code?:string}).code??'startup_failed');}
  let buildInfo={version:app.getVersion()};try{buildInfo=JSON.parse(readFileSync(join(app.getAppPath(),'build','build-info.json'),'utf8'));}catch{}
  const connectedRequest=hostConnection({request:(route,value)=>hostRequest(root,'kteam-main',route,value),ensureHost});
  notificationDelivery=new NotificationDelivery({request:connectedRequest,supported:()=>Notification.isSupported(),foreground:()=>!!window&&!window.isDestroyed()&&window.isVisible()&&window.isFocused(),create:options=>new Notification(options),navigate:async navigation=>{pendingNotificationNavigation=navigation;await show();window?.webContents.send('kteam:notification-open');}});
  if(process.platform==='darwin')void Notification.getHistory().then(history=>{for(const notice of history.slice(-100))notificationDelivery?.retain(notice.id,notice);}).catch(()=>{});
  notificationTimer=setInterval(()=>void notificationDelivery?.poll(),2000);notificationTimer.unref();
  app.once('before-quit',()=>{if(notificationTimer)clearInterval(notificationTimer);notificationDelivery?.close();});
  const api=createDesktopAPI(async(route,value)=>{const result=await connectedRequest(route,value);return route==='/v1/status'?{...result,desktop:buildInfo}:result;},{nativeActions:{...nativeActions(root,()=>window),takeNotificationNavigation:async()=>{const navigation=pendingNotificationNavigation;pendingNotificationNavigation=undefined;return {ok:true,navigation};},testDesktopNotification:async()=>notificationDelivery!.test(),notificationDeliveryState:async()=>{const state=notificationDelivery!.status();let testInSystemCenter:boolean|undefined;if(process.platform==='darwin'&&state.lastTestId)try{testInSystemCenter=(await Notification.getHistory()).some(notice=>notice.id===state.lastTestId);}catch{}return {ok:true,...state,testInSystemCenter};}},agentLauncher:[app.isPackaged?join(process.resourcesPath,'bin','kteam'):process.execPath,...(app.isPackaged?[]:[join(app.getAppPath(),'build','agent-cli.cjs')])]});
  ipcMain.handle('kteam:semantic',async(event,method,args)=>{
   if(!window||!trustedFrame(event.senderFrame,window.webContents.mainFrame))return {ok:false,code:'desktop_sender_forbidden'};
   try{return await dispatchDesktop(api,method,args);}catch(error){return {ok:false,code:(error as {code?:string}).code??'desktop_request_failed'};}
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'KTeam',submenu:[{label:'关于 KTeam',role:'about'},{label:'检查更新…',click:()=>void checkForUpdatesFromMenu()},{type:'separator'},{label:'隐藏 KTeam',role:'hide'},{type:'separator'},{label:'退出 KTeam（后台继续工作）',accelerator:'Command+Q',click:()=>app.quit()}]},{label:'编辑',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},{label:'窗口',submenu:[{role:'minimize'},{role:'zoom'}]}]));
  await show();app.on('activate',()=>void show());
  void updater.setup(logUpdater,{requestSource:'scheduler'}).catch(error=>logUpdater('setup-failed',String(error)));
 });
 // The only place an install handoff is committed: the real before-quit (see desktop/updater-handoff.ts).
 app.on('before-quit',()=>{if(updaterHandoff.commitHandoffOnBeforeQuit().committed)updater.completeHandoff();});
 app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
}
