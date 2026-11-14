import {processBirth,killGroup,processGroup} from '../dist/src/runtime/platform-process.js';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,symlinkSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
const root=mkdtempSync(join(tmpdir(),'kteam-codex-probe-'));mkdirSync(join(root,'workspace'),{mode:0o700});
const workspace=join(root,'workspace'),outside=join(root,'private.txt');
writeFileSync(outside,'KTEAM_OUTSIDE_SENTINEL',{mode:0o600});writeFileSync(join(workspace,'input.txt'),'KTEAM_INPUT');symlinkSync(outside,join(workspace,'escape.txt'));
const profile='kteam-probe';
const config=[
 `default_permissions="${profile}"`,
 'features.hooks=false','mcp_servers={}',
 'features.apps=false','features.plugins=false','features.remote_plugin=false','features.plugin_discovery_prefetch=false','features.shell_snapshot=false','features.image_generation=false','web_search="disabled"',
 'shell_environment_policy.inherit="none"','shell_environment_policy.set={PATH="/usr/bin:/bin:/usr/sbin:/sbin"}',
 `permissions.${profile}.filesystem={":minimal"="read",${JSON.stringify(workspace)}="write"}`,
 `permissions.${profile}.network.enabled=false`,
];
if(process.platform!=='darwin')throw Error('probe_platform_not_verified');
const codex=process.env.KTEAM_CODEX_BIN??execFileSync('/usr/bin/which',['codex'],{encoding:'utf8'}).trim();
const version=execFileSync(codex,['--version'],{encoding:'utf8'}).trim();
const child=spawn(codex,['app-server','--listen','stdio://',...config.flatMap(c=>['-c',c])],{cwd:workspace,stdio:['pipe','pipe','pipe'],detached:true});
const ownedBirth=processBirth(child.pid);if(!ownedBirth)throw Error("probe_owner_identity_missing");
const pending=new Map();let next=0,buffer='',stderr='';const events=[];
child.stderr.on('data',b=>{stderr=(stderr+b).slice(-8192);});
child.stdout.on('data',chunk=>{buffer+=chunk;for(;;){const n=buffer.indexOf('\n');if(n<0)break;const line=buffer.slice(0,n);buffer=buffer.slice(n+1);if(!line.trim())continue;try{const m=JSON.parse(line);if(m.id!==undefined&&!m.method){const p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}}else if(m.id!==undefined){child.stdin.write(JSON.stringify({id:m.id,error:{code:-32601,message:'disabled'}})+'\n');}else events.push(m);}catch(e){console.error(e.message);}}});
const request=(method,params)=>new Promise((resolve,reject)=>{const id=++next;const timer=setTimeout(()=>{pending.delete(id);reject(Error('timeout:'+method));},25000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,method,params})+'\n');});
const evidence={root,pid:child.pid,version,profile,checks:[]};
const server=createServer((q,r)=>r.end('NETWORK_SENTINEL'));await new Promise(r=>server.listen(0,'127.0.0.1',r));
evidence.networkPositiveControl=(await(await fetch(`http://127.0.0.1:${server.address().port}`)).text())==='NETWORK_SENTINEL';
try{
 evidence.initialized=await request('initialize',{clientInfo:{name:'kteam_probe',version:'0.1'},capabilities:{experimentalApi:true}});child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
 const effective=await request('config/read',{cwd:workspace,includeLayers:false});
 const settings=effective.config??{};
 evidence.effectiveConfig={topLevel:Object.keys(settings),mcpFieldPresent:Object.hasOwn(settings,'mcp_servers'),mcpNames:Object.keys(settings.mcp_servers??{}),features:settings.features,webSearch:settings.web_search};
 evidence.profiles=await request('permissionProfile/list',{cwd:workspace});
 for(const [name,command] of [
  ['workspace-read',['/bin/cat',join(workspace,'input.txt')]],
  ['workspace-write',['/bin/sh','-c','echo KTEAM_OUTPUT > output.txt; cat output.txt']],
  ['outside-read',['/bin/cat',outside]],
  ['symlink-escape',['/bin/cat',join(workspace,'escape.txt')]],
  ['exit-code',['/bin/sh','-c','echo EXPECTED_FAILURE >&2; exit 17']],
  ['network',['/usr/bin/curl','--max-time','3','--silent','--show-error',`http://127.0.0.1:${server.address().port}`]],
 ]){
  try{const result=await request('command/exec',{command,cwd:workspace,permissionProfile:profile,timeoutMs:5000,outputBytesCap:2048});evidence.checks.push({name,...result});}catch(e){evidence.checks.push({name,error:e.message});}
 }
}catch(e){evidence.error=e.message;evidence.stderr=stderr;}
finally{
 server.close();try{killGroup(child.pid,'SIGTERM',undefined,{birth:ownedBirth});}catch{}
 await Promise.race([new Promise(r=>child.once('close',r)),new Promise(r=>setTimeout(r,1500))]);if(processGroup(child.pid,undefined,{birth:ownedBirth}).length)killGroup(child.pid,'SIGKILL',undefined,{birth:ownedBirth});
 for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('closed'));}
 writeFileSync('.artifacts/codex-permissions-probe.json',JSON.stringify(evidence,null,2),{mode:0o600});
 console.log(JSON.stringify(evidence,null,2));
}
