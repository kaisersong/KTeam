import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs,{mkdtempSync,mkdirSync,realpathSync,rmSync,writeFileSync,readFileSync,readdirSync,statSync,existsSync} from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {initConfig,loadConfig,upstreamOptions} from '../src/service/config.js';
import {ensureSharedServices} from '../src/runtime/services.js';
import {sharedRuntime} from '../src/runtime/native.js';
import {startHost} from '../src/service/server.js';
import {hostRequest} from '../src/service/client.js';
import {ModelSettings} from '../src/service/model-settings.js';
import {systemXiaokKeychain,type XiaokKeychain} from '../src/service/installed-app-import.js';
import {createDesktopAPI,dispatchDesktop,DESKTOP_METHODS} from '../desktop/semantic-api.js';

// 「从小K导入」 is user-initiated and read-only. These tests pin when it may touch xiaok (only on that click),
// what it may do there (read), and that a denied keychain prompt leaves KTeam unchanged and is never retried by itself.
const base={version:1 as const,brokerUrl:'http://127.0.0.1:41001',kswarmUrl:'http://127.0.0.1:41002'};
const DENIED='未获得读取小K凭据的授权，可以在小K里复制 API Key 后手动填写，或者再点一次导入重试。';
const XIAOK_SERVICE='com.xiaok.'+'credentials.v1';
const temp=(prefix:string)=>realpathSync(mkdtempSync(join(tmpdir(),prefix)));
const READ_ONLY=new Set(['existsSync','lstatSync','statSync','realpathSync','readFileSync','accessSync','exists','lstat','stat','realpath','readFile','access']);

/** Records every node:fs (and fs.promises) call with its path-like arguments, ESM named imports included. */
function watchFs(){
 const calls:{fn:string;path:string;flag?:string}[]=[],originals=new Map<string,Function>(),promiseOriginals=new Map<string,Function>();
 const recordCall=(fn:string,args:unknown[])=>{const flag=args.find((a:any)=>typeof a==='object'&&a&&typeof a.flag==='string') as any;for(const arg of args){const value=arg instanceof URL?fileURLToPath(arg):Buffer.isBuffer(arg)?arg.toString():arg;if(typeof value==='string'&&(value.includes('/')||value.includes('\\')))calls.push({fn,path:value,...(flag?{flag:flag.flag}:{})});}};
 const wrap=(name:string,value:Function)=>Object.assign(function(this:unknown,...args:unknown[]){recordCall(name,args);return value.apply(this,args);},value);
 for(const [name,value] of Object.entries(fs))if(typeof value==='function'&&!/^[A-Z]/.test(name)){originals.set(name,value);(fs as any)[name]=wrap(name,value);}
 const promises=fs.promises as any;
 for(const [name,value] of Object.entries(promises))if(typeof value==='function'){promiseOriginals.set(name,value as Function);promises[name]=wrap('promises.'+name,value as Function);}
 syncBuiltinESMExports();
 return {calls,paths:()=>calls.map(c=>c.path),restore(){for(const [name,value] of originals)(fs as any)[name]=value;for(const [name,value] of promiseOriginals)promises[name]=value;syncBuiltinESMExports();}};
}
const xiaokPaths=<T extends {path:string}>(calls:T[])=>calls.filter(c=>/[/\\]\.xiaok(?:[/\\]|$)/.test(c.path));

/** Snapshot of every file under a tree: content, mode and mtime, so any write, chmod, rename or create shows up. */
function snapshot(dir:string):Record<string,string>{const out:Record<string,string>={};const walk=(d:string)=>{for(const name of readdirSync(d)){const p=join(d,name),s=statSync(p);if(s.isDirectory()){out[p+'/']=String(s.mode)+':'+s.mtimeMs;walk(p);}else out[p]=String(s.mode)+':'+s.mtimeMs+':'+createHash('sha256').update(readFileSync(p)).digest('hex');}};walk(dir);return out;}

