import {test} from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {rmSync} from 'node:fs';
import {privateTempDir} from './helpers/private-temp.js';
import {TeamStore} from '../src/service/team-store.js';
import {retireStaleToolBatch} from '../src/service/stale-tool-batch.js';

test('stale approval retirement requires terminal scoped owner and exact unconsumed approval; repeated retirement is safe',()=>{
 const root=privateTempDir(join(tmpdir(),'stale-batch-')),store=new TeamStore(root);
 const scope={roomId:'room',botId:'bot',bindingRevision:1,profileRevision:2,fingerprint:'fp',cwd:root};
 const batch={id:'batch',ownerId:'old',state:'waiting_approval',approvalId:'tool-approval:fixture',calls:[{type:'tool_use',id:'done',name:'read',input:{}},{type:'tool_use',id:'next',name:'write',input:{file_path:'fictional'}}],results:[{type:'tool_result',tool_use_id:'done',content:'REAL_RESULT'}]};
 const approval={id:batch.approvalId,...scope,modelFingerprint:'fp',durable:true,jobId:'old',batchId:'batch',index:1,toolName:'write',input:{file_path:join(root,'fictional')},status:'allowed'};
 try{
  store.enqueue('old','room','origin');const old=store.job('old');old.state='blocked';store.save(old);
  const save=(changes:any)=>{const prior=store.operation(approval.id);store.saveOperation({...approval,...changes},prior?.revision??0);};
  for(const status of ['executing','completed','unknown']){save({status});assert.equal(retireStaleToolBatch(store,batch,scope),false);}
  for(const changes of [{roomId:'foreign'},{botId:'foreign'},{index:0},{input:{}},{bindingRevision:2},{profileRevision:9},{cwd:'foreign'}]){save(changes);assert.equal(retireStaleToolBatch(store,batch,scope),false);}
  save({});old.state='running';store.save(old);assert.equal(retireStaleToolBatch(store,batch,scope),false);
  old.state='blocked';old.stopResultUnknown=true;store.save(old);assert.equal(retireStaleToolBatch(store,batch,scope),false);
  delete old.stopResultUnknown;store.save(old);assert.equal(retireStaleToolBatch(store,{...batch,state:'executing'},scope),false);
  for(const status of ['allowed','pending','denied','cancelled']){save({status});assert.equal(retireStaleToolBatch(store,batch,scope),true);assert.equal(store.operation(approval.id).status,'cancelled');assert.equal(retireStaleToolBatch(store,batch,scope),true);}
  assert.equal(batch.results[0]!.content,'REAL_RESULT');
 }finally{store.close();rmSync(root,{recursive:true,force:true});}
});

test('unknown batches can only be quarantined by their exact recovery chain, never an active or foreign owner',async()=>{
 const {retireUnknownToolBatch}=await import('../src/service/stale-tool-batch.js');const root=privateTempDir(join(tmpdir(),'unknown-batch-')),store=new TeamStore(root),scope={roomId:'room',botId:'bot',bindingRevision:1,profileRevision:1,fingerprint:'fp',cwd:root};
 try{store.enqueue('old','room','origin');const old=store.job('old');Object.assign(old,{state:'stopped',activeBotId:'bot'});store.save(old);
 store.enqueueFollowup({id:'new',roomId:'room',originId:'origin',trigger:'recovery',state:'running',recoveryOf:'old',activeBotId:'bot',recoveryBindings:{bot:{revision:1,fingerprint:'fp'}}});const job=store.job('new');job.state='running';store.save(job);
 const batch={id:'batch_123',ownerId:'old',state:'executing',calls:[{id:'done'},{id:'unknown'}],results:[{type:'tool_result',tool_use_id:'done',content:'REAL_RESULT'}]};
 for(const patch of [{roomId:'foreign'},{botId:'foreign'},{bindingRevision:2}])assert.equal(retireUnknownToolBatch(store,batch,{...scope,...patch},'new'),false);
 old.state='running';store.save(old);assert.equal(retireUnknownToolBatch(store,batch,scope,'new'),false);old.state='stopped';old.stopResultUnknown=true;store.save(old);assert.equal(retireUnknownToolBatch(store,batch,scope,'new'),false);delete old.stopResultUnknown;store.save(old);
 job.originId='other';store.save(job);assert.equal(retireUnknownToolBatch(store,batch,scope,'new'),false);job.originId='origin';store.save(job);
 assert.equal(retireUnknownToolBatch(store,batch,scope,'new'),true);assert.equal(retireUnknownToolBatch(store,batch,scope,'new'),true);assert.deepEqual(store.operation('quarantined-tool-batch:'+batch.id).batch,batch);assert.equal(store.job('old').state,'stopped');
 }finally{store.close();rmSync(root,{recursive:true,force:true});}
});
