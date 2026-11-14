import {writeFileSync,readFileSync} from 'node:fs';
const log=process.argv[2];let buffer='',requests=[];
const emit=message=>process.stdout.write(JSON.stringify(message)+'\n');
process.stdin.on('data',data=>{buffer+=data;for(;;){const end=buffer.indexOf('\n');if(end<0)break;const line=buffer.slice(0,end);buffer=buffer.slice(end+1);if(!line)continue;const m=JSON.parse(line);requests.push(m);writeFileSync(log,JSON.stringify({requests,leaked:!!process.env.KTEAM_FAKE_SECRET_SENTINEL}));
 if(m.method==='initialize')emit({id:m.id,result:{userAgent:'fixture'}});
 if(m.method==='thread/start')emit({id:m.id,result:{thread:{id:'thread-test'},activePermissionProfile:{id:m.params.permissions}}});
 if(m.method==='turn/start'){emit({id:m.id,result:{turn:{id:'turn-test'}}});emit({method:'turn/started',params:{threadId:'thread-test',turn:{id:'turn-test'}}});emit({id:999,method:'item/permissions/requestApproval',params:{threadId:'thread-test',turnId:'turn-test'}});setTimeout(()=>emit({method:'turn/completed',params:{threadId:'thread-test',turn:{id:'turn-test',status:'completed'}}}),15);}
 if(m.method==='command/exec')emit({id:m.id,result:{exitCode:0,stdout:'probe',stderr:''}});
 if(m.method==='command/exec/terminate')emit({id:m.id,result:{}});
}});
