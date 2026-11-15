import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseGroupConversation} from '../src/service/group-conversation.js';
test('group plans admit several real speakers and role-based stages without forcing a single leader response',()=>{
 const plan={mode:'work',members:['chief','pm','dev','qa'],reason:'distinct contributions',stages:[{requests:[{botId:'pm',message:'Clarify scope'}],doneWhen:'Scope returned'},{requests:[{botId:'dev',message:'Implement from scope'}],doneWhen:'Artifact returned'},{requests:[{botId:'qa',message:'Verify actual artifact'}],doneWhen:'Evidence returned'}]};
 assert.equal(parseGroupConversation(JSON.stringify(plan),plan.members,plan.members,'chief').stages.length,3);
 const withReview=parseGroupConversation(JSON.stringify({...plan,stages:[...plan.stages,{requests:[{botId:'chief',message:'Review actual results'}],doneWhen:'Final review'}]}),plan.members,plan.members,'chief');assert.equal(withReview.stages.length,3);assert.deepEqual(withReview.coordinatorReview,['Review actual results']);
 for(const change of [{members:['chief','foreign']},{stages:[{requests:[{botId:'chief',message:'Do everything'}],doneWhen:'Done'}]},{stages:[]},{mode:'invalid'},{members:['chief','chief']}])assert.throws(()=>parseGroupConversation(JSON.stringify({...plan,...change}),plan.members,plan.members,'chief'),/group_plan_invalid/);
 assert.deepEqual(parseGroupConversation(JSON.stringify({mode:'discussion',members:['pm','dev','qa'],reason:'Complementary perspectives'}),plan.members,plan.members,'chief').members,['pm','dev','qa']);
});
