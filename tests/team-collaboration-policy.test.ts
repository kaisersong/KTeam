import {test} from 'node:test';
import assert from 'node:assert/strict';
import {collaborationTurn,teamCollaborationPolicy} from '../src/service/team-collaboration-policy.js';
test('ready coordinators receive staged delivery guidance without replacing ordinary user requests',()=>{
 const policy=teamCollaborationPolicy({kind:'group',botId:'chief',roles:{status:'ready',coordinatorBotId:'chief',duties:{chief:'技术统筹'}},canDelegate:true,recovering:true});
 for(const text of ['PM/产品经理','开发成员','质量成员','独立验证','复验','delegate_work','普通问答','用户明确指定','不重复派发','不能代写'])assert(policy.includes(text),text);
 assert(policy.indexOf('PM/产品经理')<policy.indexOf('开发成员'));assert(policy.indexOf('开发成员')<policy.indexOf('质量成员'));
});
test('missing collaboration remains an explicit blocker rather than permission for a coordinator to impersonate the team',()=>{
 const policy=teamCollaborationPolicy({kind:'group',botId:'chief',roles:{status:'ready',coordinatorBotId:'chief'},canDelegate:false,recovering:false});assert.match(policy,/不要因为工具不可用就接管其他角色/);
 assert.equal(teamCollaborationPolicy({kind:'direct',botId:'chief',roles:{status:'ready',coordinatorBotId:'chief'},canDelegate:true,recovering:false}),'');
 assert.equal(teamCollaborationPolicy({kind:'group',botId:'chief',roles:{status:'needs_choice'},canDelegate:true,recovering:false}),'');
});
test('recovery retains semantic collaboration while regeneration and notice turns cannot create new work',()=>{
 assert(collaborationTurn('recovery'));assert(collaborationTurn());assert(collaborationTurn('peer'));for(const trigger of ['regenerate','followup','assistant-notice'])assert.equal(collaborationTurn(trigger),false);
});

test('member receipt projection survives same-request recovery and excludes private answers, pending handoffs and foreign scope',async()=>{
 const {mkdtempSync,rmSync}=await import('node:fs'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{TeamStore}=await import('../src/service/team-store.js'),{teamCollaborationReceipts}=await import('../src/service/team-collaboration-policy.js');
 const root=mkdtempSync(join(tmpdir(),'kteam-team-receipts-')),store=new TeamStore(root);
 try{store.enqueue('old','room','origin');store.enqueue('new','room','origin');const job=store.job('new');job.recoveryOf='old';store.save(job);
  const op={id:'work-handoff:pm',jobId:'old',roomId:'room',botId:'chief',status:'returned',requests:[{botId:'pm'}],doneWhen:'范围与标准已分解',results:[{botId:'pm',state:'delivered',roomId:'peer',messageId:'reply',text:'实际需求分解'}]};store.saveOperation(op,0);
  for(const [id,change]of Object.entries({question:{questionId:'private',results:[{answer:'PRIVATE_ANSWER'}]},approval:{approvalId:'approval'},pending:{status:'parked'},foreign:{roomId:'other'},otherBot:{botId:'another'},condition:{condition:{kind:'work_result'}}}))store.saveOperation({...op,id:'work-handoff:'+id,...change},0);
  const result=teamCollaborationReceipts(store,job,'chief');assert.equal(result.length,1);assert.equal(result[0]!.results[0].text,'实际需求分解');assert(!JSON.stringify(result).includes('PRIVATE_ANSWER'));
  const prior=store.job('old');prior.originId='different-origin';store.save(prior);assert.equal(teamCollaborationReceipts(store,job,'chief').length,0);
 }finally{store.close();rmSync(root,{recursive:true,force:true});}
});
