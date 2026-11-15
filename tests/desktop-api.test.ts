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


test('artifact preview and inbox use receipt-scoped semantic APIs, and external open retains its explicit target',async()=>{
 const calls:any[]=[],opens:any[]=[];const api=createDesktopAPI(async(...args)=>{calls.push(args);return {ok:true};},{nativeActions:{openGeneratedFile:async input=>{opens.push(input);return {ok:true};}}});
 await dispatchDesktop(api,'previewGeneratedFile',[{roomId:'room/one',toolCallId:'tool?one'}]);assert.equal(calls[0][0],'/v1/teams/room%2Fone/generated-file-preview?toolCallId=tool%3Fone');
 await dispatchDesktop(api,'openGeneratedFile',[{roomId:'room/one',toolCallId:'tool?one',target:'browser'}]);assert.deepEqual(opens,[{roomId:'room/one',toolCallId:'tool?one',target:'browser'}]);
 await dispatchDesktop(api,'changeInbox',[{action:'read',items:[]}]);assert.equal(calls[1][0],'/v1/inbox/change');
 await assert.rejects(dispatchDesktop(api,'readFile',['/etc/passwd']),/desktop_method_forbidden/);
});
