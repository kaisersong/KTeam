import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {rmSync} from 'node:fs';
import {privateTempDir} from './helpers/private-temp.js';
import {TeamStore} from '../src/service/team-store.js';
import {parseGroupConversation,queueGroupDiscussion} from '../src/service/group-conversation.js';
const fixture=()=>{const root=privateTempDir(join(tmpdir(),'parallel-group-'));return {root,store:new TeamStore(root)};};
test('independent speakers claim in parallel, explicit dependencies wait for real completion, cycles and failed dependencies never execute',()=>{
 const {root,store}=fixture();try{const roomId='room',members=['a','b','c'];store.configure({roomId,kind:'group',goal:'',mode:'auto',paused:false,quiet:false,revision:0,maxRuns:100,dailyCalls:100},0);store.enqueue('root',roomId,'source');const job=store.job('root'),plan=parseGroupConversation(JSON.stringify({mode:'discussion',members,reason:'parallel',dependencies:{c:['a','b']}}),members,members);queueGroupDiscussion(store,job,plan);
 const a=store.claim([roomId]),b=store.claim([roomId],false,{bots:[a.groupResponse.botId]});assert.notEqual(a.groupResponse.botId,b.groupResponse.botId);assert.equal(store.claim([roomId]),null);a.state='delivered';store.save(a);assert.equal(store.claim([roomId]),null);b.state='noop';store.save(b);assert.equal(store.claim([roomId]).groupResponse.botId,'c');
 assert.throws(()=>parseGroupConversation(JSON.stringify({...plan,dependencies:{a:['b'],b:['a']}}),members,members),/group_dependency_cycle/);assert.throws(()=>parseGroupConversation(JSON.stringify({...plan,dependencies:{a:['foreign']}}),members,members),/group_plan_invalid/);
 store.enqueueFollowup({id:'failed-child',roomId,originId:'source',dependsOnJobIds:[a.id]});a.state='unknown';store.save(a);store.claim();assert.equal(store.job('failed-child').reason,'group_dependency_failed');
 }finally{store.close();rmSync(root,{recursive:true,force:true});}
});
