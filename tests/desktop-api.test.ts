import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDesktopAPI,dispatchDesktop,trustedFrame} from '../desktop/semantic-api.js';
test('desktop exposes semantic operations only, binds user sender and refuses generic/prototype methods',async()=>{
 const calls:any[]=[];const api=createDesktopAPI(async(...args)=>{calls.push(args);return {ok:true};});
 await api.send({roomId:'room/one',text:'请准备复盘',id:'msg_'+'a'.repeat(32),from:'agent://evil/admin'});
 assert.equal(calls[0][0],'/v1/messages');assert.equal(calls[0][1].from,'human://kteam.local/user.local');
 assert.equal(calls[0][1].act,'chat');
 await assert.rejects(dispatchDesktop(api,'__proto__',[]),/desktop_method_forbidden/);
 await assert.rejects(dispatchDesktop(api,'request',['/etc/passwd']),/desktop_method_forbidden/);
 assert.throws(()=>api.messages({roomId:'room',after:0,limit:10000}),/invalid_pagination/);
 const frame={};assert.equal(trustedFrame(frame,frame),true);assert.equal(trustedFrame({},frame),false);assert.equal(trustedFrame(null,null),false);
});
test('computer permission links only open fixed macOS privacy panes through the native semantic action',async()=>{
 const {computerPermissionSettingsUrl}=await import('../desktop/computer-permissions.js');
 assert.match(computerPermissionSettingsUrl({permission:'accessibility'},'darwin'),/Privacy_Accessibility$/);
 assert.match(computerPermissionSettingsUrl({permission:'screen-recording'},'darwin'),/Privacy_ScreenCapture$/);
 assert.throws(()=>computerPermissionSettingsUrl({permission:'https://example.invalid'},'darwin'),/computer_permission_invalid/);
 assert.throws(()=>computerPermissionSettingsUrl({permission:'__proto__'},'darwin'),/computer_permission_invalid/);
 assert.throws(()=>computerPermissionSettingsUrl({permission:'automation',url:'file:///etc/passwd'},'darwin'),/unknown_field/);
 assert.throws(()=>computerPermissionSettingsUrl({permission:'accessibility'},'linux'),/desktop_action_unavailable/);
 const calls:unknown[]=[],api=createDesktopAPI(async()=>{throw Error('must_not_use_host_http');},{nativeActions:{openComputerPermissionSettings:async input=>{calls.push(computerPermissionSettingsUrl(input,'darwin'));return {ok:true};}}});
 await dispatchDesktop(api,'openComputerPermissionSettings',[{permission:'automation'}]);assert.deepEqual(calls,['x-apple.systempreferences:com.apple.preference.security?Privacy_Automation']);
});
