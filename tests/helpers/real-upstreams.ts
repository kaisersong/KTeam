import {tmpRoot} from './tmp-root.js';
import {fork,type ChildProcess} from 'node:child_process';
import {mkdtempSync,realpathSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomBytes} from 'node:crypto';
import {Upstreams} from '../../src/adapters/upstream.js';
export async function realUpstreams(options:{agentClis?:string[]}={}){
 const project=fileURLToPath(new URL('../../../',import.meta.url));const root=realpathSync(mkdtempSync(tmpRoot+'/kteam-coordination-'));
 const home=join(root,'home');mkdirSync(home,{mode:0o700});
 // Isolated stub CLIs so KSwarm runtime detection never depends on what the developer machine or CI runner has installed.
 const cliEnv:Record<string,string>={};if(options.agentClis?.length){const bin=join(root,'agent-cli-bin');mkdirSync(bin,{mode:0o700});for(const name of options.agentClis){const file=join(bin,name);writeFileSync(file,'#!/bin/sh\necho '+name+'-fixture 1.0\n',{mode:0o700});cliEnv['KSWARM_'+name.toUpperCase()+'_PATH']=file;}}const token=randomBytes(32).toString('hex'),mutation=randomBytes(32).toString('hex');
 const {createBrokerService}=await import('intent-broker/src/broker/service.js' as string);const {createServer}=await import('intent-broker/src/http/server.js' as string);
 const broker=createBrokerService({dbPath:join(root,'broker.sqlite'),aimpEnabled:true});const server=createServer({broker,roomService:broker.room,roomDesktopToken:token});await server.listen(0,'127.0.0.1');broker.attachWebSocket(server.raw());const brokerUrl='http://127.0.0.1:'+server.address().port;
 const child=fork(join(project,'node_modules/kswarm/src/server/index.js'),[],{cwd:root,silent:true,execArgv:['--preserve-symlinks','--preserve-symlinks-main','--import',pathToFileURL(join(project,'tests/loopback-test-host.mjs')).href],env:{...process.env,HOME:home,USERPROFILE:home,KSWARM_PORT:'0',KSWARM_DATA_ROOT:join(home,'.kswarm'),BROKER_URL:brokerUrl,KSWARM_DESKTOP_MUTATION_TOKEN:mutation,KSWARM_RUNTIME_TOKEN:'',INTENT_BROKER_KSWARM_TOKEN:'',ENABLE_HUMAN_ESCALATION:'0',...cliEnv}});
 child.stdout!.resume();child.stderr!.resume();
 let port:number;try{port=await new Promise<number>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('upstream_timeout')),10000);child.once('message',(m:any)=>{clearTimeout(timer);resolve(m.address.port);});child.once('exit',()=>{clearTimeout(timer);reject(Error('upstream_exit'));});});}
 // A failed start must not leave the broker listening: the test process would never exit.
 catch(error){child.kill('SIGKILL');broker.close();await server.close();rmSync(root,{recursive:true,force:true});throw error;}
 const upstream=new Upstreams({brokerUrl,kswarmUrl:'http://127.0.0.1:'+port,brokerToken:token,kswarmToken:mutation});
 return {root,upstream:upstream as any,broker,async close(){await new Promise<void>(resolve=>{if(child.exitCode!==null||child.signalCode!==null){resolve();return;}const timer=setTimeout(()=>child.kill('SIGKILL'),3000);child.once('exit',()=>{clearTimeout(timer);resolve();});child.kill('SIGTERM');});broker.close();await server.close();rmSync(root,{recursive:true,force:true});}};
}