interface Fixture{root:string;home:string;xiaok:string;secrets:string[];restore():void}
/** KTeam data dir + a fake HOME holding a xiaok install with one model whose key lives in xiaok's file vault or keychain. */
async function fixture(options:{backend:'file'|'keychain';keychain?:Map<string,string>;withSystemOne?:boolean}):Promise<Fixture>{
 const root=temp('kteam-xiaok-import-'),home=temp('kteam-xiaok-home-'),xiaok=join(home,'.xiaok'),before={HOME:process.env.HOME,USERPROFILE:process.env.USERPROFILE,KTEAM_MODEL_CONFIG_DIR:process.env.KTEAM_MODEL_CONFIG_DIR};
 // os.homedir() reads HOME on POSIX and USERPROFILE on Windows.
 process.env.HOME=home;process.env.USERPROFILE=home;process.env.KTEAM_MODEL_CONFIG_DIR=join(root,'runtime');
 mkdirSync(xiaok,{mode:0o700});const file=join(xiaok,'config.json'),owner=createHash('sha256').update(file).digest('hex');
 const items=[{path:['providers','old','apiKey'],secret:'SYNTHETIC_XIAOK_PROVIDER_KEY'},...(options.withSystemOne?[{path:['systemOne','apiKey'],secret:'SYNTHETIC_XIAOK_SYSTEM_ONE_KEY'}]:[])].map(item=>({...item,id:randomUUID()}));
 const core=await sharedRuntime();
 if(options.backend==='file'){const vault=new core.CredentialStore(xiaok,{get(){throw Error('fixture must not use a keychain');},put(){throw Error('fixture must not use a keychain');}});for(const item of items)vault.put(item.id,JSON.stringify({owner,path:item.path,value:item.secret}));}
 else{mkdirSync(join(xiaok,'credentials'),{mode:0o700});writeFileSync(join(xiaok,'credentials','store.json'),JSON.stringify({version:1,backend:'keychain',entries:{}}),{mode:0o600});for(const item of items)options.keychain!.set(item.id,JSON.stringify({owner,path:item.path,value:item.secret}));}
 const raw={schemaVersion:2,defaultProvider:'old',defaultModelId:'old-model',providers:{old:{type:'custom',protocol:'openai_legacy',baseUrl:'http://127.0.0.1:12345/v1'}},models:{'old-model':{provider:'old',model:'fixture',label:'小K模型'}},...(options.withSystemOne?{systemOne:{model:'decider',baseUrl:'http://127.0.0.1:12346/v1'}}:{}),$xiaokCredentials:{version:1,entries:items.map(item=>({path:item.path,ref:'xiaok-secret:v1:'+item.id}))}};
 writeFileSync(file,JSON.stringify(raw),{mode:0o600});
 return {root,home,xiaok,secrets:items.map(i=>i.secret),restore(){for(const [k,v] of Object.entries(before))if(v===undefined)delete process.env[k];else process.env[k]=v;rmSync(root,{recursive:true,force:true});rmSync(home,{recursive:true,force:true});}};
}
/** Swap the OS keychain for a recorder; anything that asks it is visible to the test. */
function recordKeychain(answer:(service:string,id:string)=>string|null){const asks:{service:string;id:string}[]=[],original=systemXiaokKeychain.get;systemXiaokKeychain.get=(service,id)=>{asks.push({service,id});return answer(service,id);};return {asks,restore(){systemXiaokKeychain.get=original;}};}

/** Everything a normal app start does before the user clicks anything: config, connection options, services, host, UI routes. */
async function startApp(root:string){
 if(!existsSync(join(root,'config.json')))initConfig(root,base);
 const config=loadConfig(root),options=upstreamOptions(config);await ensureSharedServices(config,root);
 const host=await startHost({root,upstream:{brokerUrl:options.brokerUrl,kswarmUrl:options.kswarmUrl}});
 const api=createDesktopAPI((route,value)=>hostRequest(root,'kteam-main',route,value));
 const view=await dispatchDesktop(api,'modelSettings',[]) as any;
 // Settings pages the UI opens on start.
 await dispatchDesktop(api,'appPreferences',[]);await dispatchDesktop(api,'integrationSettings',[]);await dispatchDesktop(api,'decisionModels',[]);
 return {host,api,view};
}

