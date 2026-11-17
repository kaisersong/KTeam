import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {realUpstreams} from './helpers/real-upstreams.js';
import {TeamStore} from '../src/service/team-store.js';
import {TeamCoordinator} from '../src/service/coordination.js';
import {GroupMembers} from '../src/service/group-members.js';
import {ToolApprovals} from '../src/service/tool-approvals.js';
import {groupDirectoryApproval} from '../src/service/group-directory-approval.js';
import {sharedRuntime,modelIdentity,runtimeArtifactRevision} from '../src/runtime/native.js';
import {runtimeIntegrationRevision} from '../src/service/integration-settings.js';
import {createHash} from 'node:crypto';
import {createHarness} from '../src/runtime/harness.js';
async function fixture(){
 process.env.KTEAM_RUNTIME_ENTRY=resolve('build/shared/kteam-runtime.mjs');const f=await realUpstreams(),root=join(f.root,'host'),workspace=join(f.root,'workspace'),config=join(f.root,'config');for(const path of [root,workspace,config])mkdirSync(path);
 const before=process.env.KTEAM_MODEL_CONFIG_DIR;process.env.KTEAM_MODEL_CONFIG_DIR=config;const core=await sharedRuntime(),configData=await core.loadConfig();configData.providers.openai={protocol:'openai_legacy',apiKey:'FICTIONAL_GROUP_KEY',baseUrl:'http://127.0.0.1:1/v1'};configData.models.fixture={provider:'openai',model:'fixture'};writeFileSync(join(config,'config.json'),JSON.stringify(configData));
 const store=new TeamStore(root),approvals=new ToolApprovals(store),coordinator=new TeamCoordinator(f.upstream,store,1,{catalog:async()=>({defaultModelId:'fixture'}),identity:modelIdentity});
 const members=[];for(let i=0;i<3;i++)members.push(await coordinator.createMember({name:'成员'+i,modelId:'fixture',requestId:'member-'+i},{requestSource:'user'}));
 const group=await coordinator.createGroup({title:'授权验证群',goal:'',memberAgentIds:members.slice(0,2).map(m=>m.bot.id),requestId:'group'},{requestSource:'user'}),roomId=group.room.roomId,controller=new AbortController(),registries:any[]=[];
 approvals.setDirectoryGroupProvider(scope=>groupDirectoryApproval(f.upstream,store,scope));
 // Work is private, but its owned parent points back to the public group.
 store.enqueue('root',roomId,'source');store.enqueue('peer',members[0]!.roomId,'source-peer');const job=store.job('peer');job.peer={rootJobId:'root',sourceRoomId:roomId};store.save(job);
 const scope={roomId:job.roomId,jobId:'peer',botId:members[0]!.bot.id,cwd:workspace,bindingRevision:1};
 return {...f,store,approvals,workspace,roomId,members,scope,controller,core,
 async pending(){for(let n=0;n<1000;n++){const row=approvals.list()[0];if(row)return row;await new Promise(r=>setTimeout(r,5));}throw Error('approval timeout');},
 ask(){return approvals.ask(scope,'write',{file_path:join(workspace,'first.txt'),content:'fixture'},controller.signal,async()=>{});},
 async harness(botId:string,toolScope?:any){const h=await createHarness({workspace,toolScope,permissions:{store:approvals.permissions,botId,bindingRevision:1},signal:controller.signal,assertCurrent:async()=>{},onPrompt:async()=>false});const registry=new core.ToolRegistry(h.registryOptions,h.tools);registries.push(registry);return {h,registry};},
 async close(){controller.abort();approvals.close();for(const registry of registries)registry.dispose();store.close();if(before===undefined)delete process.env.KTEAM_MODEL_CONFIG_DIR;else process.env.KTEAM_MODEL_CONFIG_DIR=before;await f.close();}};
}

