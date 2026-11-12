import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs,{mkdtempSync,mkdirSync,realpathSync,rmSync,writeFileSync,readFileSync,statSync,existsSync} from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {fileURLToPath} from 'node:url';
import {join,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {createElement,isValidElement,type ReactElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {initConfig,loadConfig,upstreamOptions} from '../src/service/config.js';
import {ensureSharedServices} from '../src/runtime/services.js';
import {initStandalone} from '../src/runtime/managed-services.js';
import {legacySharedNoticeView,dismissLegacySharedNotice,legacySharedNoticeState} from '../src/service/legacy-notice.js';
import {startHost} from '../src/service/server.js';
import {hostRequest} from '../src/service/client.js';
import {createDesktopAPI,dispatchDesktop,DESKTOP_METHODS} from '../desktop/semantic-api.js';
import {LegacySharedNotice,legacyNoticeActions,LEGACY_SHARED_NOTICE_TEXT,LEGACY_SHARED_NOTICE_ACTION} from '../desktop/renderer/src/legacy-notice.js';

const EXACT='0.2 中与小K共用的服务数据不会带到 0.3，请重新设置一次服务。';
const base={version:1 as const,brokerUrl:'http://127.0.0.1:41001',kswarmUrl:'http://127.0.0.1:41002'};
const temp=()=>realpathSync(mkdtempSync(join(tmpdir(),'kteam-notice-')));
const writeConfig=(root:string,value:object)=>writeFileSync(join(root,'config.json'),JSON.stringify(value),{mode:0o600});

test('notice is pending only when the legacy shared-service key was dropped, and survives restarts and config rewrites until dismissed',()=>{
 const root=temp();
 try{
  writeConfig(root,{...base,xiaokActivityConfig:join(root,'never-read.json')});
  assert.equal(legacySharedNoticeView(root).show,false);
  assert.deepEqual(loadConfig(root),base);
  assert.equal(legacySharedNoticeView(root).show,true);
  if(process.platform!=='win32')assert.equal(statSync(join(root,'notices.json')).mode&0o777,0o600);
  // A restart that finds a config already rewritten without the key still shows the pending notice.
  writeConfig(root,base);loadConfig(root);
  assert.equal(legacySharedNoticeView(root).show,true);
  assert.deepEqual(dismissLegacySharedNotice(root),{ok:true,show:false});
  assert.equal(legacySharedNoticeState(root),'dismissed');
  // Once dismissed it never comes back, even if the legacy key is seen again.
  writeConfig(root,{...base,xiaokActivityConfig:'x'});loadConfig(root);loadConfig(root);
  assert.equal(legacySharedNoticeView(root).show,false);
  assert.deepEqual(JSON.parse(readFileSync(join(root,'notices.json'),'utf8')),{legacySharedServices:'dismissed'});
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('notice is not shown for other unknown keys or a fresh install',async()=>{
 const other=temp(),fresh=temp(),standalone=temp();
 try{
  writeConfig(other,{...base,someRetiredKey:'x',anotherOne:1});assert.deepEqual(loadConfig(other),base);
  assert.equal(legacySharedNoticeView(other).show,false);assert.equal(existsSync(join(other,'notices.json')),false);
  initConfig(fresh,base);loadConfig(fresh);assert.equal(legacySharedNoticeView(fresh).show,false);
  const data=join(standalone,'kteam');await initStandalone(data);loadConfig(data);assert.equal(legacySharedNoticeView(data).show,false);
  assert.equal(dismissLegacySharedNotice(fresh).show,false);assert.equal(legacySharedNoticeState(fresh),undefined,'dismissing without a pending notice records nothing');
 }finally{for(const dir of [other,fresh,standalone])rmSync(dir,{recursive:true,force:true});}
});

test('desktop host exposes the notice to the main client only and persists dismissal',async()=>{
 const root=temp();initConfig(root,base);writeConfig(root,{...base,xiaokActivityConfig:'legacy'});loadConfig(root);
 const host=await startHost({root,upstream:{brokerUrl:base.brokerUrl,kswarmUrl:base.kswarmUrl}});
 try{
  assert.ok(DESKTOP_METHODS.includes('legacySharedNotice')&&DESKTOP_METHODS.includes('dismissLegacySharedNotice'));
  const api=createDesktopAPI((route,value)=>hostRequest(root,'kteam-main',route,value));
  assert.deepEqual(await dispatchDesktop(api,'legacySharedNotice',[]),{ok:true,show:true});
  await assert.rejects(hostRequest(root,'kteam-companion','/v1/app/notices/legacy-shared-services'),/app_settings_forbidden/);
  await assert.rejects(hostRequest(root,'kteam-main','/v1/app/notices/legacy-shared-services/dismiss',{extra:true}),/unknown_field/);
  assert.deepEqual(await dispatchDesktop(api,'dismissLegacySharedNotice',[]),{ok:true,show:false});
  assert.deepEqual(await api.legacySharedNotice(),{ok:true,show:false});
 }finally{await host.close();rmSync(root,{recursive:true,force:true});}
});

const buttons=(node:unknown):ReactElement<any>[]=>{if(Array.isArray(node))return node.flatMap(buttons);if(!isValidElement(node))return [];const el=node as ReactElement<any>;return [...(el.type==='button'?[el]:[]),...buttons(el.props.children)];};
test('banner text is exact, 去设置 opens the services settings page, and both actions dismiss for good',async()=>{
 assert.equal(LEGACY_SHARED_NOTICE_TEXT,EXACT);assert.equal(LEGACY_SHARED_NOTICE_ACTION,'去设置');
 const calls:string[]=[];
 const actions=legacyNoticeActions({dismiss:async()=>{calls.push('dismiss');},openServices:()=>calls.push('open:services'),hide:()=>calls.push('hide')});
 const element=LegacySharedNotice({onSettings:()=>void actions.goToSettings(),onDismiss:()=>void actions.dismiss()});
 const html=renderToStaticMarkup(createElement(LegacySharedNotice,{onSettings(){},onDismiss(){}}));
 assert.ok(html.includes('<span>'+EXACT+'</span>'),html);
 const [settings,close]=buttons(element);
 assert.equal(settings!.props.children,'去设置');assert.equal(close!.props['aria-label'],'关闭提示');
 settings!.props.onClick();await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(calls,['open:services','hide','dismiss']);
 calls.length=0;close!.props.onClick();await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(calls,['hide','dismiss']);
 // The services page exists in settings and the main view routes 去设置 to it.
 const settingsSource=readFileSync(new URL('../../desktop/renderer/src/settings.tsx',import.meta.url),'utf8'),main=readFileSync(new URL('../../desktop/renderer/src/main.tsx',import.meta.url),'utf8');
 assert.match(settingsSource,/\['services','服务',Server\]/);assert.match(settingsSource,/page==='services'&&<Services\/>/);
 assert.match(main,/openServices:\(\)=>\{setSettingsTab\('services'\);void open\('settings'\);\}/);
 assert.match(main,/api\.legacySharedNotice\(\)\.then\(view=>setLegacyNotice\(view\?\.show===true\)\)/);
});

/** Records every path-like argument passed to any node:fs function (ESM named imports included). */
function watchFs(){
 const seen:string[]=[],originals=new Map<string,Function>();
 const record=(args:unknown[])=>{for(const arg of args){const value=arg instanceof URL?fileURLToPath(arg):Buffer.isBuffer(arg)?arg.toString():arg;if(typeof value==='string'&&(value.includes('/')||value.includes('\\')))seen.push(value);}};
 for(const [name,value] of Object.entries(fs))if(typeof value==='function'&&!/^[A-Z]/.test(name)){originals.set(name,value);(fs as any)[name]=function(this:unknown,...args:unknown[]){record(args);return (value as Function).apply(this,args);};}
 const promises=fs.promises as any,promiseOriginals=new Map<string,Function>();
 for(const [name,value] of Object.entries(promises))if(typeof value==='function'){promiseOriginals.set(name,value);promises[name]=function(this:unknown,...args:unknown[]){record(args);return (value as Function).apply(this,args);};}
 syncBuiltinESMExports();
 return {seen,restore(){for(const [name,value] of originals)(fs as any)[name]=value;for(const [name,value] of promiseOriginals)promises[name]=value;syncBuiltinESMExports();}};
}
test('the dropped legacy key\'s value is never accessed, and the notice path touches only config.json and notices.json under KTeam\'s data dir',async()=>{
 const root=temp(),home=temp(),previousHome=process.env.HOME;
 // A tempting target: a xiaok-style home with shared-service settings, and a value pointing straight at it.
 const xiaok=join(home,'.xiaok'),target=join(xiaok,'shared-activity.json');mkdirSync(xiaok,{mode:0o700});writeFileSync(target,JSON.stringify({kswarm:{roomToken:'XIAOK_TOKEN'}}),{mode:0o600});
 writeConfig(root,{...base,xiaokActivityConfig:target});
 process.env.HOME=home;
 const probe=watchFs();
 try{
  const config=loadConfig(root);upstreamOptions(config);await ensureSharedServices(config,root);
  assert.equal(legacySharedNoticeView(root).show,true);loadConfig(root);dismissLegacySharedNotice(root);
 }finally{probe.restore();if(previousHome===undefined)delete process.env.HOME;else process.env.HOME=previousHome;}
 try{
  // Positive control: the probe did observe the reads it should.
  assert.ok(probe.seen.includes(join(root,'config.json')),'config.json read observed');
  assert.ok(probe.seen.some(path=>path.startsWith(join(root,'notices.json'))),'notices.json write observed');
  assert.deepEqual(probe.seen.filter(path=>path.includes(target)||path.includes(xiaok)||/[/\\]\.xiaok\b/.test(path)),[],'legacy value or any .xiaok path accessed');
  assert.deepEqual(probe.seen.filter(path=>path!==root&&!path.startsWith(root+sep)),[],'notice logic only touches KTeam\'s data dir');
  assert.deepEqual([...new Set(probe.seen.map(path=>path.slice(root.length+1).replace(/\.\d+\.tmp$/,'.tmp')))].sort(),['config.json','notices.json','notices.json.tmp']);
 }finally{rmSync(root,{recursive:true,force:true});rmSync(home,{recursive:true,force:true});}
});

test('notice code path names no xiaok location and resolves state only under the given KTeam data dir',()=>{
 const sources=['src/service/legacy-notice.ts','src/service/config.ts','desktop/renderer/src/legacy-notice.ts'].map(file=>[file,readFileSync(new URL('../../'+file,import.meta.url),'utf8')] as const);
 for(const [file,text] of sources){assert.doesNotMatch(text,/~\/\.xiaok|['"\x60/\\]\.xiaok\b|\.xiaok['"\x60]/,file);assert.doesNotMatch(text,/XIAOK_[A-Z]/,file);}
 const notice=sources[0]![1];
 assert.doesNotMatch(notice,/homedir|process\.env/,'notice state is never located from HOME or env');
 assert.match(notice,/const file=\(root:string\)=>join\(root,FILE\);/);
 const config=sources[1]![1];
 assert.match(config,/return validateConfig\(dropLegacyKeys\(parseJson\(privateRead\(join\(root, 'config\.json'\)\)\), root\)\);/,'only config.json under the KTeam data dir is read');
 assert.match(config,/export function dataRoot\(\): string \{ return resolve\(process\.env\.KTEAM_DATA_DIR \|\| join\(homedir\(\), '\.kteam'\)\); \}/);
});
