import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import type {SplashOpenInput} from '../desktop/splash-input.js';
import {SplashService,splashEnvironment} from '../desktop/splash-service.js';
import {SPLASH_SHA256} from '../desktop/splash-runtime-identity.js';
import {spaceCommand,spaceCommandCandidate,runSpaceCommand} from '../desktop/renderer/src/space-command.js';
import {createDesktopAPI,dispatchDesktop,DESKTOP_METHODS} from '../desktop/semantic-api.js';

test('local space command recognizes exact namespace, rejects arguments/attachments, never forwards normal chat',async()=>{
 const requests:SplashOpenInput[]=[];const open=async(input:SplashOpenInput)=>{requests.push(input);return {ok:true as const,opened:true as const,mode:'local' as const,url:'http://127.0.0.1:11234/space'};};
 assert.equal(spaceCommand('/spacex'),false);assert.equal(spaceCommand('explain /space'),false);
 assert.equal(await runSpaceCommand('hello',0,open),false);
 await assert.rejects(runSpaceCommand('/space deploy',0,open),/用法/);
 await assert.rejects(runSpaceCommand('/space',1,open),/附件/);
 await assert.rejects(runSpaceCommand('/space 建议一个名字',0,open),/用法/);
 await assert.rejects(runSpaceCommand('/space 创建一个空间',0,open),/splash_title_invalid/);
 await assert.rejects(runSpaceCommand('/space create 发布计划',1,open),/附件/);
 await runSpaceCommand(' /space open ',0,open);
 await runSpaceCommand('/space 建一个kteam产品特性和更新计划的空间',0,open);
 await runSpaceCommand('/space create 发布计划',0,open);
 assert.deepEqual(requests.map(item=>item.title),[undefined,'kteam产品特性和更新计划','发布计划']);
});
test('the composer offers the local space command only for its own prefix',()=>{
 for(const candidate of ['/','/s','/sp','/space','/space '])assert.equal(spaceCommandCandidate(candidate),true,candidate);
 for(const other of ['', '/spacex','/skill space','/space open','hello /space'])assert.equal(spaceCommandCandidate(other),false,other);
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
test('named creation reconciles a lost response, selects the space in the browser and reuses the draft after restart',async t=>{
 const dir=mkdtempSync(join(tmpdir(),'kteam-splash-create-')),urls:string[]=[];
 const methods:string[]=[];
 let discard=true;
 const options={runtime:resolve('vendor/splash/splash-runtime.cjs'),sha256:SPLASH_SHA256,dataDir:dir,openExternal:async(url:string)=>{urls.push(url);}};
 const manager=new SplashService({...options,fetch:async(input,init)=>{
  methods.push(init?.method??'GET');
  const response=await fetch(input,init);
  if(init?.method==='POST'&&discard){discard=false;await response.json();throw Error('synthetic_lost_response');}
  return response;
 }});
 const next=new SplashService(options);
 t.after(async()=>{await manager.close();await next.close();rmSync(dir,{recursive:true,force:true});});
 const title='kteam产品特性和更新计划';
 const result=await runSpaceCommand('/space 建一个'+title+'的空间',0,input=>manager.open(input,'user'));
 assert.ok(result&&result.space);
 assert.equal(result.space.title,title);
 assert.deepEqual(methods,['POST','GET']);
 assert.equal(new URLSearchParams(new URL(urls[0]!).hash.slice(1)).get('space'),result.space.id);
 assert.equal(new URL(result.url).hash,'');
 await manager.close();
 const duplicate=await next.open({requestId:randomUUID(),title},'user');
 assert.equal(duplicate.space?.id,result.space.id);
 const url=new URL(urls[1]!);
 const token=new URLSearchParams(url.hash.slice(1)).get('token');
 const response=await fetch(new URL('/v1/spaces',url),{headers:{Authorization:'Bearer '+token}});
 const spaces=await response.json();
 assert.deepEqual(spaces.map((space:any)=>[space.title,space.status]),[[title,'draft']]);
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
 const source="process.on('message',m=>{process.send({type:'ready',nonce:'wrong',url:'https://evil.example'});process.send({type:'ready',nonce:m.nonce,url:'http://127.0.0.1@evil.example:8080/space#token='+ 'a'.repeat(43)});});";
 writeFileSync(runtime,source);
 const options={runtime,sha256:createHash('sha256').update(source).digest('hex'),dataDir:dir,openExternal:async()=>{opens++;}};
 const manager=new SplashService(options);t.after(()=>manager.close());
 await assert.rejects(manager.open({requestId:randomUUID()},'user'),/invalid_ready/);await manager.close();assert.equal(opens,0);
 const next=new SplashService({...options,runtime:resolve('vendor/splash/splash-runtime.cjs'),sha256:SPLASH_SHA256});
 const opening=next.open({requestId:randomUUID()},'user');const rejected=assert.rejects(opening,/closed|exited/);
 await next.close();await rejected;assert.equal(opens,0);
});
