import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {mkdirSync,readFileSync,symlinkSync,unlinkSync,writeFileSync} from 'node:fs';
import {realUpstreams} from './helpers/real-upstreams.js';
import {TeamStore} from '../src/service/team-store.js';
import {TeamCoordinator} from '../src/service/coordination.js';
import {ConversationService} from '../src/service/conversation.js';
import {createHarness,harnessWorkspace} from '../src/runtime/harness.js';
import {harnessSessionDirectory} from '../src/runtime/harness-session.js';
import {readMemoryView} from '../src/service/memory-view.js';

test('memory inspector reads the actual layered store without writing it, isolates members and rechecks current membership',async()=>{
 const f=await realUpstreams(),store=new TeamStore(f.root),previous=process.env.KTEAM_MODEL_CONFIG_DIR;process.env.KTEAM_MODEL_CONFIG_DIR=join(f.root,'models');let owner:any;
 try{
  const coordinator=new TeamCoordinator(f.upstream,store,1,{catalog:async()=>({defaultModelId:'fixture'}),identity:async()=>({model:'fixture-model',fingerprint:'frozen'})}),conversations=new ConversationService(f.root,f.upstream,store);
  const a=await coordinator.createMember({name:'Memory Fixture A',modelId:'fixture',requestId:'memory-member-a'},{requestSource:'user'}),b=await coordinator.createMember({name:'Memory Fixture B',modelId:'fixture',requestId:'memory-member-b'},{requestSource:'user'});
  const binding=store.binding(a.bot.id)!,cwd=harnessWorkspace(a.bot.kteamProfile?.workspace),scope={root:f.root,botId:a.bot.id,roomId:a.roomId,bindingRevision:binding.revision,fingerprint:binding.fingerprint,profileRevision:1};
  const harness=await createHarness({workspace:cwd,scope,signal:AbortSignal.timeout(15000),assertCurrent:async()=>{}});owner=await harness.prepare!({getModelName:()=> 'fixture',getModelPolicy:()=>({contextLimit:200000,compactThreshold:0.85})},'fixture','test',[]);
  await owner.memoryStore.save({id:'scope-note',scope:'global',title:'Memory scope fixture',summary:'FICTIONAL_MEMORY_MEMBER_A',tags:[],updatedAt:Date.now()});await owner.close();owner=undefined;
  const directory=harnessSessionDirectory(scope,cwd),file=join(directory,'memory.sqlite'),before=readFileSync(file);
  const view=await conversations.memory({roomId:a.roomId,botId:a.bot.id,layer:1});assert.equal(view.backend,'layered');assert(view.stats!.l1!>=1);assert.match(JSON.stringify(view.entries),/Memory scope fixture/);assert.match(JSON.stringify((await conversations.memory({roomId:a.roomId,botId:a.bot.id,layer:0})).entries),/FICTIONAL_MEMORY_MEMBER_A/);assert.deepEqual(readFileSync(file),before);
  assert.equal((await conversations.memory({roomId:b.roomId,botId:b.bot.id,layer:1})).backend,'empty');
  await assert.rejects(conversations.memory({roomId:b.roomId,botId:a.bot.id,layer:1}),/memory_scope_forbidden/);
  await assert.rejects(conversations.memory({roomId:a.roomId,botId:a.bot.id,layer:4}),/integration_input_invalid/);
  await assert.rejects(conversations.memory({roomId:a.roomId,botId:a.bot.id,layer:1,offset:-1}),/integration_input_invalid/);
  await assert.rejects(conversations.memory({roomId:a.roomId,botId:a.bot.id,path:file}),/unknown_field/);
  const membership=f.upstream.membership.bind(f.upstream);let calls=0;f.upstream.membership=async(id:string)=>{const value=await membership(id);calls++;return calls>1?{...value,members:(value.members as any[]).filter(m=>m.subject?.kind!=='user')}:value;};
  await assert.rejects(conversations.memory({roomId:a.roomId,botId:a.bot.id,layer:1}),/team_scope_changed/);f.upstream.membership=membership;
  const linked=join(f.root,'linked-memory');symlinkSync(directory,linked);assert.throws(()=>readMemoryView(linked,1,0),/harness_storage_invalid/);unlinkSync(linked);
 }finally{await owner?.close();store.close();if(previous===undefined)delete process.env.KTEAM_MODEL_CONFIG_DIR;else process.env.KTEAM_MODEL_CONFIG_DIR=previous;await f.close();}
});
