import {execFileSync} from 'node:child_process';
import {existsSync,writeFileSync,renameSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {ensurePrivateRoot,privateRead,loadConfig,upstreamOptions,socketPath} from '../src/service/config.js';
import {acquireOwner} from '../src/service/owner.js';
import {ownServicesReady} from '../src/runtime/managed-services.js';
import {KTeamError} from '../src/errors.js';

type Identity={pid:number;ppid:number;uid:number;birth:string;command:string;role:'host'|'service-owner'|'service-child'};
type Handshake={instanceId:string;ownerEpoch:number};
type Receipt={version:1;executable:string;instanceId?:string;members:Identity[];intents:number[]};
type Options={root:string;executable:string;buildDirectory:string;revision:string;request:(route:string,value?:unknown)=>Promise<any>};
const failure=()=>new KTeamError('desktop_generation_unconfirmed',503);
const disconnected=(e:any)=>['ENOENT','ECONNREFUSED','ECONNRESET','EPIPE'].includes(e?.code);
function processes(){
 const text=execFileSync('/bin/ps',['-axo','pid=,ppid=,uid=,stat=,lstart=,command='],{encoding:'utf8',timeout:3000});
 return text.split('\n').flatMap(line=>{const m=/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+\s+\S+\s+\d+\s+\S+\s+\d+)\s+(.*)$/.exec(line);return m&&!m[4]!.startsWith('Z')?[{pid:Number(m[1]),ppid:Number(m[2]),uid:Number(m[3]),birth:m[5]!.replace(/\s+/g,' '),command:m[6]!}]:[];});
}
function listener(args:string[]){
 let text:string;try{text=execFileSync('/usr/sbin/lsof',['-nP','-F','p','-a',...args],{encoding:'utf8',timeout:3000,stdio:['ignore','pipe','pipe']});}catch(e){if((e as any).status===1)return undefined;throw failure();}
 const pids=[...new Set(text.split('\n').filter(v=>/^p\d+$/.test(v)).map(v=>Number(v.slice(1))))];if(pids.length>1)throw failure();return pids[0];
}
function atomic(file:string,value:unknown){const tmp=file+'.'+randomUUID();try{writeFileSync(tmp,JSON.stringify(value),{flag:'wx',mode:0o600});renameSync(tmp,file);}finally{if(existsSync(tmp))unlinkSync(tmp);}}
/** macOS keeps work alive on ordinary quit. A changed desktop build must first retire its authenticated
 * old host and the managed services bound to this root, without adopting a foreign/reused process. */
