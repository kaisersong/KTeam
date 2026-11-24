import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {test} from 'node:test';
import {Upstreams} from '../src/adapters/upstream.js';

test('upstream refusals preserve nested codes and avoid logging private response and request data',async t=>{
 let status=403,payload:Record<string,unknown>={error:{code:'room_actor_forbidden',message:'private response'}},calls=0;
 const server=createServer((_request,response)=>{
  calls++;
  response.writeHead(status,{'content-type':'application/json'});
  response.end(JSON.stringify(payload));
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const address=server.address();
 assert.ok(address&&typeof address!=='string');
 const warning=t.mock.method(console,'warn',()=>{});
 const url='http://127.0.0.1:'+address.port;
 const upstream=new Upstreams({brokerUrl:url,kswarmUrl:url,brokerToken:'private credential',kswarmToken:'private mutation credential'});
 try{
  await assert.rejects(upstream.conversationMessage('private-room','private-message'),{message:'room_actor_forbidden'});
  assert.equal(warning.mock.calls.length,0);
  payload={error:{message:'private response'}};
  await assert.rejects(upstream.conversationMessage('private-room','private-message'),{message:'upstream_rejected'});
  await assert.rejects(upstream.conversationMessage('private-room','private-message'),{message:'upstream_rejected'});
  assert.equal(warning.mock.calls.length,1);
  assert.match(String(warning.mock.calls[0]?.arguments[0]),/broker.*GET.*403/);
  assert.doesNotMatch(JSON.stringify(warning.mock.calls.map(call=>call.arguments)),/private/);
  status=500;
  await assert.rejects(upstream.createBot({description:'private prompt'}),{message:'upstream_operation_unknown'});
  assert.equal(calls,4);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
