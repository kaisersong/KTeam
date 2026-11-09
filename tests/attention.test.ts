import{test}from'node:test';import assert from'node:assert/strict';
import{attentionSource}from'../src/service/attention.js';
test('private confirmation points to the original group even when a peer consultation is waiting',()=>{
 const jobs:any={peer:{roomId:'bot-peer',peer:{rootJobId:'root'}},root:{roomId:'product',partialText:'PRIVATE_DRAFT'}};
 const result=attentionSource({id:'approval',jobId:'peer',sourceRoomId:'bot-peer',roomId:'user-direct'},id=>jobs[id]);
 assert.equal(result.rootSourceRoomId,'product');assert.equal(result.roomId,'user-direct');assert.doesNotMatch(JSON.stringify(result),/PRIVATE_DRAFT|partialText/);
});
test('missing or mismatched peer lineage never invents a parent group',()=>{
 for(const job of [null,{roomId:'other',peer:{rootJobId:'root'}},{roomId:'peer'}])assert.equal(attentionSource({jobId:'job',sourceRoomId:'peer'},id=>id==='root'?{roomId:'wrong-parent'}:job).rootSourceRoomId,'peer');
 assert.equal(attentionSource({sourceRoomId:'product'},()=>{throw Error('must not read');}).rootSourceRoomId,'product');
});
