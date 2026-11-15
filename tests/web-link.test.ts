import {test} from 'node:test';
import assert from 'node:assert/strict';
import {webLinkUrl} from '../src/protocol/web-link.js';
import {createDesktopAPI,dispatchDesktop} from '../desktop/semantic-api.js';
test('web links retain paths, query and fragments and cannot open local or executable protocols',()=>{
 assert.equal(webLinkUrl('https://github.com/kaisersong/beek#readme'),'https://github.com/kaisersong/beek#readme');
 assert.equal(webLinkUrl('http://localhost:3000/report?q=one&view=two#results'),'http://localhost:3000/report?q=one&view=two#results');
 for(const value of ['file:///etc/passwd','javascript:alert(1)','data:text/html,test','mailto:a@example.test','vscode://file/test','//example.com','/tmp/report.html','https://user:secret@example.com','https://example.com\nfile:///test','https://example.com/a b',{},null])assert.equal(webLinkUrl(value),undefined,String(value));
});
test('the semantic bridge exposes only the named web opener and reports native failures',async()=>{
 const opened:any[]=[];const api=createDesktopAPI(async()=>{throw Error('unexpected host request');},{nativeActions:{openWebLink:async input=>{opened.push(input);return {ok:true};}}});
 await dispatchDesktop(api,'openWebLink',[{url:'https://github.com/kaisersong/beek#readme'}]);assert.deepEqual(opened,[{url:'https://github.com/kaisersong/beek#readme'}]);
 await assert.rejects(dispatchDesktop(api,'openExternal',['file:///etc/passwd']),/desktop_method_forbidden/);
 const unavailable=createDesktopAPI(async()=>({}));await assert.rejects(dispatchDesktop(unavailable,'openWebLink',[{url:'https://example.com'}]),/desktop_action_unavailable/);
});
