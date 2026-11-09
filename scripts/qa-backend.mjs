import {createBrokerService} from 'intent-broker/src/broker/service.js';
import {createServer} from 'intent-broker/src/http/server.js';
import {startHost} from '../dist/src/service/server.js';
import {initConfig} from '../dist/src/service/config.js';
import {hostRequest} from '../dist/src/service/client.js';
import {createDesktopAPI} from '../dist/desktop/semantic-api.js';
import {mkdtempSync,realpathSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fork} from 'node:child_process';
import {randomBytes} from 'node:crypto';
const project=process.cwd();
mkdirSync(join(project,'.artifacts'),{recursive:true});
const root=realpathSync(mkdtempSync('/tmp/kteam-qa-'));
const home=join(root,'home');mkdirSync(home,{mode:0o700});
const token=randomBytes(32).toString('hex'),mutation=randomBytes(32).toString('hex');
const broker=createBrokerService({dbPath:join(root,'broker.sqlite'),aimpEnabled:true});
const server=createServer({broker,roomService:broker.room,roomDesktopToken:token});
await server.listen(0,'127.0.0.1');broker.attachWebSocket(server.raw());
const brokerUrl='http://127.0.0.1:'+server.address().port;
const child=fork(join(project,'node_modules/kswarm/src/server/index.js'),[],{cwd:root,silent:true,
 execArgv:['--preserve-symlinks','--preserve-symlinks-main','--import',join(project,'tests/loopback-test-host.mjs')],
 env:{...process.env,HOME:home,USERPROFILE:home,KSWARM_PORT:'0',KSWARM_DATA_ROOT:join(home,'.kswarm'),BROKER_URL:brokerUrl,KSWARM_DESKTOP_MUTATION_TOKEN:mutation,KSWARM_RUNTIME_TOKEN:'',INTENT_BROKER_KSWARM_TOKEN:'',ENABLE_HUMAN_ESCALATION:'0'}});
let logs='';child.stdout.on('data',data=>logs+=data);child.stderr.on('data',data=>logs+=data);
const port=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('qa_upstream_timeout')),10000);child.on('message',message=>{if(message.type==='test-listening'){clearTimeout(timer);resolve(message.address.port);}});child.once('exit',()=>reject(Error('qa_upstream_exit')));});
const kswarmUrl='http://127.0.0.1:'+port;
const state=join(root,'state');
writeFileSync(join(root,'broker.token'),token,{mode:0o600});writeFileSync(join(root,'kswarm.token'),mutation,{mode:0o600});
initConfig(state,{version:1,brokerUrl,kswarmUrl,brokerTokenFile:join(root,'broker.token'),kswarmTokenFile:join(root,'kswarm.token')});
const host=await startHost({root:state,upstream:{brokerUrl,kswarmUrl,brokerToken:token,kswarmToken:mutation}});
const api=createDesktopAPI((route,input)=>hostRequest(state,'kteam-main',route,input));
const catalog=await api.models();const ids=[];
for(const name of ['CEO','CTO','运营']){const result=await api.createBot({name,modelId:catalog.defaultModelId,requestId:'qa-'+name});ids.push(result.bot.id);}
const created=await api.createTeam({title:'经营复盘',goal:'准备本周经营复盘，形成下一步行动。当前没有连接真实业务数据，需明确资料缺口并给出可推进的草案。',memberAgentIds:ids,requestId:'qa-team'});
const manifest={root,state,roomId:created.room.roomId,pids:{backend:process.pid,kswarm:child.pid},brokerUrl,kswarmUrl};
writeFileSync(join(project,'.artifacts/qa-backend.json'),JSON.stringify(manifest,null,2));
console.log(JSON.stringify({event:'qa-ready',...manifest}));
let closing=false;
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,async()=>{
 if(closing)return;closing=true;await host.close();
 const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await exited;
 broker.close();await server.close();writeFileSync(join(root,'kswarm.log'),logs);process.exit(0);
});
