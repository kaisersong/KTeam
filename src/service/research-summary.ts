import {createHash} from 'node:crypto';
import {KTeamError} from '../errors.js';
import {researchHasEvidence} from './group-conversation.js';
const observations=new Set(['read','glob','grep','web_fetch','web_search']);
const safeActivities=new Set([...observations,'tool_search']);
function eligible(store:any,prior:any){
 if(typeof prior?.groupResponse?.botId!=='string')return false;
 const binding=store.binding(prior?.groupResponse?.botId),frozen=prior?.executionScope?.binding;
 return prior?.state==='blocked'&&prior.reason==='iteration_budget_exhausted'&&prior.failure?.evidence==='captured'&&!prior.stopResultUnknown&&prior.groupResponse?.mode==='research'&&prior.activeBotId===prior.groupResponse.botId&&!prior.groupResponse.researchSummaryOf&&binding?.kind==='xiaok-hosted'&&frozen?.revision===binding.revision&&frozen?.fingerprint===binding.fingerprint&&frozen?.modelId===binding.modelId&&researchHasEvidence(prior)&&!(prior.toolTrace??[]).some((event:any)=>(!event.type||event.type.startsWith('tool_'))&&!safeActivities.has(event.name));
}
/** A new tool-free answer refers to preserved observation receipts; it never replays tools. */
export function researchSummarySource(store:any,job:any,profileRevision?:number){
 const id=job.groupResponse?.researchSummaryOf;if(!id)return;
 const prior=store.job(id);
 if(job.groupResponse.mode!=='discussion'||!eligible(store,prior)||prior.roomId!==job.roomId||prior.originId!==job.originId||prior.groupResponse.botId!==job.groupResponse.botId||prior.groupResponse.sourceJobId!==job.groupResponse.sourceJobId||profileRevision!==undefined&&prior.executionScope.profileRevision!==profileRevision)throw new KTeamError('research_summary_scope_changed',409);
 return {sourceJobId:id,evidence:(prior.toolTrace??[]).filter((event:any)=>observations.has(event.name)&&event.state==='completed'&&!event.code&&typeof event.result==='string'&&event.result.length>0&&!/^\s*(?:Error(?:\s*\(|:)|Exit code:\s*[1-9])/i.test(event.result)).slice(-16).map((event:any)=>({tool:event.name,input:String(event.input??'').slice(0,2048),resultPreview:event.result.slice(0,2000),previewOnly:true,at:event.finishedAt??event.startedAt}))};
}
export function reviewExhaustedResearch(store:any,now=Date.now()){
 const jobs=store.jobs(),latest=new Map<string,any>();for(const job of jobs)if(!job.trigger&&!latest.has(job.roomId))latest.set(job.roomId,job);
 for(const prior of jobs){
  const team=store.settings(prior.roomId);if(team?.kind!=='group'||team.mode!=='auto'||team.paused||team.quiet||latest.get(prior.roomId)?.originId!==prior.originId||!eligible(store,prior))continue;
  const botId=prior.groupResponse.botId,latestMember=jobs.find((job:any)=>job.roomId===prior.roomId&&job.originId===prior.originId&&job.groupResponse?.botId===botId);if(latestMember?.id!==prior.id)continue;
  const source=store.job(prior.groupResponse.sourceJobId),at=Date.parse(prior.createdAt);if(source?.groupPlan?.mode!=='research'||!source.groupPlan.members?.includes(botId)||source.roomId!==prior.roomId||source.originId!==prior.originId||['blocked','unknown','stopping','stopped'].includes(source.state)||!Number.isFinite(at)||now-at<0||now-at>86400000)continue;
  const id='job-research-summary:'+createHash('sha256').update(prior.id).digest('hex');if(store.job(id))continue;
  store.enqueueFollowup({id,roomId:prior.roomId,originId:prior.originId,trigger:'group-response',groupResponse:{sourceJobId:source.id,botId,mode:'discussion',plannedStages:[],researchSummaryOf:prior.id}});
 }
}
