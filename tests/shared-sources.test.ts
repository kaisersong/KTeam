import {test} from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSharedSources} from '../src/adapters/upstream.js';
import {KTeamError} from '../src/errors.js';
test('source normalization bounds owner metadata, sorts actual sequence and propagates connection failures',async()=>{
 const read=async(id:string)=>({message:{messageId:id,roomSequence:Number(id.slice(1))}});
 const result=await normalizeSharedSources(Array.from({length:30},(_,n)=>'m'+(30-n)),read);assert.equal(result.ids.length,20);assert.deepEqual(result.ids.slice(0,2),['m1','m2']);assert.deepEqual(result.warnings,['source_ids_limit']);
 assert.deepEqual((await normalizeSharedSources('bad',read)).ids,[]);
 await assert.rejects(normalizeSharedSources(['m1'],async()=>{throw new KTeamError('upstream_unavailable',503);}),/upstream_unavailable/);
});
