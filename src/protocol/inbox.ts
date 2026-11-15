export interface InboxReceipt {kind:string;id:string;version:string;revision:number;read:boolean;deleted:boolean}
export type InboxAction='read'|'unread'|'delete';
export interface InboxChange {action:InboxAction;collection?:'needs'|'attention';items:InboxReceipt[]}
