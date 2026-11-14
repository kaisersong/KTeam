import {test} from 'node:test';
import assert from 'node:assert/strict';
import {approvalSystemNotice} from '../src/protocol/system-notice.js';
test('approval notice uses original purpose metadata, including historical wording, never text matching',()=>{
 const message={sender:{kind:'agent'},text:'关于原群中的操作，我需要你单独确认。',sourceRef:{kind:'bot_private_message',purpose:'approval',originRoomId:'group-original',verifiedExecution:false}};
 assert.deepEqual(approvalSystemNotice(message),{kind:'approval_required',sourceRoomId:'group-original'});
 for(const sourceRef of [{...message.sourceRef,purpose:'question'},{...message.sourceRef,purpose:'consult'},{...message.sourceRef,originRoomId:''},{...message.sourceRef,kind:'aimp_reply'},undefined])assert.equal(approvalSystemNotice({...message,sourceRef}),undefined);
 assert.equal(approvalSystemNotice({...message,sender:{kind:'user'}}),undefined);
 assert.equal(approvalSystemNotice({sender:{kind:'agent'},text:message.text}),undefined);
});
