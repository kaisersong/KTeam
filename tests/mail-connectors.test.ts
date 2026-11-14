import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {privateTempDir} from './helpers/private-temp.js';
import {MailConnectors} from '../src/service/mail-connectors.js';
import {MailOAuthFlow} from '../src/service/mail/mail-oauth-flow.js';

test('connected mail shares one account owner, encrypts secrets, fences revisions and refuses automatic resend',async()=>{
 const root=privateTempDir(join(tmpdir(),'kteam-connected-mail-')),previous=process.env.KTEAM_MODEL_CONFIG_DIR;process.env.KTEAM_MODEL_CONFIG_DIR=root;const first=new MailConnectors(),second=new MailConnectors();
 try{const service=await (first as any).get();assert.equal(service,await (second as any).get());const store=service.deps.store,id='a'.repeat(32),secret='FICTIONAL_MAIL_PASSWORD';store.put({id,provider:'qq',email:'fixture@example.invalid',host:'imap.qq.com',port:993,allowSend:false,revision:1,auth:{kind:'password',password:secret}},0,'user');const view=await second.view();assert.equal(view.accounts[0].id,id);assert(!JSON.stringify(view).includes(secret));const encrypted=readFileSync(join(root,'mail-accounts/accounts.enc'));assert.equal(encrypted.subarray(0,4).toString(),'KTM1');assert(!encrypted.includes(Buffer.from(secret)));
 await assert.rejects(first.control({action:'access',value:{id,expectedRevision:2,allowSend:true}}),/mail_stale_account/);await assert.rejects(first.control({action:'oauth',value:{provider:'gmail',clientId:'fixture',expectedRevision:0,allowSend:false},requestSource:'agent'}),/unknown_field/);
 const tools=await first.tools(),send=tools.find((t:any)=>t.definition.name==='send_connected_mail');assert(send);assert.equal(send.permission,'write');assert(tools.some((t:any)=>t.definition.name==='mail_search'));await assert.rejects(send.execute({accountId:id,requestId:'00000000-0000-4000-8000-000000000001',to:['other@example.invalid'],subject:'fixture',text:'fixture'}),/mail_send_denied/);
 await first.close();assert.equal((await second.view()).accounts.length,1);await second.control({action:'disconnect',value:{id,expectedRevision:1}});assert.equal((await second.view()).accounts.length,0);
 }finally{await first.close();await second.close();if(previous===undefined)delete process.env.KTEAM_MODEL_CONFIG_DIR;else process.env.KTEAM_MODEL_CONFIG_DIR=previous;rmSync(root,{recursive:true,force:true});}
});

test('real loopback OAuth callback requires state and PKCE, and cancellation closes the owned listener',async()=>{
 let target='',exchanges=0;const flow=new MailOAuthFlow({openExternal:async url=>{target=url;},authorize:async(_input,code,verifier,_redirect,_signal,assertCurrent)=>{assertCurrent();assert.equal(code,'fixture-code');assert(verifier.length>=43);exchanges++;}});
 try{const state=await flow.start({provider:'gmail',clientId:'fixture-client',expectedRevision:0,allowSend:false},'user');const url=new URL(target),redirect=url.searchParams.get('redirect_uri')!;assert.equal(url.origin,'https://accounts.google.com');assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert(!url.searchParams.get('scope')!.includes('gmail.send'));
 const wrong=await fetch(redirect+'?state=wrong&code=fixture-code');assert.notEqual(wrong.status,200);assert.equal(exchanges,0);const good=await fetch(redirect+'?state='+encodeURIComponent(url.searchParams.get('state')!)+'&code=fixture-code');assert.equal(good.status,200);assert.equal(exchanges,1);assert.equal(flow.getState().phase,'connected');assert(state.operationId);
 await flow.start({provider:'outlook',clientId:'fixture-client',expectedRevision:0,allowSend:false},'user');const cancelled=new URL(target).searchParams.get('redirect_uri')!;await flow.cancel(flow.getState().operationId,'user');assert.equal(flow.getState().phase,'cancelled');await assert.rejects(fetch(cancelled));
 }finally{flow.dispose();}
});
