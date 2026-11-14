import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {SplashService,splashEnvironment} from '../desktop/splash-service.js';
import {SPLASH_SHA256} from '../desktop/splash-runtime-identity.js';
import {splashCommand,runSplashCommand} from '../desktop/renderer/src/hidden-splash.js';
import {createDesktopAPI,dispatchDesktop,DESKTOP_METHODS} from '../desktop/semantic-api.js';

test('hidden command recognizes exact namespace, rejects arguments/attachments, never forwards normal chat',async()=>{
 let opens=0;const open=async()=>{opens++;};
 assert.equal(splashCommand('/splashx'),false);assert.equal(splashCommand('explain /splash'),false);
 assert.equal(await runSplashCommand('hello',0,open),false);
 await assert.rejects(runSplashCommand('/splash deploy',0,open),/用法/);
 await assert.rejects(runSplashCommand('/splash',1,open),/附件/);
 await runSplashCommand(' /splash open ',0,open);assert.equal(opens,1);
});
test('semantic splash uses native capability only and denies arbitrary process parameters',async()=>{
 let calls=0;const api=createDesktopAPI(async()=>{throw Error('broker_must_not_be_called');},{nativeActions:{openSplash:async()=>{calls++;return {ok:true};}}});
 assert.ok(DESKTOP_METHODS.includes('openSplash'));
 await dispatchDesktop(api,'openSplash',[{requestId:randomUUID()}]);assert.equal(calls,1);
 await assert.rejects(dispatchDesktop(api,'spawn',[]),/forbidden/);
 assert.deepEqual(splashEnvironment({CLOUDBASE_SERVER_KEY:'secret',NODE_OPTIONS:'--require evil',PATH:'evil',TMP:'/tmp'}),{TMP:'/tmp',ELECTRON_RUN_AS_NODE:'1'});
});
test('real bundled service starts once, persists across restart, hides token from renderer, closes owned child',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'kteam-splash-')),runtime=resolve('vendor/splash/splash-runtime.cjs'),urls:string[]=[];
 const options={runtime,sha256:SPLASH_SHA256,dataDir:dir,openExternal:async(url:string)=>{urls.push(url);}};
 const manager=new SplashService(options);t.after(async()=>{await manager.close();rmSync(dir,{recursive:true,force:true});});
 await assert.rejects(manager.open({requestId:randomUUID()},'agent'),/user_only/);
 await assert.rejects(manager.open({requestId:randomUUID(),runtime:'evil'},'user'),/invalid/);
 const [a,b]=await Promise.all([manager.open({requestId:randomUUID()},'user'),manager.open({requestId:randomUUID()},'user')]);
 assert.equal(a.url,b.url);assert.equal(a.url.includes('token'),false);assert.equal(urls[0],urls[1]);
 const url=new URL(urls[0]!);const token=new URLSearchParams(url.hash.slice(1)).get('token');
 const root=url.origin;assert.equal((await fetch(root+'/v1/spaces')).status,401);
 const auth={Authorization:'Bearer '+token,'Content-Type':'application/json','Idempotency-Key':'desktop-create-one'};
 const r=await fetch(root+'/v1/spaces',{method:'POST',headers:auth,body:JSON.stringify({title:'Desktop probe'})});assert.equal(r.status,201);const space:any=await r.json();
 await manager.close();await assert.rejects(fetch(root+'/health'));
 await assert.rejects(manager.open({requestId:randomUUID()},'user'),/closed/);
 const next=new SplashService(options);t.after(()=>next.close());await next.open({requestId:randomUUID()},'user');
 const second=new URL(urls.at(-1)!);assert.notEqual(second.hash,url.hash);
 const list:any=await (await fetch(second.origin+'/v1/spaces',{headers:{Authorization:'Bearer '+new URLSearchParams(second.hash.slice(1)).get('token')}})).json();assert.equal(list[0].id,space.id);
 await next.close();
});
test('tampered or stalled runtime fails closed without opening browser',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'kteam-splash-fault-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const runtime=join(dir,'stalled.cjs');writeFileSync(runtime,"process.on('message',()=>{});setInterval(()=>{},1000);");
 const options={runtime,sha256:createHash('sha256').update("process.on('message',()=>{});setInterval(()=>{},1000);").digest('hex'),dataDir:dir,timeoutMs:100,openExternal:async()=>{throw Error('must_not_open');}};
 const manager=new SplashService(options);t.after(()=>manager.close());await assert.rejects(manager.open({requestId:randomUUID()},'user'),/timeout/);await manager.close();
 const tampered=new SplashService({...options,sha256:'0'.repeat(64)});await assert.rejects(tampered.open({requestId:randomUUID()},'user'),/integrity/);
});
test('parent IPC disconnect terminates actual runtime and loopback listener',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'kteam-splash-disconnect-'));
 const child=spawn(process.execPath,[resolve('vendor/splash/splash-runtime.cjs'),'--managed-splash'],{stdio:['ignore','ignore','ignore','ipc'],env:splashEnvironment(process.env)});
 t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');rmSync(dir,{recursive:true,force:true});});
 const ready=once(child,'message');child.send({type:'init',nonce:'a'.repeat(64),dataDir:dir});
 const [message]=await ready as any;const url=new URL(message.url);assert.equal((await fetch(url.origin+'/health')).status,200);
 const exited=once(child,'exit');child.disconnect();await exited;await assert.rejects(fetch(url.origin+'/health'));
});
test('ready requires matching nonce and exact loopback URL; quitting during startup never opens browser',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'kteam-splash-ready-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 let opens=0;
 const runtime=join(dir,'forged.cjs');
 const source="process.on('message',m=>{process.send({type:'ready',nonce:'wrong',url:'https://evil.example'});process.send({type:'ready',nonce:m.nonce,url:'http://127.0.0.1@evil.example:8080/splash#token='+ 'a'.repeat(43)});});";
 writeFileSync(runtime,source);
 const options={runtime,sha256:createHash('sha256').update(source).digest('hex'),dataDir:dir,openExternal:async()=>{opens++;}};
 const manager=new SplashService(options);t.after(()=>manager.close());
 await assert.rejects(manager.open({requestId:randomUUID()},'user'),/invalid_ready/);await manager.close();assert.equal(opens,0);
 const next=new SplashService({...options,runtime:resolve('vendor/splash/splash-runtime.cjs'),sha256:SPLASH_SHA256});
 const opening=next.open({requestId:randomUUID()},'user');const rejected=assert.rejects(opening,/closed|exited/);
 await next.close();await rejected;assert.equal(opens,0);
});
