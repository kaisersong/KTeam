/** Mention selections are identities, never permissions or a writable roster. */
export interface MentionMember {address:string;name:string}
export interface MentionToken extends MentionMember {start:number;end:number}
export function rebaseMentions(before:string,after:string,tokens:MentionToken[]):MentionToken[]{
 if(before===after)return tokens;
 let start=0;while(start<before.length&&start<after.length&&before[start]===after[start])start++;
 let end=before.length,nextEnd=after.length;while(end>start&&nextEnd>start&&before[end-1]===after[nextEnd-1]){end--;nextEnd--;}
 const delta=nextEnd-end;
 return tokens.flatMap(token=>token.end<=start?[token]:token.start>=end?[{...token,start:token.start+delta,end:token.end+delta}]:[]).filter(token=>after.slice(token.start,token.end)==='@'+token.name);
}
export function mentionQuery(text:string,cursor:number){
 const prefix=text.slice(0,cursor),match=/(?:^|[\s，。！？：:（(])@([^@\n]*)$/.exec(prefix);
 return match?{start:cursor-match[1]!.length-1,end:cursor,query:match[1]!}:undefined;
}
export function selectedMentions(text:string,tokens:MentionToken[],members:MentionMember[]):string[]{
 return [...new Set(tokens.filter(token=>text.slice(token.start,token.end)==='@'+token.name&&members.some(member=>member.address===token.address)).map(token=>token.address))];
}
/** Only persisted, validated human envelopes may direct a user-origin group reply. */
export function groupMentionTargets(message:any):string[]{
 const envelope=message?.sender?.kind==='user'&&message?.sourceRef?.kind==='aimp_l0'?message.sourceRef.envelope:undefined;
 return Array.isArray(envelope?.mentions)?envelope.mentions.filter((value:unknown):value is string=>typeof value==='string'):[];
}
export function mentionAgentAddress(id:string){return 'agent://kteam.local/'+encodeURIComponent(id);}