test('group directory grant routes private work to its source group and lets both members write real files after restart',async()=>{const f=await fixture();try{
 let privateNotices=0;assert.equal(await f.approvals.approvalDisplay(f.scope,'write',{file_path:join(f.workspace,'first.txt'),content:'fixture'},async()=>{privateNotices++;return 'private';}),f.roomId);assert.equal(privateNotices,0);
 const work=f.ask(),p=await f.pending();assert.equal(p.roomId,f.roomId);assert.equal(f.approvals.list(f.scope.roomId).length,0);assert.equal(p.directoryGroupScope.members.length,2);
 await assert.rejects(f.approvals.decide({id:p.id,expectedHash:'forged',decision:'allow_directory_routine',applyToGroup:true}),/tool_approval_changed/);
 const peer2=f.store.job('peer');f.store.enqueue('peer-two',peer2.roomId,'source-peer-two');const secondJob=f.store.job('peer-two');secondJob.peer=peer2.peer;f.store.save(secondJob);const secondWork=f.approvals.ask({...f.scope,jobId:'peer-two',botId:f.members[1]!.bot.id},'write',{file_path:join(f.workspace,'second.txt'),content:'fixture'},f.controller.signal,async()=>{});for(let n=0;n<1000&&f.approvals.list().length<2;n++)await new Promise(r=>setTimeout(r,5));assert.equal(f.approvals.list().length,2);
 const decision={id:p.id,expectedHash:p.hash,decision:'allow_directory_routine',applyToGroup:true};await f.approvals.decide(decision);assert.equal(await work,true);assert.equal(await secondWork,true);assert.equal(f.approvals.list().length,0);assert.equal((await f.approvals.decide(decision)).reused,true);
 await assert.rejects(f.approvals.decide({...decision,applyToGroup:false}),/tool_approval_expired/);
 const restored=new ToolApprovals(f.store);assert.equal(restored.permissions.list().length,2);restored.close();
 for(const [i,m] of f.members.slice(0,2).entries()){const {registry}=await f.harness(m.bot.id),file=join(f.workspace,'real-'+i+'.txt');await registry.executeTool('write',{file_path:file,content:'written-'+i});assert.equal(readFileSync(file,'utf8'),'written-'+i);}
 const other=await f.harness(f.members[2]!.bot.id);assert.equal(await other.h.registryOptions.permissionManager.check('write',{file_path:join(f.workspace,'outside.txt'),content:'no'}),'prompt');
 const second=await f.harness(f.members[1]!.bot.id);assert.notEqual(await second.h.registryOptions.permissionManager.check('bash',{command:'git reset --hard',workdir:f.workspace}),'allow');
 const denied=await f.harness(f.members[1]!.bot.id,{version:1,files:{mode:'none',paths:[],write:false},terminal:'off',network:'inherit',mcp:{mode:'inherit',servers:[]}});assert.notEqual(await denied.h.registryOptions.permissionManager.check('write',{file_path:join(f.workspace,'denied.txt'),content:'no'}),'allow');
 }finally{await f.close();}});

test('directory approval opt-out grants only the requester; allow once never grants the group',async()=>{const f=await fixture();try{
 let work=f.ask(),p=await f.pending();await assert.rejects(f.approvals.decide({id:p.id,expectedHash:p.hash,decision:'allow_once',applyToGroup:true}),/invalid_input/);await f.approvals.decide({id:p.id,expectedHash:p.hash,decision:'allow_once'});assert.equal(await work,true);assert.equal(f.approvals.permissions.list().length,0);
 work=f.ask();p=await f.pending();await f.approvals.decide({id:p.id,expectedHash:p.hash,decision:'allow_directory_routine',applyToGroup:false});assert.equal(await work,true);assert.deepEqual(f.approvals.permissions.list().map(g=>g.botId),[f.scope.botId]);
 }finally{await f.close();}});

