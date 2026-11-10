import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,realpathSync,rmSync,writeFileSync,readFileSync,statSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createElement,isValidElement,type ReactElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {initConfig,loadConfig} from '../src/service/config.js';
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
