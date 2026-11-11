import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,realpathSync,rmSync,writeFileSync,readFileSync,readdirSync,existsSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {initStandalone,readServicePlan} from '../src/runtime/managed-services.js';
import {initConfig,loadConfig,upstreamOptions} from '../src/service/config.js';
import {legacySharedNoticeView} from '../src/service/legacy-notice.js';
import {readServiceEndpoints} from '../src/service/service-endpoints.js';

const temp=()=>realpathSync(mkdtempSync(join(tmpdir(),'kteam-upgrade-')));
const write=(file:string,value:unknown)=>writeFileSync(file,typeof value==='string'?value:JSON.stringify(value),{mode:0o600});
const LEGACY_KEY='xiaokActivityConfig';
const token=(c:string)=>c.repeat(43);

/** The exact shape a 0.2 install left on disk (values are fake): services shared on fixed ports, a plan whose
 * working directories live in another app's data dir, connection tokens in services/shared-connection.json,
 * and no KTeam-owned broker/kswarm credential files. */
function legacyInstall(withLegacyKey:boolean){
 const box=temp(),root=join(box,'kteam'),other=join(box,'other-app','services','intent-broker'),otherKswarm=join(box,'other-app','services','kswarm');
 for(const dir of [root,join(root,'services')])mkdirSync(dir,{mode:0o700});
 mkdirSync(other,{recursive:true});mkdirSync(otherKswarm,{recursive:true});write(join(other,'marker'),'other app data');
 const plan={version:1,broker:{cwd:other,env:{PORT:'4318',INTENT_BROKER_DESKTOP_TOKEN:token('b')}},kswarm:{cwd:otherKswarm,env:{KSWARM_PORT:'4400',KSWARM_DESKTOP_MUTATION_TOKEN:token('k')}}};
 const config:Record<string,unknown>={version:1,brokerUrl:'http://127.0.0.1:4318',kswarmUrl:'http://127.0.0.1:4400',managedServiceConfig:join(root,'services','config.json')};
 if(withLegacyKey)config[LEGACY_KEY]=join(box,'never-read.json');
 write(join(root,'config.json'),config);write(join(root,'services','config.json'),plan);
 write(join(root,'services','shared-connection.json'),{kswarm:{url:'http://127.0.0.1:4400',mutationToken:token('m'),brokerUrl:'http://127.0.0.1:4318',roomToken:token('r')}});
 write(join(root,'service-endpoints.json'),{broker:4318,kswarm:4400});write(join(root,'kteam-main.token'),token('c'));
 return {box,root,other};
}

for(const withLegacyKey of [true,false])test(`a 0.2 shared-service install ${withLegacyKey?'with':'without'} the legacy key is archived and replaced by KTeam-owned services`,async()=>{
 const {box,root,other}=legacyInstall(withLegacyKey);
 try{
  const before=Object.fromEntries(['config.json','services/config.json','services/shared-connection.json','service-endpoints.json'].map(f=>[f,readFileSync(join(root,f),'utf8')]));
  const client=readFileSync(join(root,'kteam-main.token'),'utf8');
  await initStandalone(root);
  // New config: KTeam's own credential files and plan, inside KTeam's data dir, on fresh ports.
  const config=loadConfig(root),options=upstreamOptions(config);
  assert.equal(config.brokerTokenFile,join(root,'services','broker.token'));assert.equal(config.kswarmTokenFile,join(root,'services','kswarm.token'));
  assert.equal(config.managedServiceConfig,join(root,'services','config.json'));
  assert.ok((options.brokerToken??'').length>=32&&(options.kswarmToken??'').length>=32,'broker and kswarm credentials exist, so requests no longer fail with *_credential_required');
  assert.notEqual(options.brokerToken,token('b'));assert.notEqual(options.kswarmToken,token('k'));
  assert.notEqual(config.brokerUrl,'http://127.0.0.1:4318');assert.notEqual(config.kswarmUrl,'http://127.0.0.1:4400');
  const plan=readServicePlan(config.managedServiceConfig!);
  for(const cwd of [plan.broker.cwd,plan.kswarm.cwd])assert.ok(cwd.startsWith(join(root,'services')+'/'),cwd);
  assert.deepEqual(readServiceEndpoints(root),{broker:Number(new URL(config.brokerUrl).port),kswarm:Number(new URL(config.kswarmUrl).port)});
  assert.equal(existsSync(join(root,'services','shared-connection.json')),false);
  // The old files are kept byte-for-byte in backups/, private.
  const archives=readdirSync(join(root,'backups')).filter(name=>name.startsWith('legacy-0.2-shared-'));assert.equal(archives.length,1);
  const archive=join(root,'backups',archives[0]!);
  assert.equal(readFileSync(join(archive,'config.json'),'utf8'),before['config.json']);
  assert.equal(readFileSync(join(archive,'services-config.json'),'utf8'),before['services/config.json']);
  assert.equal(readFileSync(join(archive,'services-shared-connection.json'),'utf8'),before['services/shared-connection.json']);
  assert.equal(readFileSync(join(archive,'service-endpoints.json'),'utf8'),before['service-endpoints.json']);
  if(process.platform!=='win32')assert.equal(statSync(archive).mode&0o777,0o700);
  // Nothing outside KTeam's data dir is touched; the client credential is kept; the one-time notice is pending.
  assert.equal(readFileSync(join(other,'marker'),'utf8'),'other app data');assert.deepEqual(readdirSync(other),['marker']);
  assert.equal(readFileSync(join(root,'kteam-main.token'),'utf8'),client);
  assert.equal(legacySharedNoticeView(root).show,true);
  // A second start keeps the new setup as is.
  await initStandalone(root);assert.deepEqual(loadConfig(root),config);assert.equal(upstreamOptions(loadConfig(root)).brokerToken,options.brokerToken);
  assert.equal(readdirSync(join(root,'backups')).filter(name=>name.startsWith('legacy-0.2-shared-')).length,1);
 }finally{rmSync(box,{recursive:true,force:true});}
});

test('current standalone and explicitly external configs are never archived',async()=>{
 const box=temp();
 try{
  const owned=join(box,'owned');await initStandalone(owned);const config=readFileSync(join(owned,'config.json'),'utf8');
  await initStandalone(owned);assert.equal(readFileSync(join(owned,'config.json'),'utf8'),config);assert.equal(existsSync(join(owned,'backups')),false);
  const external=join(box,'external');initConfig(external,{version:1,brokerUrl:'http://127.0.0.1:41001',kswarmUrl:'http://127.0.0.1:41002'});
  const externalConfig=readFileSync(join(external,'config.json'),'utf8');await initStandalone(external);
  assert.equal(readFileSync(join(external,'config.json'),'utf8'),externalConfig);assert.equal(existsSync(join(external,'backups')),false);
 }finally{rmSync(box,{recursive:true,force:true});}
});
