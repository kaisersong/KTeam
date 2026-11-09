import {app,BrowserWindow,ipcMain,Menu} from 'electron';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {existsSync,openSync,closeSync,readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {dataRoot,initConfig} from '../src/service/config.js';
import {hostRequest} from '../src/service/client.js';
import {createDesktopAPI,dispatchDesktop,trustedFrame} from './semantic-api.js';

app.setName('KTeam');
const locked=app.requestSingleInstanceLock();
if(!locked)app.quit();
let window:BrowserWindow|undefined;
const root=dataRoot();
const environment=()=>Object.fromEntries(Object.entries(process.env).filter(([name,value])=>value!==undefined&&(['PATH','HOME','USER','LOGNAME','SHELL','TMPDIR','TEMP','TMP','TZ','LANG','LANGUAGE','NODE_EXTRA_CA_CERTS','SSL_CERT_FILE','SSL_CERT_DIR','HTTP_PROXY','HTTPS_PROXY','NO_PROXY','http_proxy','https_proxy','no_proxy'].includes(name)||name.startsWith('LC_'))));
function resources(){return app.getAppPath().endsWith('.asar')?app.getAppPath()+'.unpacked':app.getAppPath();}
async function ensureHost(){
 if(!existsSync(join(root,'config.json'))){
  const source=join(homedir(),'.xiaok','desktop','activity-owner.config.json');
  initConfig(root,{version:1,brokerUrl:'http://127.0.0.1:4318',kswarmUrl:'http://127.0.0.1:4400',...(existsSync(source)?{xiaokActivityConfig:source}:{})});
 }
 try{await hostRequest(root,'kteam-main','/v1/handshake');return;}catch(error){
  const code=(error as NodeJS.ErrnoException).code;
  if(!['ENOENT','ECONNREFUSED','ECONNRESET'].includes(code??''))throw error;
 }
 const output=openSync(join(root,'host.log'),'a',0o600);
 let child;
 try{child=spawn(process.execPath,[join(resources(),'build','host.cjs')],{detached:true,stdio:['ignore',output,output],env:{...environment(),ELECTRON_RUN_AS_NODE:'1',KTEAM_DATA_DIR:root,KTEAM_RUNTIME_ENTRY:join(resources(),'build','shared','xiaok-runtime.mjs')}});}finally{closeSync(output);}
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
  const api=createDesktopAPI(async(route,value)=>{const result=await hostRequest(root,'kteam-main',route,value);return route==='/v1/status'?{...result,desktop:buildInfo}:result;});
  ipcMain.handle('kteam:semantic',async(event,method,args)=>{
   if(!window||!trustedFrame(event.senderFrame,window.webContents.mainFrame))return {ok:false,code:'desktop_sender_forbidden'};
   try{return await dispatchDesktop(api,method,args);}catch(error){return {ok:false,code:(error as {code?:string}).code??'desktop_request_failed'};}
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'KTeam',submenu:[{label:'关于 KTeam',role:'about'},{type:'separator'},{label:'隐藏 KTeam',role:'hide'},{type:'separator'},{label:'退出 KTeam（后台继续工作）',accelerator:'Command+Q',click:()=>app.quit()}]},{label:'编辑',submenu:[{role:'undo'},{role:'redo'},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},{label:'窗口',submenu:[{role:'minimize'},{role:'zoom'}]}]));
  await show();app.on('activate',()=>void show());
 });
 app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
}
