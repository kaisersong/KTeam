import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile,execFileSync} from 'node:child_process';
import {chmodSync,mkdtempSync,readFileSync,realpathSync,rmSync,statSync,symlinkSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {promisify} from 'node:util';
import {readServiceEndpoints,writeServiceEndpoints,serviceEndpointsFile,discoveredServiceUrls} from '../src/service/service-endpoints.js';
import {initStandalone} from '../src/runtime/managed-services.js';
import {loadConfig} from '../src/service/config.js';

// KTeam must not share loopback ports with xiaok (intent-broker 4318, kswarm 4400): its desktop binds its own
// ports and records them in KTeam's discovery file, which the CLI and every client read.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const run=promisify(execFile);
const temp=()=>realpathSync(mkdtempSync(join(tmpdir(),'kteam-endpoints-')));
const isolated=async(body:(dir:string)=>Promise<void>|void)=>{const dir=temp(),names=['KTEAM_BROKER_URL','KTEAM_KSWARM_URL','KTEAM_DESKTOP_DISCOVERY_FILE','KTEAM_DESKTOP_PORT','KTEAM_KSWARM_PORT','KTEAM_DATA_DIR'],before=Object.fromEntries(names.map(n=>[n,process.env[n]]));for(const n of names)delete process.env[n];try{await body(dir);}finally{for(const [k,v] of Object.entries(before))if(v===undefined)delete process.env[k];else process.env[k]=v;rmSync(dir,{recursive:true,force:true});}};

test('no source outside tests hardcodes the xiaok broker or kswarm port',()=>{
 const files=execFileSync('git',['-C',root,'ls-files','-z','--','runtime-core','src','desktop','scripts','electron-builder.yml','package.json'],{encoding:'utf8'}).split('\0').filter(f=>/\.(?:[cm]?[jt]sx?|json|ya?ml)$/.test(f));
 assert.ok(files.length>100);
 const hits=files.flatMap(f=>[...readFileSync(join(root,f),'utf8').matchAll(/(?<![\w.])(?:4318|4400)(?![\w])/g)].map(m=>f+': '+m[0]));
 assert.deepEqual(hits,[]);
 for(const bundle of ['build/shared/kteam-runtime.mjs','build/shared/kteam-harness.mjs'])assert.doesNotMatch(readFileSync(join(root,bundle),'utf8'),/(?<![\w.])(?:4318|4400)(?![\w])/,bundle);
});

test('discovery file round-trips privately between KTeam and its runtime, and rejects unsafe content',()=>isolated(async dir=>{
 const file=serviceEndpointsFile(dir);assert.equal(file,join(dir,'service-endpoints.json'));
 assert.equal(readServiceEndpoints(dir),undefined);
 writeServiceEndpoints(dir,{broker:41001,kswarm:41002});
 if(process.platform!=='win32')assert.equal(statSync(file).mode&0o777,0o600);
 assert.deepEqual(readServiceEndpoints(dir),{broker:41001,kswarm:41002});
 // runtime-core reads and writes the same file and format.
 process.env.KTEAM_DATA_DIR=dir;
 const core=await import(pathToFileURL(join(root,'build/shared/kteam-runtime.mjs')).href+'?endpoints');
 assert.equal(core.desktopServiceDiscoveryFile(),file);
 assert.deepEqual(core.readDesktopServicePorts(file),{broker:41001,kswarm:41002});
 assert.equal(core.desktopServiceUrl('broker'),'http://127.0.0.1:41001');
 assert.equal(core.desktopServiceUrl('kswarm'),'http://127.0.0.1:41002');
 core.writeDesktopServicePorts(file,{broker:42001,kswarm:42002});
 if(process.platform!=='win32')assert.equal(statSync(file).mode&0o777,0o600);
 assert.deepEqual(readServiceEndpoints(dir),{broker:42001,kswarm:42002});
 // Explicit KTeam overrides win over the file; there is no fixed fallback port.
 assert.deepEqual(core.configuredDesktopServicePorts({}),{broker:0,kswarm:0});
 assert.deepEqual(core.configuredDesktopServicePorts({INTENT_BROKER_PORT:'4318',KSWARM_PORT:'4400'}),{broker:0,kswarm:0});
 process.env.KTEAM_BROKER_URL='http://127.0.0.1:43001';assert.equal(core.desktopServiceUrl('broker'),'http://127.0.0.1:43001');delete process.env.KTEAM_BROKER_URL;
 rmSync(file);assert.throws(()=>core.desktopServiceUrl('broker'),/desktop_service_discovery_missing/);
 // Invalid content is rejected by both readers.
 assert.throws(()=>writeServiceEndpoints(dir,{broker:41001,kswarm:41001}),/service_endpoints_invalid/);
 assert.throws(()=>core.writeDesktopServicePorts(file,{broker:0,kswarm:41002}),/port/);
 writeFileSync(file,JSON.stringify({broker:41001,kswarm:'41002'}),{mode:0o600});
 assert.throws(()=>readServiceEndpoints(dir),/service_endpoints_invalid/);assert.throws(()=>core.readDesktopServicePorts(file),/number/);
 if(process.platform!=='win32'){
  writeFileSync(file,JSON.stringify({broker:41001,kswarm:41002}),{mode:0o600});chmodSync(file,0o644);
  assert.throws(()=>readServiceEndpoints(dir),/private_file_required/);assert.throws(()=>core.readDesktopServicePorts(file),/private/);
  rmSync(file);writeFileSync(join(dir,'elsewhere.json'),JSON.stringify({broker:41001,kswarm:41002}),{mode:0o600});symlinkSync(join(dir,'elsewhere.json'),file);
  assert.throws(()=>readServiceEndpoints(dir),/private_file_required/);assert.throws(()=>core.readDesktopServicePorts(file),/private/);
 }
}));

test('standalone desktop init records its own free ports, and the CLI reads them unless KTEAM_*_URL overrides',{timeout:20000},()=>isolated(async dir=>{
 const data=join(dir,'kteam');await initStandalone(data);
 const config=loadConfig(data),ports=readServiceEndpoints(data)!;
 assert.equal(config.brokerUrl,'http://127.0.0.1:'+ports.broker);assert.equal(config.kswarmUrl,'http://127.0.0.1:'+ports.kswarm);
 for(const port of [ports.broker,ports.kswarm])assert.ok(![4318,4400].includes(port),String(port));
 // A later launch keeps publishing the same recorded ports.
 rmSync(serviceEndpointsFile(data));await initStandalone(data);assert.deepEqual(readServiceEndpoints(data),ports);
 assert.deepEqual(discoveredServiceUrls(data,{}),{brokerUrl:config.brokerUrl,kswarmUrl:config.kswarmUrl});
 assert.deepEqual(discoveredServiceUrls(data,{KTEAM_BROKER_URL:'http://127.0.0.1:43001'}),{brokerUrl:'http://127.0.0.1:43001',kswarmUrl:config.kswarmUrl});
 const cli=join(root,'dist/src/cli.js'),env=(extra:Record<string,string>)=>{const e:NodeJS.ProcessEnv={...process.env,...extra};for(const k of ['KTEAM_BROKER_URL','KTEAM_KSWARM_URL','KTEAM_BROKER_TOKEN_FILE','KTEAM_KSWARM_TOKEN_FILE','KTEAM_DESKTOP_DISCOVERY_FILE'])if(!(k in extra))delete e[k];return e;};
 // CLI with no discovery file and no override refuses instead of guessing a shared port.
 const empty=join(dir,'cli-empty');
 await assert.rejects(run(process.execPath,[cli,'init'],{env:env({KTEAM_DATA_DIR:empty})}),(error:any)=>error.stderr.includes('service_endpoints_missing'));
 assert.equal(existsSync(join(empty,'config.json')),false);
 // CLI reads the discovery file written by the desktop.
 const reader=join(dir,'cli-reader');
 await run(process.execPath,[cli,'init'],{env:env({KTEAM_DATA_DIR:reader,KTEAM_DESKTOP_DISCOVERY_FILE:serviceEndpointsFile(data)})});
 const read=loadConfig(reader);assert.equal(read.brokerUrl,config.brokerUrl);assert.equal(read.kswarmUrl,config.kswarmUrl);
 // Explicit URLs still override.
 const explicit=join(dir,'cli-explicit');
 await run(process.execPath,[cli,'init'],{env:env({KTEAM_DATA_DIR:explicit,KTEAM_BROKER_URL:'http://127.0.0.1:43001',KTEAM_KSWARM_URL:'http://127.0.0.1:43002'})});
 const over=loadConfig(explicit);assert.equal(over.brokerUrl,'http://127.0.0.1:43001');assert.equal(over.kswarmUrl,'http://127.0.0.1:43002');
}));
