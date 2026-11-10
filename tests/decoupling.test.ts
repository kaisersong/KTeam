import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cpSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {dataRoot} from '../src/service/config.js';

// KTeam owns runtime-core (a one-time copy of xiaok-cli f8728a34, see NOTICE). These checks keep it decoupled:
// no xiaok build input, no xiaok runtime path/env var/keychain entry, and no update feed but KTeam's Releases.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const tracked=(...paths:string[])=>execFileSync('git',['-C',root,'ls-files','-z','--',...paths],{encoding:'utf8'}).split('\0').filter(Boolean);
const read=(file:string)=>readFileSync(join(root,file),'utf8');
const code=(file:string)=>/\.(?:[cm]?[jt]sx?|json|ya?ml)$/.test(file);

// External-agent interop only: KTeam can launch an independently installed xiaok CLI like Codex or Kimi
// (forwarding its own XIAOK_HOME, fingerprinting its config) and offers a user-triggered, read-only model import.
const INTEROP:Record<string,RegExp[]>={
 'src/runtime/local-agents.ts':[/'XIAOK_HOME'/g,/join\(home,'\.xiaok\/config\.json'\)/g,/join\(home,'\.config\/xiaok\/config\.json'\)/g],
 'desktop/main.ts':[/'XIAOK_HOME'/g],
 'src/service/model-settings.ts':[/join\(homedir\(\),'\.xiaok'(?:,'config\.json')?\)/g,/'com\.xiaok\.credentials\.v1'/g],
};
// Persisted format identifiers inside KTeam's own files (config meta key, secret references, A2UI catalog).
const FORMAT_IDS=/\$xiaokCredentials|xiaok-secret:v1:|xiaok-safe(?:\/1\.0)?/g;
const Q=`['"\x60]`,SEP=`(?:${Q}\\s*,\\s*${Q}|[/\\\\])`;
const RUNTIME_COUPLING=new RegExp([`XIAOK_[A-Z0-9_]*`,`${Q}\\.xiaok\\b`,`[/\\\\]\\.xiaok\\b`,`\\.xiaok${Q}`,`com\\.xiaok\\b`,`Application Support${SEP}xiaok`,`AppData${SEP}(?:Local|Roaming)${SEP}xiaok`,`\\.local${SEP}(?:state|share)${SEP}xiaok`,`\\.config${SEP}xiaok`].join('|'),'g');

test('build and test inputs never reference xiaok-cli or the mydocs checkout',()=>{
 const pkg=JSON.parse(read('package.json'));
 for(const [name,spec] of Object.entries({...pkg.dependencies,...pkg.devDependencies,...pkg.optionalDependencies}))assert.doesNotMatch(name+' '+String(spec),/xiaok/i,name);
 for(const [name,script] of Object.entries(pkg.scripts as Record<string,string>))assert.doesNotMatch(script,/xiaok|mydocs/i,name);
 const lock=JSON.parse(read('sources.lock.json'));
 assert.deepEqual(lock.sources.map((s:any)=>s.name).sort(),['intent-broker','kswarm']);
 assert.doesNotMatch(read('sources.lock.json'),/xiaok/i);
 assert.equal(lock.runtime,undefined);assert.equal(lock.ui,undefined);
 const build=[...tracked('scripts','electron-builder.yml','tsconfig.json','desktop/tsconfig.json','desktop/vite.config.ts')].filter(code);
 assert.ok(build.includes('scripts/build-runtime.mjs'));
 for(const file of build)assert.doesNotMatch(read(file),/xiaok/i,file);
 for(const file of build.filter(f=>f!=='scripts/verify-sources.mjs'))assert.doesNotMatch(read(file),/mydocs/,file);
 // No module anywhere imports from a xiaok-named path or a sibling checkout.
 for(const file of tracked('src','runtime-core','desktop','scripts','tests').filter(f=>/\.(?:[cm]?[jt]sx?)$/.test(f))){
  for(const m of read(file).matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g))assert.doesNotMatch(m[1]!,/xiaok|mydocs/i,file+' imports '+m[1]);
 }
 for(const gone of ['vendor/xiaok-runtime','desktop/xiaok','src/vendor/xiaok','scripts/sync-xiaok-runtime.mjs'])assert.equal(tracked(gone).length,0,gone);
});

test('verify:sources passes without the mydocs docs link',()=>{
 const temp=realpathSync(mkdtempSync(join(tmpdir(),'kteam-decouple-')));
 try{
  const copy=join(temp,'kteam'),lock=JSON.parse(read('sources.lock.json'));mkdirSync(join(copy,'scripts'),{recursive:true});
  for(const file of ['scripts/verify-sources.mjs','sources.lock.json',...lock.vendoredFiles.map((f:any)=>f.file),...lock.references.map((f:any)=>f.file).filter((f:string)=>!f.startsWith('docs/'))]){mkdirSync(dirname(join(copy,file)),{recursive:true});cpSync(join(root,file),join(copy,file));}
  assert.equal(existsSync(join(copy,'docs')),false);
  const out=JSON.parse(execFileSync(process.execPath,[join(copy,'scripts/verify-sources.mjs')],{encoding:'utf8',env:{...process.env,KTEAM_UPSTREAM_ROOT:process.env.KTEAM_UPSTREAM_ROOT??resolve(root,'..')}}));
  assert.equal(out.ok,true);assert.equal(out.documentation,'not_linked');
  assert.deepEqual(out.upstreams.map((u:any)=>u.name).sort(),['intent-broker','kswarm']);
 }finally{rmSync(temp,{recursive:true,force:true});}
});

