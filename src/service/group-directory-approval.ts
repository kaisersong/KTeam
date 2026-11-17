import type {Upstreams} from '../adapters/upstream.js';
import type {TeamStore} from './team-store.js';
import type {DirectoryGroup} from './tool-approvals.js';
import {profile} from './bot-profile.js';
import {createHash} from 'node:crypto';
import {KTeamError} from '../errors.js';
/** Resolve the user-visible source from owned work, never from model arguments. */
export async function groupDirectoryApproval(upstream:Upstreams,store:TeamStore,scope:any):Promise<DirectoryGroup|undefined>{
 const job=store.job(scope.jobId);if(!job||job.roomId!==scope.roomId)return undefined;
 const root=job.peer?.rootJobId?store.job(job.peer.rootJobId):undefined;
 const roomId=root?.roomId??job.peer?.sourceRoomId??job.roomId;
 const settings=store.settings(roomId);if(settings?.kind!=='group')return undefined;
 if(settings.paused||store.state('deleted-conversation:'+roomId))throw new KTeamError('team_scope_changed',409);
 const membership=await upstream.membership(roomId),room=membership.room as any,active=(membership.members as any[]).filter(m=>m.status==='active');
 if(room?.roomId!==roomId||room?.status!=='active'||!active.some(m=>m.role==='owner'&&m.subject?.kind==='user'&&m.subject.userId==='user.local'))throw new KTeamError('conversation_identity_changed',409);
 const ids=active.filter(m=>m.subject?.kind==='agent').map(m=>m.subject.logicalAgentId).sort();
 if(!ids.includes(scope.botId))throw new KTeamError('conversation_identity_changed',409);
 const bots=(await upstream.listBots()).agents as any[];
 const members=ids.map(botId=>{const bot=bots.find(b=>b.id===botId&&!b.archivedAt),binding=store.binding(botId),external=store.state('external-bot:'+botId);if(!bot||(!binding&&!external))throw new KTeamError('member_identity_changed',409);return {botId,name:bot.name,bindingRevision:binding?.revision,profileRevision:profile(bot).revision,sourceFingerprint:createHash('sha256').update(JSON.stringify(binding??external)).digest('hex')};});
 if(store.settings(roomId)?.revision!==settings.revision)throw new KTeamError('team_scope_changed',409);
 return {roomId,revision:Number(room.revision),settingsRevision:settings.revision,members};
}
