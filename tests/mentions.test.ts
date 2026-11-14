import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mentionQuery,rebaseMentions,selectedMentions,groupMentionTargets} from '../src/protocol/mentions.js';
const member={name:'CTO',address:'agent://kteam.local/a'},token={...member,start:0,end:4};
test('mention picker finds cursor-local queries without treating email addresses as mentions',()=>{
 assert.deepEqual(mentionQuery('@',1),{start:0,end:1,query:''});
 assert.equal(mentionQuery('mail@example.com',16),undefined);
 assert.deepEqual(mentionQuery('请 @CTO 看看',6),{start:2,end:6,query:'CTO'});
 assert.equal(mentionQuery('@CTO\nhello',10),undefined);
});
test('mention identities survive unrelated edits but disappear when the selected token is edited or removed',()=>{
 assert.deepEqual(selectedMentions('@CTO 请看',[token],[member]),[member.address]);
 const shifted=rebaseMentions('@CTO 请看','请 @CTO 请看',[token]);assert.equal(shifted[0]?.start,2);
 assert.deepEqual(rebaseMentions('@CTO 请看','@CTO 请检查',[token]),[token]);
 for(const text of ['@CEO 请看','CTO 请看','请看',''])assert.deepEqual(rebaseMentions('@CTO 请看',text,[token]),[]);
 assert.deepEqual(selectedMentions('@CTO',[token],[]),[]);
 assert.deepEqual(selectedMentions('@CTO',[],[member]),[]);
 assert.deepEqual(selectedMentions('@CTO',[token,token],[member]),[member.address]);
});
test('agent-authored or unproven mention metadata never selects a user reply target',()=>{
 const message={sender:{kind:'user'},sourceRef:{kind:'aimp_l0',envelope:{mentions:[member.address]}}};assert.deepEqual(groupMentionTargets(message),[member.address]);
 assert.deepEqual(groupMentionTargets({...message,sender:{kind:'agent'}}),[]);
 assert.deepEqual(groupMentionTargets({...message,sourceRef:{kind:'bot_private_message',envelope:message.sourceRef.envelope}}),[]);
});