test('runtime code has no xiaok default path, env var or keychain service outside declared interop',()=>{
 const hits:string[]=[];
 for(const file of tracked('runtime-core','src','desktop','scripts').filter(f=>/\.(?:[cm]?[jt]sx?|json)$/.test(f))){
  let text=read(file);
  for(const allowed of INTEROP[file]??[])text=text.replace(allowed,'');
  text=text.replace(FORMAT_IDS,'');
  for(const m of text.matchAll(RUNTIME_COUPLING))hits.push(file+': '+m[0]);
 }
 assert.deepEqual(hits,[]);
 // Every declared interop pattern still exists, so the allowlist cannot silently grow stale.
 for(const [file,patterns] of Object.entries(INTEROP))for(const p of patterns)assert.match(read(file),new RegExp(p.source),file+' '+p);
 // runtime-core mentions xiaok only through the persisted format identifiers.
 for(const file of tracked('runtime-core','desktop/core-ui'))assert.doesNotMatch(read(file).replace(FORMAT_IDS,''),/xiaok/i,file);
});

test('default data, runtime config and keychain locations belong to KTeam',async()=>{
 const before={HOME:process.env.HOME,KTEAM_DATA_DIR:process.env.KTEAM_DATA_DIR,KTEAM_MODEL_CONFIG_DIR:process.env.KTEAM_MODEL_CONFIG_DIR,XIAOK_CONFIG_DIR:process.env.XIAOK_CONFIG_DIR};
 const home=realpathSync(mkdtempSync(join(tmpdir(),'kteam-home-')));
 try{
  process.env.HOME=home;delete process.env.KTEAM_DATA_DIR;delete process.env.KTEAM_MODEL_CONFIG_DIR;
  // A stray xiaok variable must not redirect KTeam.
  process.env.XIAOK_CONFIG_DIR=join(home,'.xiaok');
  assert.equal(dataRoot(),join(home,'.kteam'));
  const entry=join(root,'build/shared/kteam-runtime.mjs');assert.ok(existsSync(entry),'runtime bundle built');
  const core=await import(entry+'?decoupling');
  assert.equal(core.getConfigDir(),join(home,'.kteam','runtime'));
  const bundle=readFileSync(entry,'utf8');
  assert.ok(/["']com\.kteam\.credentials\.v1["']/.test(bundle),'KTeam keychain service in bundle');
  assert.ok(!/process\.env\.XIAOK_|com\.xiaok\.credentials/.test(bundle),'no xiaok env/keychain in bundle');
  assert.equal(existsSync(join(home,'.xiaok')),false);
 }finally{for(const [k,v] of Object.entries(before))if(v===undefined)delete process.env[k];else process.env[k]=v;rmSync(home,{recursive:true,force:true});}
});

test('app identity is KTeam and the only release/update feed is kaisersong/KTeam',()=>{
 const builder=read('electron-builder.yml');
 assert.match(builder,/^appId: com\.kteam\.desktop$/m);assert.match(builder,/^productName: KTeam$/m);
 assert.doesNotMatch(builder,/xiaok/i);
 for(const m of builder.matchAll(/^\s*(owner|repo):\s*(\S+)/gm))assert.equal(m[2],m[1]==='owner'?'kaisersong':'KTeam');
 const pkg=JSON.parse(read('package.json'));assert.equal(pkg.build?.publish,undefined);
 const feeds:string[]=[];
 for(const file of tracked('runtime-core','src','desktop','scripts','electron-builder.yml','package.json').filter(code)){
  const text=read(file);
  for(const m of text.matchAll(/github\.com\/(?:repos\/)?([\w.-]+)\/([\w.-]+)\/releases\b/g))feeds.push(file+': '+m[1]+'/'+m[2]);
  if(/autoUpdater|electron-updater|setFeedURL|latest(?:-mac)?\.yml/.test(text)&&!/kaisersong\/KTeam|owner:\s*['"]?kaisersong['"]?[\s\S]{0,80}repo:\s*['"]?KTeam/.test(text))feeds.push(file+': updater without KTeam feed');
 }
 // Third-party tool downloads are not update feeds; anything else must be KTeam's own Releases.
 assert.deepEqual(feeds.filter(f=>!/: (?:kaisersong\/KTeam|trycua\/cua)$/.test(f)),[]);
});
