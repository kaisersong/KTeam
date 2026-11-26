import {createHash} from 'node:crypto';
import type {AssistantDailyCard} from '../protocol/assistant-daily-card.js';
import type {TeamStore} from './team-store.js';
import {upgradeInvitationCard} from './assistant-invitation-card.js';

const key=(messageId:string)=>'assistant-daily-card:'+messageId;
const bodyHash=(body:string)=>createHash('sha256').update(body).digest('hex');
type Receipt={roomId:string;botId:string;taskRef:string;bodyHash:string;card:AssistantDailyCard};

export function rememberAssistantDailyCard(store:TeamStore,messageId:string,roomId:string,botId:string,taskRef:string,body:string,card:AssistantDailyCard){
 const receipt:Receipt={roomId,botId,taskRef,bodyHash:bodyHash(body),card};
 store.stateOnce(key(messageId),receipt);
}

export function assistantDailyCardForMessage(store:TeamStore,message:any):AssistantDailyCard|undefined{
 if(message.sender?.kind!=='agent'||message.sourceRef?.kind!=='aimp_reply'||typeof message.text!=='string'||typeof message.messageId!=='string')return;
 const receipt=store.state<Receipt>(key(message.messageId));
 if(receipt&&receipt.roomId===message.roomId&&receipt.botId===message.sender.logicalAgentId
  &&receipt.taskRef===message.sourceRef.taskRef&&receipt.bodyHash===bodyHash(message.text)){
  return upgradeInvitationCard(receipt.card,Date.parse(message.createdAt))??receipt.card;
 }
}
