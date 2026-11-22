const marker = /^> 原消息 \[([a-zA-Z0-9_-]{1,256})\/([a-zA-Z0-9_-]{1,256})\]$/gm;

export type MessageAnchor = {roomId:string;messageId:string};
export type MessageReference = MessageAnchor & {text:string;quote:string};

export function messageAnchors(value:string): MessageAnchor[] {
 return [...value.matchAll(marker)].map(match=>({roomId:match[1]!,messageId:match[2]!}));
}

export function messageReference(anchor:MessageAnchor,value:string):MessageReference {
 const content=value.trim();
 const text=content.length>1000?content.slice(0,1000)+'…':content;
 const quote='> 原消息 ['+anchor.roomId+'/'+anchor.messageId+']\n'+text.split(/\r?\n/).map(line=>'> '+line).join('\n');
 return {...anchor,text,quote};
}
