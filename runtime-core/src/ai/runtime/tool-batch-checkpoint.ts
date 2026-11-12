import type {MessageBlock,ToolCall} from '../../types.js';
export interface ToolBatchCheckpoint {
 version:1;id:string;ownerId:string;calls:ToolCall[];results:MessageBlock[];
 state:'preparing'|'waiting_approval'|'executing';approvalId?:string;providerInvocationId?:string;
}
/** Private original SessionStore data; never a permission grant or model input field. */
export function validateToolBatchCheckpoint(value:unknown):ToolBatchCheckpoint {
 const fail=():never=>{throw Error('tool_batch_checkpoint_invalid');};
 if(!value||typeof value!=='object'||Array.isArray(value))return fail();
 const item=value as ToolBatchCheckpoint;
 if(Object.keys(item).some(key=>!['version','id','ownerId','calls','results','state','approvalId','providerInvocationId'].includes(key))||item.version!==1||!/^batch_[a-f0-9]{32}$/.test(item.id)||typeof item.ownerId!=='string'||!item.ownerId||item.ownerId.length>256||!['preparing','waiting_approval','executing'].includes(item.state)||!Array.isArray(item.calls)||!item.calls.length||item.calls.length>32||!Array.isArray(item.results)||Buffer.byteLength(JSON.stringify(item))>8*1024*1024)return fail();
 if(item.providerInvocationId!==undefined&&(typeof item.providerInvocationId!=='string'||item.providerInvocationId.length>512))return fail();
 if(item.approvalId!==undefined&&(typeof item.approvalId!=='string'||!item.approvalId.startsWith('tool-approval:')||item.approvalId.length>256)||item.state==='waiting_approval'&&!item.approvalId)return fail();
 const ids=new Set<string>();for(const call of item.calls){if(!call||call.type!=='tool_use'||typeof call.id!=='string'||!call.id||call.id.length>256||ids.has(call.id)||typeof call.name!=='string'||!call.name||!call.input||typeof call.input!=='object'||Array.isArray(call.input))return fail();ids.add(call.id);}
 let complete=0;for(const result of item.results){if(result.type==='tool_result'){if(result.tool_use_id!==item.calls[complete]?.id||typeof result.content!=='string')return fail();complete++;}else if(result.type!=='image'||complete===0)return fail();}
 if(complete>item.calls.length||item.state==='waiting_approval'&&complete===item.calls.length)return fail();
 return structuredClone(item);
}
export function toolBatchCompletedCount(batch:ToolBatchCheckpoint){return batch.results.filter(result=>result.type==='tool_result').length;}
const pauses=new WeakSet<object>();
/** Host stop signal only: the brand cannot approve or execute a tool. */
export function toolApprovalPause(approvalId:string){if(!approvalId.startsWith('tool-approval:')||approvalId.length>256)throw Error('tool_approval_pause_invalid');const error=Object.assign(Error('tool_approval_waiting'),{approvalId});pauses.add(error);return error;}
export function isToolApprovalPause(error:unknown):error is Error&{approvalId:string}{return !!error&&typeof error==='object'&&pauses.has(error);}

export interface ToolApprovalPort {
 ownerId:string;
 prepare(value:{batchId:string;index:number;name:string;input:Record<string,unknown>;decision:string;permission:unknown}):Promise<boolean|undefined>;
 finished?(value:{batchId:string;index:number}):Promise<void>;
}
