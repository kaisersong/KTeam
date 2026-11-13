import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createNotificationActivationRouter,KTEAM_APP_ID,nativeNotificationOptions,notificationActivationId} from '../desktop/notification-activation.js';
import {NotificationDelivery} from '../desktop/notification-delivery.js';
const hash='a'.repeat(64),id='desktop-notification:'+hash;
const click={type:'click',arguments:'type=click&tag='+hash};

test('Windows native tags fit the platform and cold activation round-trips only an opaque source ID',()=>{
 const options={id,groupId:'kteam-work',title:'<合成 & "标题">',body:"私有 '正文'\u0000",silent:true};
 const native=nativeNotificationOptions('win32',options);
 assert.equal(native.id,hash);assert.equal(native.id.length,64);assert.equal(native.groupId,options.groupId);
 assert.match(native.toastXml!,/launch="type=click&amp;tag=a{64}"/);
 assert.match(native.toastXml!,/&lt;合成 &amp; &quot;标题&quot;&gt;/);assert.match(native.toastXml!,/&apos;正文&apos;/);assert.doesNotMatch(native.toastXml!,/\u0000/);assert.match(native.toastXml!,/<audio silent="true"\/>/);
 assert.equal(notificationActivationId('win32',click),id);
 assert.doesNotMatch(nativeNotificationOptions('win32',{...options,silent:false}).toastXml!,/<audio/);
 assert.equal(nativeNotificationOptions('darwin',options),options);
 assert.throws(()=>nativeNotificationOptions('win32',{...options,id:'foreign-id'}),/notification_id_invalid/);
});

test('native activations ignore replies, dismissals, foreign identities and injected navigation',()=>{
 for(const value of [null,[],{}, {type:'reply',arguments:click.arguments,reply:'allow'}, {type:'action',arguments:click.arguments}, {...click,arguments:click.arguments+'&roomId=foreign'}, {...click,arguments:'https://example.invalid'}, {...click,arguments:'type=click&tag='+hash+'&tag='+hash}])assert.equal(notificationActivationId('win32',value),undefined);
 const response={identifier:id,actionIdentifier:'com.apple.UNNotificationDefaultActionIdentifier',userInfo:{roomId:'foreign',decision:'allow'}};
 assert.equal(notificationActivationId('darwin',response),id);
 assert.equal(notificationActivationId('darwin',{...response,actionIdentifier:'com.apple.UNNotificationDismissActionIdentifier'}),undefined);
 assert.equal(notificationActivationId('darwin',{...response,identifier:'foreign'}),undefined);
 assert.equal(notificationActivationId('linux',response),undefined);
});

test('a startup activation waits for the real consumer, keeps only the latest click and cannot revive after close',async()=>{
 const router=createNotificationActivationRouter('darwin'),seen:string[]=[];
 const response=(identifier:string)=>({identifier,actionIdentifier:'com.apple.UNNotificationDefaultActionIdentifier'});
 await router.receive(response(id));await router.receive(response('desktop-notification:'+'b'.repeat(64)));await router.receive({identifier:'foreign'});assert.equal(seen.length,0);
 await router.connect(async value=>{seen.push(value);});assert.deepEqual(seen,['desktop-notification:'+'b'.repeat(64)]);
 await router.receive(response(id));assert.deepEqual(seen,['desktop-notification:'+'b'.repeat(64),id]);
 router.close();await router.receive(response(id));await router.connect(async()=>{throw Error('closed router must not connect');});assert.equal(seen.length,2);
 const closed=createNotificationActivationRouter('win32');await closed.receive(click);closed.close();await closed.connect(async()=>{throw Error('closed pending click must not navigate');});
});

test('global and in-memory native clicks share source revalidation and never approve, answer or replay work',async()=>{
 const calls:any[]=[],navigations:any[]=[];
 const delivery=new NotificationDelivery({request:async(route,value)=>{calls.push({route,value});return {navigation:{roomId:'verified-room',jobId:'verified-job'}};},supported:()=>true,foreground:()=>false,create:()=>{throw Error('activation must never show a notification');},navigate:async value=>{navigations.push(value);},now:()=>10000});
 const router=createNotificationActivationRouter('win32');await router.receive(click);await router.connect(value=>delivery.activate(value));await delivery.activate(id);await router.receive(click);
 assert.deepEqual(calls,[{route:'/v1/desktop-notifications/locate',value:{id}}]);assert.deepEqual(navigations,[{roomId:'verified-room',jobId:'verified-job'}]);
 delivery.close();router.close();
});

test('the Windows notification application identity matches the actual installer identity',()=>{
 const yaml=readFileSync(new URL('../../electron-builder.yml',import.meta.url),'utf8');
 assert.equal(/^appId:\s*(\S+)$/m.exec(yaml)?.[1],KTEAM_APP_ID);
});
