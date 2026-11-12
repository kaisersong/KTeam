import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createChatSubmission,readChatDrafts,writeChatDrafts,type ChatSubmission} from '../desktop/renderer/src/chat-submission.js';

test('sending waits only for its receipt, deduplicates double clicks and keeps conversations independent',async()=>{
 const calls:ChatSubmission[]=[];let release!:()=>void;const blocked=new Promise<void>(done=>release=done);
 const sender=createChatSubmission(async intent=>{calls.push(intent);if(intent.roomId==='one')await blocked;});
 const first=sender.send({roomId:'one',text:'first'});assert.equal(sender.pending('one'),true);
 assert.equal(await sender.send({roomId:'one',text:'double click'}),undefined);
 assert.ok(await sender.send({roomId:'two',text:'other conversation'}));assert.equal(sender.pending('two'),false);
 release();const sent=await first;assert.equal(sent?.text,'first');assert.equal(sender.pending('one'),false);assert.equal(calls.filter(call=>call.roomId==='one').length,1);
});

test('a missing receipt unlocks sending, preserves its ID for explicit retry and ignores a late original receipt',async()=>{
 const calls:ChatSubmission[]=[];let release!:()=>void;const first=new Promise<void>(done=>release=done);
 const sender=createChatSubmission(async intent=>{calls.push(intent);if(calls.length===1)await first;},15);
 await assert.rejects(sender.send({roomId:'one',text:'preserved draft'}),/message_send_receipt_unknown/);
 assert.equal(sender.pending('one'),false);
 const retry=await sender.send({roomId:'one',text:'preserved draft'});assert.equal(retry?.id,calls[0]!.id);assert.equal(calls.length,2);
 release();await Promise.resolve();assert.equal(sender.pending('one'),false);
 const next=await sender.send({roomId:'one',text:'a new message'});assert.notEqual(next?.id,retry?.id);
});

test('changing draft or reply after an unknown result creates a distinct explicit intent',async()=>{
 const calls:ChatSubmission[]=[];const sender=createChatSubmission(async intent=>{calls.push(intent);if(calls.length===1)throw Error('host_operation_unknown');});
 await assert.rejects(sender.send({roomId:'one',text:'draft',replyToMessageId:'old'}));
 await sender.send({roomId:'one',text:'draft',replyToMessageId:'new'});assert.notEqual(calls[0]!.id,calls[1]!.id);
});

test('saved drafts survive reload and reject malformed or oversized values',()=>{
 assert.deepEqual(readChatDrafts({getItem:()=>JSON.stringify({one:'still typing',two:'',bad:12,long:'x'.repeat(32769)})}),{one:'still typing',two:''});
 for(const value of ['broken','null','[]','1'])assert.deepEqual(readChatDrafts({getItem:()=>value}),{});
 assert.deepEqual(readChatDrafts({getItem:()=>{throw Error('storage denied');}}),{});
});

test('each draft edit is stored synchronously before a reload and a denied write never blocks typing',()=>{
 let saved='';writeChatDrafts({setItem:(_key,value)=>{saved=value;}},{room:'new draft'});assert.equal(readChatDrafts({getItem:()=>saved}).room,'new draft');
 assert.doesNotThrow(()=>writeChatDrafts({setItem:()=>{throw Error('quota');}},{room:'still typing'}));
});

test('an explicit retry after reloading preserves a lost receipt ID without automatically sending',async()=>{
 const values=new Map<string,string>(),storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);}},calls:ChatSubmission[]=[];
 const first=createChatSubmission(async intent=>{calls.push(intent);throw Error('lost receipt');},1000,storage);
 await assert.rejects(first.send({roomId:'one',text:'draft preserved across reload'}));
 const reloaded=createChatSubmission(async intent=>{calls.push(intent);},1000,storage);assert.equal(calls.length,1);
 await reloaded.send({roomId:'one',text:'draft preserved across reload'});assert.equal(calls[0]!.id,calls[1]!.id);
 const confirmed=createChatSubmission(async intent=>{calls.push(intent);},1000,storage);await confirmed.send({roomId:'one',text:'draft preserved across reload'});assert.notEqual(calls[2]!.id,calls[1]!.id);
});