test('changed group membership rejects the entire grant and excludes later members',async()=>{const f=await fixture();try{
 const work=f.ask(),p=await f.pending();await new GroupMembers(f.upstream,f.store).control(f.roomId,{action:'add',botIds:[f.members[2]!.bot.id],expectedRoomRevision:p.directoryGroupScope.revision,requestId:'add-third'},{requestSource:'user'});
 await assert.rejects(f.approvals.decide({id:p.id,expectedHash:p.hash,decision:'allow_directory_routine',applyToGroup:true}),/tool_approval_group_changed/);assert.equal(f.approvals.permissions.list().length,0);
 f.controller.abort();assert.equal(await work,false);
 }finally{await f.close();}});

test('changed recipient binding rejects all grants; high-risk commands retain individual confirmation',async()=>{const f=await fixture();try{
 const work=f.ask(),p=await f.pending(),binding=f.store.binding(f.members[1]!.bot.id)!;f.store.bind({...binding,revision:binding.revision+1});
 await assert.rejects(f.approvals.decide({id:p.id,expectedHash:p.hash,decision:'allow_directory_routine',applyToGroup:true}),/tool_approval_group_changed/);assert.equal(f.approvals.permissions.list().length,0);f.controller.abort();assert.equal(await work,false);
 let notices=0;assert.equal(await f.approvals.approvalDisplay(f.scope,'bash',{command:'git reset --hard',workdir:f.workspace},async()=>{notices++;return 'individual';}),f.roomId);assert.equal(notices,0);
 const signal=new AbortController(),result=f.approvals.ask({...f.scope,displayRoomId:f.roomId},'bash',{command:'git reset --hard',workdir:f.workspace},signal.signal,async()=>{}),high=await f.pending();assert.equal(high.directoryGroupScope,undefined);await assert.rejects(f.approvals.decide({id:high.id,expectedHash:high.hash,decision:'allow_directory_routine',applyToGroup:true}),/invalid_input/);signal.abort();assert.equal(await result,false);
 }finally{await f.close();}});


test('durable group directory approval survives host restart and resumes the original tool boundary once',async()=>{const f=await fixture();let restored:ToolApprovals|undefined;try{
 const model=await modelIdentity('fixture'),facts={batchId:'group-batch',index:0,permissionFingerprint:createHash('sha256').update(JSON.stringify(f.core.mergeRules(await f.core.loadSettings(f.workspace)))).digest('hex'),settingsRevision:await runtimeIntegrationRevision(),runtimeRevision:await runtimeArtifactRevision()},scope={...f.scope,sessionCwd:f.workspace,modelId:'fixture',modelFingerprint:model.fingerprint,permissionEpoch:0,deadline:Date.now()+60000},args={file_path:join(f.workspace,'durable.txt'),content:'durable'};
 const waiting=async(row:any)=>{const job=f.store.job('peer');job.state='waiting';f.store.save(job);f.store.saveOperation({id:'handoff-fixture',status:'waiting'},0);f.store.saveOperation({...f.store.operation(row.id),handoffId:'handoff-fixture'},row.revision);};
 await assert.rejects(f.approvals.prepareDurable(scope,'write',args,facts,'prompt','write',waiting,async()=>{}));const pending=await f.pending();assert.equal(pending.roomId,f.roomId);f.approvals.close();
 restored=new ToolApprovals(f.store);restored.setDirectoryGroupProvider(value=>groupDirectoryApproval(f.upstream,f.store,value));restored.setDurableGuard(async()=>{});
 await restored.decide({id:pending.id,expectedHash:pending.hash,decision:'allow_directory_routine',applyToGroup:true});assert.equal(restored.permissions.list().length,2);
 assert.equal(await restored.prepareDurable(scope,'write',args,facts,'prompt','write',async()=>{throw Error('must not recreate approval');},async()=>{}),true);restored.finishDurable('peer','group-batch',0);
 await assert.rejects(restored.prepareDurable(scope,'write',args,facts,'prompt','write',async()=>{},async()=>{}),/tool_approval_result_unknown/);
 }finally{restored?.close();await f.close();}});