test('without clicking 从小K导入, a full app start touches no .xiaok path and never asks the keychain',async()=>{
 const f=await fixture({backend:'file'}),keychain=recordKeychain(()=>{throw Error('keychain must not be asked');});
 const probe=watchFs();let app:Awaited<ReturnType<typeof startApp>>|undefined;
 try{
  app=await startApp(f.root);
  assert.equal(app.view.ok,true);assert.equal(Object.hasOwn(app.view,'importAvailable'),false,'no availability probe');
  await new ModelSettings().view();
  await app.host.close();app=undefined;
 }finally{probe.restore();keychain.restore();if(app)await app.host.close();}
 try{
  // Positive control: the recorder saw KTeam's own reads, including the model config the settings page loads.
  assert.ok(probe.paths().includes(join(f.root,'config.json')),'KTeam config.json read observed');
  assert.ok(probe.paths().some(p=>p.startsWith(join(f.root,'runtime'))),'KTeam model config access observed');
  assert.ok(probe.calls.length>20,'recorder is live');
  assert.deepEqual(xiaokPaths(probe.calls),[],'a .xiaok path was touched without a click');
  assert.ok(!probe.paths().some(p=>p.startsWith(f.home+'/.xiaok')||p===f.xiaok));
  assert.deepEqual(keychain.asks,[],'keychain asked without a click');
 }finally{f.restore();}
});

test('clicking 从小K导入 reads xiaok once, copies models and key into KTeam, writes nothing under .xiaok, and the next start never touches it',async()=>{
 const f=await fixture({backend:'file'}),keychain=recordKeychain(()=>{throw Error('file-backed import must not ask the keychain');});
 let app:Awaited<ReturnType<typeof startApp>>|undefined;
 try{
  app=await startApp(f.root);assert.ok(DESKTOP_METHODS.includes('importXiaokModels'));
  const tree=snapshot(f.xiaok),revision=app.view.revision;
  const probe=watchFs();let imported:any;
  try{imported=await dispatchDesktop(app.api,'importXiaokModels',[{expectedRevision:revision}]);}finally{probe.restore();}
  const touched=xiaokPaths(probe.calls);
  // Read once: one read of xiaok's config.json and one of its vault, nothing but read-type calls on that tree.
  assert.equal(touched.filter(c=>c.fn==='readFileSync'&&c.path===join(f.xiaok,'config.json')).length,1,'config.json read exactly once');
  assert.equal(touched.filter(c=>c.fn==='readFileSync'&&c.path===join(f.xiaok,'credentials','store.json')).length,1,'vault read exactly once');
  assert.deepEqual(touched.filter(c=>!READ_ONLY.has(c.fn)||(c.flag&&c.flag!=='r')),[],'non-read fs call on the xiaok tree');
  assert.ok(probe.calls.some(c=>!READ_ONLY.has(c.fn)&&c.path.startsWith(join(f.root,'runtime'))),'positive control: KTeam\'s own store was written');
  assert.deepEqual(snapshot(f.xiaok),tree,'xiaok files unchanged (content, mode, mtime, no new files)');
  // Copied into KTeam's own config and credential store; the secret never crosses IPC.
  assert.equal(imported.defaultModelId,'old-model');assert.equal(imported.models[0].label,'小K模型');assert.equal(imported.models[0].hasKey,true);
  assert.doesNotMatch(JSON.stringify(imported),new RegExp(f.secrets[0]!));
  const core=await sharedRuntime(),config=await core.loadConfig();assert.equal(config.providers[config.models['old-model'].provider].apiKey,f.secrets[0]);
  assert.ok(readFileSync(join(f.root,'runtime','credentials','store.json'),'utf8').includes(f.secrets[0]!),'key now lives in KTeam\'s vault');
  assert.ok(!readFileSync(join(f.root,'runtime','config.json'),'utf8').includes(f.secrets[0]!));
  assert.deepEqual(keychain.asks,[]);
  await app.host.close();app=undefined;
  // Second start after the import: KTeam runs from its own copy and never looks at xiaok again.
  const again=watchFs();
  try{app=await startApp(f.root);assert.equal(app.view.models[0].hasKey,true);await app.host.close();app=undefined;}finally{again.restore();}
  assert.ok(again.paths().includes(join(f.root,'config.json')),'positive control');
  assert.deepEqual(xiaokPaths(again.calls),[],'a .xiaok path was touched after the import');
 }finally{keychain.restore();if(app)await app.host.close();f.restore();}
});

