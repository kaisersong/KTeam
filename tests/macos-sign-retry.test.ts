import {test} from 'node:test';import assert from 'node:assert/strict';
const {withSigningTimestampRetry}=await import(new URL('../../scripts/package-signed-mac.mjs',import.meta.url).href);
test('signing retries a transient Apple timestamp failure but never retries a certificate error',async()=>{
 let calls=0;const waits:number[]=[],result=await withSigningTimestampRetry(async()=>++calls===1?{status:1,output:'A timestamp was expected but was not found.'}:{status:0,output:'signed'},{wait:async(ms:number)=>{waits.push(ms);}});assert.equal(result.status,0);assert.equal(calls,2);assert.deepEqual(waits,[15000]);
 calls=0;const denied=await withSigningTimestampRetry(async()=>{calls++;return {status:1,output:'certificate is not trusted'};},{wait:async()=>{assert.fail('must not retry certificate errors');}});assert.equal(denied.status,1);assert.equal(calls,1);
});
test('persistent timestamp failures remain failed after three attempts and cancellation never starts another signer',async()=>{
 let calls=0;const waits:number[]=[],result=await withSigningTimestampRetry(async()=>{calls++;return {status:1,output:'timestamp service is not available'};},{wait:async(ms:number)=>{waits.push(ms);}});assert.equal(result.status,1);assert.equal(calls,3);assert.deepEqual(waits,[15000,30000]);
 calls=0;const cancelled=await withSigningTimestampRetry(async()=>{calls++;return {status:null,signal:'SIGTERM',output:'A timestamp was expected but was not found'};},{wait:async()=>{assert.fail('cancelled signer must not restart');}});assert.equal(cancelled.status,1);assert.equal(calls,1);
});
