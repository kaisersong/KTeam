const activeStates = new Set(['routing', 'running', 'waiting', 'stopping']);

type Work = {id:string;roomId:string;state:string;activeBotId?:string;toolTrace?:{name?:string;state?:string}[]};
type Attention = {id:string;roomId:string;jobId?:string;workJobId?:string;rootJobId?:string};

export function conversationWork<T extends Work>(roomId:string,jobs:T[],attention:Attention[]) {
 const byJob = new Map(attention.flatMap(item => [item.jobId,item.workJobId,item.rootJobId]
  .filter((id):id is string=>!!id).map(id=>[id,item] as const)));
 return jobs.filter(job=>job.roomId===roomId&&activeStates.has(job.state))
  .map(job=>({job,attention:byJob.get(job.id),progress:[...(job.toolTrace??[])].reverse().find(event=>event.name&&event.state!=='failed')?.name}))
  .sort((a,b)=>Number(!!b.attention)-Number(!!a.attention));
}

export const activeWorkLabels:Record<string,string>={routing:'正在安排',running:'正在运行',waiting:'等待结果',stopping:'正在停止'};

export function stageStatus(stage:{witness?:string;review?:{decision:string};requests:{state:string;evidence?:unknown}[]}) {
 if(stage.review?.decision==='pass')return '已通过';
 if(stage.review?.decision==='rework')return '需返工';
 if(stage.witness)return '待验收';
 if(stage.requests.some(item=>item.state==='unknown'))return '结果待核对';
 if(stage.requests.some(item=>item.evidence))return '部分已提交';
 if(stage.requests.some(item=>['blocked','cancelled','stopped'].includes(item.state)))return '交付受阻';
 return '等待交付';
}
