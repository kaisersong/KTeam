import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verifyExecutionScope} from '../src/service/execution-guard.js';
import {KTeamError} from '../src/errors.js';

test('transient preflight reconnects once and rechecks the current scope before admission',async()=>{
 let reads=0,effects=0;
 await verifyExecutionScope(async()=>{if(++reads===1)throw new KTeamError('broker_unavailable',503);},new AbortController().signal);
 effects++;assert.equal(reads,2);assert.equal(effects,1);
 reads=0;
 await assert.rejects(verifyExecutionScope(async()=>{reads++;throw new KTeamError('kswarm_unavailable',503);},new AbortController().signal),/kswarm_unavailable/);
 assert.equal(reads,2);
});
test('retry cannot bypass scope changes, cancellation or an unknown mutation receipt',async()=>{
 let reads=0;
 await assert.rejects(verifyExecutionScope(async()=>{if(++reads===1)throw new KTeamError('broker_unavailable',503);throw new KTeamError('aimp_execution_not_current',403);},new AbortController().signal),/aimp_execution_not_current/);
 assert.equal(reads,2);
 for(const code of ['bot_private_scope_denied','model_binding_changed','harness_permissions_changed','upstream_operation_unknown']){
  reads=0;await assert.rejects(verifyExecutionScope(async()=>{reads++;throw new KTeamError(code,409);},new AbortController().signal),new RegExp(code));assert.equal(reads,1);
 }
 const controller=new AbortController();reads=0;
 const result=verifyExecutionScope(async()=>{reads++;throw new KTeamError('broker_unavailable',503);},controller.signal);controller.abort(new KTeamError('host_shutdown'));
 await assert.rejects(result);assert.equal(reads,1);
});
