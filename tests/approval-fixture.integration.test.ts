import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {realUpstreams} from './helpers/real-upstreams.js';
import {sharedRuntime,modelIdentity} from '../src/runtime/native.js';
import {TeamStore} from '../src/service/team-store.js';
import {TeamCoordinator} from '../src/service/coordination.js';
import {saveBotProfile} from '../src/service/bot-profile.js';
import {initConfig} from '../src/service/config.js';
import {hostRequest} from '../src/service/client.js';
import {createDesktopAPI} from '../desktop/semantic-api.js';
import {mobileApprovalCard} from '../src/protocol/mobile-approval-card.js';

const {FIXTURE_TEXT,startApprovalFixture}=await import(new URL('../../scripts/manual-approval-fixture.mjs',import.meta.url).href) as {FIXTURE_TEXT:string;startApprovalFixture:(directory:string)=>Promise<{file:string;baseUrl:string;requests:()=>number;close:()=>Promise<void>}>};

async function until<T>(read:()=>Promise<T|false|undefined>){const end=Date.now()+20000;while(Date.now()<end){const value=await read();if(value)return value;await new Promise(resolve=>setTimeout(resolve,30));}throw Error('approval_fixture_timeout');}
async function startHost(root:string,configRoot:string){
  let output='';
  const child=spawn(process.execPath,[resolve('dist/src/cli.js'),'start'],{env:{...process.env,KTEAM_DATA_DIR:root,KTEAM_MODEL_CONFIG_DIR:configRoot,KTEAM_RUNTIME_ENTRY:resolve('build/shared/kteam-runtime.mjs'),KTEAM_NATIVE_CHILD:resolve('dist/src/runtime/native-child.js'),KTEAM_DISABLE_GLOBAL_PLUGINS:'1'},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',data=>output=(output+data).slice(-4000));child.stderr.on('data',data=>output=(output+data).slice(-4000));
  const close=async()=>{if(child.exitCode!==null||child.signalCode!==null)return;child.kill('SIGTERM');await new Promise<void>(done=>{const timer=setTimeout(()=>child.kill('SIGKILL'),8000);child.once('exit',()=>{clearTimeout(timer);done();});});};
  try{await until(async()=>{if(child.exitCode!==null)throw Error('approval_fixture_host_exited:'+output);try{await hostRequest(root,'kteam-main','/v1/handshake');return true;}catch{return false;}});return {close};}
  catch(error){await close();throw error;}
}

test('loopback fixture creates a real read-only approval, allow once leaves the file unchanged, and pause cancels the next one',async()=>{
  process.env.KTEAM_RUNTIME_ENTRY=resolve('build/shared/kteam-runtime.mjs');process.env.KTEAM_DISABLE_GLOBAL_PLUGINS='1';
  const f=await realUpstreams(),root=join(f.root,'host'),configRoot=join(f.root,'config'),workspace=join(f.root,'workspace');
  for(const path of [root,configRoot,workspace])mkdirSync(path,{mode:0o700});
  const previous=process.env.KTEAM_MODEL_CONFIG_DIR;process.env.KTEAM_MODEL_CONFIG_DIR=configRoot;
  const fixture=await startApprovalFixture(workspace);let host:Awaited<ReturnType<typeof startHost>>|undefined;
  try{
    const core=await sharedRuntime(),config=await core.loadConfig();
    config.providers.fixture={protocol:'openai_legacy',baseUrl:fixture.baseUrl,apiKey:'fixture-not-a-secret'};
    config.models.fixture={provider:'fixture',model:'fixture-not-a-real-model',label:'测试夹具（不是真实模型）'};
    config.defaultModelId='fixture';config.defaultProvider='fixture';await core.saveConfig(config);
    initConfig(root,{version:1,brokerUrl:f.upstream.options.brokerUrl,kswarmUrl:f.upstream.options.kswarmUrl,brokerTokenFile:join(root,'broker-token'),kswarmTokenFile:join(root,'kswarm-token')});
    writeFileSync(join(root,'broker-token'),f.upstream.options.brokerToken,{mode:0o600});writeFileSync(join(root,'kswarm-token'),f.upstream.options.kswarmToken,{mode:0o600});
    const store=new TeamStore(root),coordinator=new TeamCoordinator(f.upstream,store,1,{catalog:async()=>({defaultModelId:'fixture'}),identity:modelIdentity});
    const member=await coordinator.createMember({name:'夹具只读验收',modelId:'fixture',requestId:'approval-fixture'},{requestSource:'user'});
    await saveBotProfile(f.upstream,store,{botId:member.bot.id,expectedRevision:0,description:'只读取夹具文件',instructions:'只提出夹具给出的读取命令',participation:'auto',workspace,followup:false});
    store.setState('assistant-proactivity',{enabled:false});store.close();
    host=await startHost(root,configRoot);
    const api=createDesktopAPI((route,value)=>hostRequest(root,'kteam-main',route,value));
    const pending=async()=>{const row=(await api.toolApprovals()).approvals[0];if(row)return row;const job=(await api.work(member.roomId)).jobs.at(-1);if(job&&['blocked','unknown','delivered','stopped'].includes(job.state)&&fixture.requests()===1)throw Error('approval_fixture_ended:'+JSON.stringify({state:job.state,reason:job.reason,failure:job.failure}));return undefined;};
    await api.send({roomId:member.roomId,text:'请读取夹具文件。',id:'msg_'+'a'.repeat(32)});
    const first=await until(pending);
    assert.match(first.id,/^tool-approval:/);assert.match(first.hash,/^[a-f0-9]{64}$/);assert.equal(first.toolName,'bash');assert.match(String(first.display),/cat/);assert.match(String(first.display),/fixture-note\.pem/);
    const inbox=await hostRequest(root,'kteam-main','/v1/inbox') as {approvals?:Array<{id?:string;hash?:string}>};
    const visible=(inbox.approvals??[]).find(item=>item.id===first.id);
    assert.ok(visible,'the phone inbox reads this same approval list');
    const card=mobileApprovalCard(visible);
    assert.equal(card.hash,first.hash);
    assert.deepEqual(card.decisions,['deny','allow_once']);
    assert.equal(readFileSync(fixture.file,'utf8'),FIXTURE_TEXT);
    await api.decideToolApproval({id:first.id,expectedHash:first.hash,decision:'allow_once'});
    await until(async()=>fixture.requests()>=2||undefined);
    assert.equal(readFileSync(fixture.file,'utf8'),FIXTURE_TEXT);
    await until(async()=>{const job=(await api.work(member.roomId)).jobs.find((item:any)=>item.id===first.jobId);return job&&['delivered','stopped','blocked'].includes(job.state)?job:undefined;});
    const afterAllow=fixture.requests();
    await api.send({roomId:member.roomId,text:'请再读取一次夹具文件。',id:'msg_'+'b'.repeat(32)});
    const second=await until(pending);
    assert.notEqual(second.id,first.id);
    await api.pause(member.roomId);
    assert.equal((await api.toolApprovals()).approvals.length,0);
    await assert.rejects(api.decideToolApproval({id:second.id,expectedHash:second.hash,decision:'allow_once'}));
    assert.equal(readFileSync(fixture.file,'utf8'),FIXTURE_TEXT);
    assert.equal(fixture.requests(),afterAllow+1);
  }finally{await host?.close();await fixture.close();if(previous===undefined)delete process.env.KTEAM_MODEL_CONFIG_DIR;else process.env.KTEAM_MODEL_CONFIG_DIR=previous;await f.close();}
});