test('xiaok keychain is asked only by the import, once per click, and a denial stops the import with no partial data and no retry',async()=>{
 const secrets=new Map<string,string>(),f=await fixture({backend:'keychain',keychain:secrets,withSystemOne:true});
 let mode:'allow'|'deny'|'deny-second'='deny',calls=0;const asks:{service:string;id:string}[]=[];
 const keychain:XiaokKeychain={get(service,id){asks.push({service,id});calls++;if(mode==='deny'||(mode==='deny-second'&&calls===2))throw Error('User interaction is not allowed.');return secrets.get(id)??null;}};
 try{
  const settings=new ModelSettings(keychain);let state=await settings.view();
  state=await settings.save({expectedRevision:state.revision,label:'自有模型',model:'own',protocol:'openai_legacy',baseUrl:'http://127.0.0.1:12347/v1',apiKey:'SYNTHETIC_OWN_KEY',makeDefault:true});
  state=await settings.decision({expectedRevision:state.revision,systemOne:{enabled:false},kim:{enabled:false,baseUrl:'http://127.0.0.1:8765'}});
  state=await settings.view();
  assert.equal(asks.length,0,'no keychain ask outside the import');
  const tree=snapshot(f.xiaok),kteam=snapshot(join(f.root,'runtime')),revision=state.revision;
  const unchanged=async()=>{assert.deepEqual(snapshot(join(f.root,'runtime')),kteam,'KTeam config or credentials changed after a failed import');const view=await settings.view();assert.equal(view.revision,revision);assert.deepEqual(view.models.map((m:any)=>m.label),['自有模型']);assert.equal(view.systemOne.model,'');for(const secret of f.secrets)assert.ok(!readFileSync(join(f.root,'runtime','credentials','store.json'),'utf8').includes(secret));};
  // Denied on the first prompt: stop at once with the product message's code, nothing written, no second prompt.
  await assert.rejects(settings.importXiaok({expectedRevision:revision}),(e:any)=>e.code==='xiaok_keychain_denied'&&e.message==='xiaok_keychain_denied');
  assert.equal(asks.length,1,'one prompt, no retry');
  await new Promise(resolve=>setTimeout(resolve,50));assert.equal(asks.length,1,'never re-prompts on its own');
  await unchanged();
  // Denied on the second of two keys: still atomic, the first key is not kept.
  mode='deny-second';calls=0;
  await assert.rejects(settings.importXiaok({expectedRevision:revision}),/xiaok_keychain_denied/);
  assert.equal(asks.length,3,'a new click asks again; stops at the denied key');
  await unchanged();
  // KTeam keeps working normally after a denial.
  const edited=await settings.save({expectedRevision:revision,id:state.models[0]!.id,label:'自有模型',model:'own',protocol:'openai_legacy',baseUrl:'http://127.0.0.1:12347/v1',makeDefault:true});
  assert.equal(edited.models.length,1);
  // Only a new click re-requests; allowed now, both keys come across in one save.
  mode='allow';
  const imported=await settings.importXiaok({expectedRevision:edited.revision});
  assert.equal(asks.length,5);assert.deepEqual([...new Set(asks.map(a=>a.service))],[XIAOK_SERVICE],'only xiaok\'s service is asked, by the import');
  assert.deepEqual(imported.models.map((m:any)=>m.label).sort(),['小K模型','自有模型'].sort());assert.equal(imported.systemOne.model,'decider');assert.equal(imported.systemOne.hasKey,true);
  const core=await sharedRuntime(),config=await core.loadConfig();assert.equal(config.providers[config.models['old-model'].provider].apiKey,f.secrets[0]);assert.equal(config.systemOne.apiKey,f.secrets[1]);
  assert.deepEqual(snapshot(f.xiaok),tree,'xiaok files unchanged');
  assert.equal(asks.length,5,'nothing after the import asks the keychain');
  // The UI shows the product's exact wording for this code.
  assert.ok(readFileSync(new URL('../../desktop/renderer/src/api.ts',import.meta.url),'utf8').includes(`xiaok_keychain_denied:'${DENIED}'`));
 }finally{f.restore();}
});

test('import without an installed xiaok fails cleanly and leaves KTeam unchanged',async()=>{
 const f=await fixture({backend:'file'});
 try{
  rmSync(f.xiaok,{recursive:true,force:true});
  const settings=new ModelSettings({get(){throw Error('must not ask');}}),view=await settings.view();
  await assert.rejects(settings.importXiaok({expectedRevision:view.revision}),/xiaok_import_source_missing/);
  assert.equal(existsSync(f.xiaok),false,'import never creates xiaok\'s directory');
  assert.equal((await settings.view()).revision,view.revision);
  await assert.rejects(settings.importXiaok({expectedRevision:view.revision,extra:true}),/unknown_field/);
 }finally{f.restore();}
});