export async function desktopGeneration(options:Options){
 ensurePrivateRoot(options.root);const directory=join(options.root,'desktop-generation');ensurePrivateRoot(directory);
 let lock:ReturnType<typeof acquireOwner>;try{lock=acquireOwner(directory);}catch{throw new KTeamError('desktop_generation_busy',503);}
 const stampFile=join(directory,'build.json'),receiptFile=join(directory,'handoff.json');
 const command=(role:Identity['role'])=>options.executable+' '+join(options.buildDirectory,role==='host'?'host.cjs':role+'.cjs');
 const read=(file:string)=>existsSync(file)?JSON.parse(privateRead(file)):undefined;
 const inspect=(identity:Identity)=>{const current=processes().find(p=>p.pid===identity.pid);if(!current||current.birth!==identity.birth)return false;if(current.uid!==process.getuid?.()||current.command!==identity.command||identity.command!==command(identity.role))throw failure();return true;};
 const waitGone=async(identity:Identity)=>{const until=performance.now()+15000;while(processes().some(p=>p.pid===identity.pid&&p.birth===identity.birth)){if(performance.now()>=until)throw failure();await new Promise(r=>setTimeout(r,100));}};
 const handshake=async():Promise<Handshake|undefined>=>{try{const h=await options.request('/v1/handshake');if(h?.product!=='KTeam'||typeof h.instanceId!=='string'||!Number.isSafeInteger(h.ownerEpoch))throw failure();return h;}catch(e){if(disconnected(e))return undefined;throw e;}};
 let previous:Handshake|undefined;
 try{
  previous=await handshake();const stamp=read(stampFile);let receipt=read(receiptFile) as Receipt|undefined;
  if(!receipt&&previous&&stamp?.version===1&&stamp.revision===options.revision&&stamp.executable===options.executable&&stamp.instanceId===previous.instanceId&&stamp.ownerEpoch===previous.ownerEpoch){
   return {reuse:true,commit:async()=>{},close:()=>lock.release()};
  }
  if(!receipt){
   const members:Identity[]=[],table=processes();const adopt=(pid:number|undefined,role:Identity['role'])=>{if(pid===undefined)throw failure();const p=table.find(v=>v.pid===pid);if(!p||p.uid!==process.getuid?.()||p.command!==command(role))throw failure();const result={...p,role};if(!members.some(v=>v.pid===pid))members.push(result);return result;};
   if(previous)adopt(listener(['-U',socketPath(options.root)]),'host');
   // A same-build host crash can retain its already versioned managed services. A changed/missing
   // stamp retires listeners only after both root credentials and exact executable lineage agree.
   const config=loadConfig(options.root);
   if(config.managedServiceConfig&&!(stamp?.revision===options.revision&&stamp.executable===options.executable)){
    const listeners=[config.brokerUrl,config.kswarmUrl].map(url=>listener(['-iTCP:'+new URL(url).port,'-sTCP:LISTEN']));
    if(listeners.some(pid=>pid!==undefined)){
     if(!await ownServicesReady(upstreamOptions(config)))throw failure();
     const children=listeners.filter((pid):pid is number=>pid!==undefined).map(pid=>adopt(pid,'service-child'));
     const owners=[...new Set(children.map(p=>p.ppid))];if(owners.length!==1)throw failure();const owner=adopt(owners[0],'service-owner');if(children.some(child=>!Number.isFinite(Date.parse(child.birth))||!Number.isFinite(Date.parse(owner.birth))||Date.parse(child.birth)<Date.parse(owner.birth)))throw failure();
    }
   }
   const again=await handshake();if(again?.instanceId!==previous?.instanceId||again?.ownerEpoch!==previous?.ownerEpoch)throw failure();
   receipt={version:1,executable:options.executable,instanceId:previous?.instanceId,members,intents:[]};atomic(receiptFile,receipt);
  }
  if(receipt.version!==1||receipt.executable!==options.executable||!Array.isArray(receipt.members)||!Array.isArray(receipt.intents)||receipt.members.some(p=>!Number.isSafeInteger(p.pid)||p.pid<=0||!['host','service-owner','service-child'].includes(p.role)||p.uid!==process.getuid?.()||typeof p.birth!=='string'||p.command!==command(p.role)))throw failure();
  const current=await handshake();if(current&&current.instanceId!==receipt.instanceId)throw failure();
  // An intent without a receipt is reconciled by process identity only, never by repeating a stop.
  for(const role of ['host','service-owner'] as const)for(const member of receipt.members.filter(p=>p.role===role)){
   if(!inspect(member))continue;
   if(!receipt.intents.includes(member.pid)){
    receipt.intents.push(member.pid);atomic(receiptFile,receipt);
    try{if(role==='host')await options.request('/v1/host/stop',{});else process.kill(member.pid,'SIGTERM');}
    catch(e){if(inspect(member)&&!disconnected(e)&&(e as any).code!=='ESRCH')throw e;}
   }
   await waitGone(member);
  }
  // The owner already signals its tracked children. Reconcile them read-only; never send a second stop.
  for(const child of receipt.members.filter(p=>p.role==='service-child'))await waitGone(child);
  if(await handshake())throw failure();
  const finalConfig=loadConfig(options.root);if(finalConfig.managedServiceConfig&&receipt.members.some(p=>p.role!=='host'))for(const url of [finalConfig.brokerUrl,finalConfig.kswarmUrl])if(listener(['-iTCP:'+new URL(url).port,'-sTCP:LISTEN'])!==undefined)throw failure();
  if(existsSync(receiptFile))unlinkSync(receiptFile);
  return {reuse:false,commit:async(pid:number)=>{const h=await handshake();if(!h||listener(['-U',socketPath(options.root)])!==pid)throw failure();const p=processes().find(v=>v.pid===pid);if(!p||p.uid!==process.getuid?.()||p.command!==command('host'))throw failure();atomic(stampFile,{version:1,revision:options.revision,executable:options.executable,instanceId:h.instanceId,ownerEpoch:h.ownerEpoch});},close:()=>lock.release()};
 }catch(e){lock.release();throw e;}
}
