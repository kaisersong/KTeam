import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chmodSync,existsSync,lstatSync,mkdtempSync,mkdirSync,readFileSync,readlinkSync,realpathSync,readdirSync,rmSync,statSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {isAbsolute,join,sep} from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../..',import.meta.url));
const {spawnBatchFile}=createRequire(import.meta.url)(join(root,'scripts/mobile-install.mjs')) as {spawnBatchFile:(scriptPath:string,args:string[],options?:{encoding?:BufferEncoding})=>{status:number|null;error?:Error;stdout?:string}};
const pack=createRequire(import.meta.url)(join(root,'scripts/desktop-pack-input.mjs')) as {
  packInputPlan:(dir:string)=>{hide:string[];links:Array<{name:string;target:string;dangling:boolean}>};
  stagePackTree:(dir:string,destination:string)=>{plan:{hide:string[]};destination:string};
  statVisiblePackEntries:(dir:string)=>string[];
  commandStatus:(result:{status?:number|null;signal?:NodeJS.Signals|null;error?:Error}|null)=>number|null;
  placeFreshIdentity:(source:string,destination:string)=>void;
  runPack:(options:{root:string;build:string[];pack:string[];verify?:string[];stage?:string;stdio?:'ignore'|'inherit';keepStage?:boolean;requireIdentity?:boolean})=>number;
  NON_PAYLOAD_LINKS:string[];
};

const slash=(value:string)=>value.split(sep).join('/');
const npmCommand=process.platform==='win32'?'npm.cmd':'npm';
function stopPack(child:{pid?:number,kill:(signal?:NodeJS.Signals)=>boolean},signal:NodeJS.Signals){
  const pid=child.pid;
  if(!pid)return;
  if(process.platform==='win32'){child.kill('SIGTERM');return;}
  try{process.kill(-pid,signal);}catch{try{child.kill(signal);}catch{/* The child has already exited. */}}
}
function tree(){
  const dir=mkdtempSync(join(tmpdir(),'kteam-pack-input-'));
  writeFileSync(join(dir,'package.json'),'{"name":"fixture"}\n');
  mkdirSync(join(dir,'build'));
  writeFileSync(join(dir,'build','readme.txt'),'payload\n');
  symlinkSync('missing-docs-checkout',join(dir,'docs'));
  symlinkSync('docs/design/desktop/design-qa-presence-peer-exchanges.md',join(dir,'design-qa.md'));
  return dir;
}
function remove(dir:string){rmSync(dir,{recursive:true,force:true});}
const node=(code:string,args:string[],options?:{detached?:boolean})=>spawn(process.execPath,['--input-type=module','-e',code,...args],{cwd:root,stdio:'ignore',...options});

test('a broken documentation link is stat ENOENT and is not a payload file',()=>{
  const dir=tree();
  try{
    assert.throws(()=>statSync(join(dir,'design-qa.md')),(error:NodeJS.ErrnoException)=>error.code==='ENOENT');
    assert.throws(()=>statSync(join(dir,'docs')),(error:NodeJS.ErrnoException)=>error.code==='ENOENT');
    const plan=pack.packInputPlan(dir);
    assert.deepEqual(plan.hide,['design-qa.md','docs']);
    assert.deepEqual(pack.NON_PAYLOAD_LINKS,['design-qa.md','docs']);
    assert.equal(readFileSync(join(root,'scripts/desktop-pack-input.mjs'),'utf8').includes('kteam-pack-links'),false);
    assert.equal(readFileSync(join(root,'scripts/pack-desktop.mjs'),'utf8').includes('electron-builder/out/cli/cli.js'),true);
    assert.match(readFileSync(join(root,'package.json'),'utf8'),/"pack:desktop": "node scripts\/pack-desktop.mjs"/);
  }finally{remove(dir);}
});

test('staging omits dangling documentation links and leaves the source tree untouched',()=>{
  const dir=tree(),outside=mkdtempSync(join(tmpdir(),'kteam-pack-outside-')),stage=mkdtempSync(join(tmpdir(),'kteam-pack-stage-'));
  const outsideFile=join(outside,'note.txt');
  writeFileSync(outsideFile,'outside\n');
  symlinkSync(outsideFile,join(dir,'outside.txt'));
  try{
    const staged=pack.stagePackTree(dir,stage);
    const visible=pack.statVisiblePackEntries(staged.destination);
    assert.equal(visible.includes('design-qa.md'),false);
    assert.equal(visible.includes('docs'),false);
    assert.equal(readFileSync(join(staged.destination,'package.json'),'utf8'),'{"name":"fixture"}\n');
    assert.equal(readFileSync(join(staged.destination,'build','readme.txt'),'utf8'),'payload\n');
    assert.equal(existsSync(join(staged.destination,'outside.txt')),false);
    assert.equal(lstatSync(join(dir,'docs')).isSymbolicLink(),true);
    assert.equal(slash(readlinkSync(join(dir,'design-qa.md'))),'docs/design/desktop/design-qa-presence-peer-exchanges.md');
    assert.notEqual(lstatSync(join(dir,'package.json')).ino,lstatSync(join(staged.destination,'package.json')).ino);
  }finally{remove(dir);remove(outside);remove(stage);}
});

test('a reachable documentation link stays in the plan, and an unknown dangling link fails closed',()=>{
  const dir=tree();
  try{
    mkdirSync(join(dir,'real-docs','design','desktop'),{recursive:true});
    writeFileSync(join(dir,'real-docs','design','desktop','design-qa-presence-peer-exchanges.md'),'owned note\n');
    rmSync(join(dir,'docs'));
    symlinkSync('real-docs',join(dir,'docs'));
    rmSync(join(dir,'design-qa.md'));
    symlinkSync('docs/design/desktop/design-qa-presence-peer-exchanges.md',join(dir,'design-qa.md'));
    const plan=pack.packInputPlan(dir);
    assert.deepEqual(plan.hide,[]);
    assert.equal(statSync(join(dir,'design-qa.md')).isFile(),true);
    symlinkSync('missing-other',join(dir,'other.md'));
    assert.throws(()=>pack.packInputPlan(dir),(error:NodeJS.ErrnoException)=>error.code==='pack_dangling_symlink');
  }finally{remove(dir);}
});

test('two pack stages can run at the same time without moving source links',async()=>{
  const dir=tree(),first=mkdtempSync(join(tmpdir(),'kteam-pack-a-')),second=mkdtempSync(join(tmpdir(),'kteam-pack-b-'));
  const script="import {stagePackTree} from './scripts/desktop-pack-input.mjs'; stagePackTree(process.argv[1], process.argv[2]);";
  try{
    const children=[first,second].map(dest=>node(script,[dir,dest]));
    const codes=await Promise.all(children.map(child=>new Promise<number>(resolve=>child.once('exit',code=>resolve(code??1)))));
    assert.deepEqual(codes,[0,0]);
    for(const dest of [first,second]){
      assert.equal(existsSync(join(dest,'docs')),false);
      assert.equal(existsSync(join(dest,'design-qa.md')),false);
      assert.equal(readFileSync(join(dest,'build','readme.txt'),'utf8'),'payload\n');
    }
    assert.equal(readlinkSync(join(dir,'docs')),'missing-docs-checkout');
    assert.equal(slash(readlinkSync(join(dir,'design-qa.md'))),'docs/design/desktop/design-qa-presence-peer-exchanges.md');
  }finally{remove(dir);remove(first);remove(second);}
});

test('a signalled build is a failed command and does not start packing or move links',()=>{
  const dir=tree(),marker=join(dir,'pack-started'),stage=join(tmpdir(),'kteam-pack-unstarted-'+process.pid);
  const killed=spawnSync(process.execPath,['-e','process.kill(process.pid,"SIGKILL")']);
  if(killed.signal){assert.equal(killed.status,null);assert.equal(pack.commandStatus(killed),null);}
  else{assert.notEqual(killed.status,0);assert.equal(pack.commandStatus(killed),killed.status);}
  assert.equal(pack.commandStatus({status:null,signal:'SIGKILL'}),null);
  assert.equal(pack.commandStatus({status:0}),0);
  assert.equal(pack.commandStatus({status:2}),2);
  try{
    const status=pack.runPack({root:dir,stdio:'ignore',stage,requireIdentity:false,build:[process.execPath,'-e','process.kill(process.pid,"SIGKILL")'],pack:[process.execPath,'-e','require("fs").writeFileSync(process.argv[1],"started")',marker]});
    assert.equal(status,1);
    assert.equal(existsSync(marker),false);
    assert.equal(existsSync(stage),false);
    assert.equal(readlinkSync(join(dir,'docs')),'missing-docs-checkout');
  }finally{remove(dir);remove(stage);}
});

test('interrupting the pack runner while its child is running leaves source links in place',async()=>{
  const dir=tree(),marker=join(tmpdir(),'kteam-pack-entered-'+process.pid),stage=join(tmpdir(),'kteam-pack-interrupt-'+process.pid);
  const stopped=marker+'.stopped',release=marker+'.release';
  const script=`import {runPack} from './scripts/desktop-pack-input.mjs';
const code=runPack({root:process.argv[1],stdio:'ignore',requireIdentity:false,stage:process.argv[3],build:[process.execPath,'-e','process.exit(0)'],pack:[process.execPath,'-e','const fs=require("node:fs");const ready=process.argv[1],finish=()=>{fs.writeFileSync(ready+".stopped","done");process.exit(7);};fs.writeFileSync(ready,"in");setInterval(()=>{if(fs.existsSync(ready+".release"))finish();},50);setTimeout(finish,12000);',process.argv[2]]});
process.exit(code);`;
  const child=node(script,[dir,marker,stage],{detached:process.platform!=='win32'});
  const exited=new Promise<number|null>((resolve,reject)=>{
    child.once('exit',resolve);
    child.once('error',reject);
  });
  try{
    const deadline=Date.now()+5000;
    while(!existsSync(marker)){
      if(Date.now()>deadline)throw Error('pack_child_did_not_start');
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    stopPack(child,'SIGINT');
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{
      const code=await Promise.race([exited,new Promise<never>((_,reject)=>{
        timer=setTimeout(()=>reject(Error('pack_runner_survived_interrupt')),5000);
      })]);
      assert.notEqual(code,0);
      if(process.platform==='win32')assert.equal(existsSync(stopped),false);
    }finally{clearTimeout(timer);}
    assert.equal(readlinkSync(join(dir,'docs')),'missing-docs-checkout');
    assert.equal(slash(readlinkSync(join(dir,'design-qa.md'))),'docs/design/desktop/design-qa-presence-peer-exchanges.md');
    assert.equal(existsSync(join(dir,'package.json')),true);
  }finally{
    if(child.exitCode===null&&child.signalCode===null)stopPack(child,'SIGKILL');
    if(process.platform==='win32'&&existsSync(marker)){
      writeFileSync(release,'stop');
      const deadline=Date.now()+5000;
      while(!existsSync(stopped)&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,25));
      assert.equal(existsSync(stopped),true);
    }
    remove(dir);remove(stage);rmSync(marker,{force:true});rmSync(stopped,{force:true});rmSync(release,{force:true});
  }
});

test('staged node_modules files have their own inode, so writes and chmod do not change the source',()=>{
  const dir=tree(),stage=mkdtempSync(join(tmpdir(),'kteam-pack-inode-'));
  const source=join(dir,'node_modules','pkg','file.txt');
  mkdirSync(join(dir,'node_modules','pkg'),{recursive:true});
  writeFileSync(source,'module\n',{mode:0o644});
  mkdirSync(join(dir,'node_modules','.bin'));
  symlinkSync('../pkg/file.txt',join(dir,'node_modules','.bin','tool'));
  try{
    const staged=pack.stagePackTree(dir,stage);
    const copy=join(staged.destination,'node_modules','pkg','file.txt');
    const before=lstatSync(source);
    assert.notEqual(before.ino,lstatSync(copy).ino);
    assert.equal(slash(readlinkSync(join(staged.destination,'node_modules','.bin','tool'))),'../pkg/file.txt');
    writeFileSync(copy,'changed\n');
    chmodSync(copy,0o700);
    assert.equal(readFileSync(source,'utf8'),'module\n');
    assert.equal(lstatSync(source).mode,before.mode);
  }finally{remove(dir);remove(stage);}
});

test('root dotenv files and stale build identity stay out of the stage until a fresh identity is placed',()=>{
  const dir=tree(),stage=mkdtempSync(join(tmpdir(),'kteam-pack-identity-'));
  writeFileSync(join(dir,'.env'),'fixture-dotenv-not-for-assertions\n',{mode:0o600});
  writeFileSync(join(dir,'build','build-info.json'),'OLD\n');
  mkdirSync(join(dir,'build','package-identity'));
  writeFileSync(join(dir,'build','package-identity','build-info.json'),'OLD-EXT\n');
  try{
    const staged=pack.stagePackTree(dir,stage);
    assert.equal(existsSync(join(staged.destination,'.env')),false);
    assert.equal(existsSync(join(staged.destination,'build','build-info.json')),false);
    assert.equal(existsSync(join(staged.destination,'build','package-identity')),false);
    writeFileSync(join(dir,'build','build-info.json'),'NEW\n');
    writeFileSync(join(dir,'build','package-identity','build-info.json'),'NEW-EXT\n');
    pack.placeFreshIdentity(dir,staged.destination);
    const fresh=join(staged.destination,'build','build-info.json');
    assert.equal(readFileSync(fresh,'utf8'),'NEW\n');
    assert.equal(readFileSync(join(staged.destination,'build','package-identity','build-info.json'),'utf8'),'NEW-EXT\n');
    assert.notEqual(lstatSync(join(dir,'build','build-info.json')).ino,lstatSync(fresh).ino);
    const sourceMode=lstatSync(join(dir,'build','build-info.json')).mode;
    writeFileSync(fresh,'CHANGED\n');
    chmodSync(fresh,0o700);
    assert.equal(readFileSync(join(dir,'build','build-info.json'),'utf8'),'NEW\n');
    assert.equal(lstatSync(join(dir,'build','build-info.json')).mode,sourceMode);
    assert.throws(()=>pack.placeFreshIdentity(mkdtempSync(join(tmpdir(),'kteam-pack-no-identity-')),staged.destination),(error:NodeJS.ErrnoException)=>error.code==='pack_identity_missing');
  }finally{remove(dir);remove(stage);}
});

test('file: dependency links and .bin links resolve inside the stage and writes do not change their sources',()=>{
  const parent=mkdtempSync(join(tmpdir(),'kteam-pack-file-deps-')),stage=mkdtempSync(join(tmpdir(),'kteam-pack-file-stage-'));
  const project=join(parent,'kteam'),kswarm=join(parent,'kswarm'),broker=join(parent,'intent-broker');
  mkdirSync(project,{recursive:true});mkdirSync(kswarm,{recursive:true});mkdirSync(broker,{recursive:true});
  writeFileSync(join(project,'package.json'),JSON.stringify({name:'kteam',dependencies:{kswarm:'file:../kswarm','intent-broker':'file:../intent-broker'}})+'\n');
  writeFileSync(join(kswarm,'package.json'),'{"name":"kswarm"}\n',{mode:0o644});
  writeFileSync(join(kswarm,'marker.txt'),'kswarm-source\n',{mode:0o644});
  symlinkSync('../mydocs/kswarm',join(kswarm,'docs'));
  writeFileSync(join(broker,'package.json'),'{"name":"intent-broker"}\n',{mode:0o644});
  writeFileSync(join(broker,'marker.txt'),'broker-source\n',{mode:0o644});
  symlinkSync('../mydocs/intent-broker',join(broker,'docs'));
  mkdirSync(join(project,'node_modules','pkg'),{recursive:true});
  writeFileSync(join(project,'node_modules','pkg','bin.js'),'bin-source\n',{mode:0o644});
  mkdirSync(join(project,'node_modules','.bin'));
  symlinkSync('../../kswarm',join(project,'node_modules','kswarm'));
  symlinkSync('../../intent-broker',join(project,'node_modules','intent-broker'));
  symlinkSync('../pkg/bin.js',join(project,'node_modules','.bin','tool'));
  symlinkSync(join(project,'node_modules','pkg','bin.js'),join(project,'node_modules','.bin','abs-tool'));
  const alias=join(parent,'project-alias');
  symlinkSync(project,alias);
  symlinkSync(join(alias,'node_modules','pkg','bin.js'),join(project,'node_modules','.bin','alias-tool'));
  try{
    const staged=pack.stagePackTree(project,stage).destination;
    const deps:[string,string][]=[['kswarm','kswarm-source\n'],['intent-broker','broker-source\n']];
    for(const [name,sourceText] of deps){
      const copy=join(staged,'node_modules',name);
      const source=join(parent,name,'marker.txt');
      assert.equal(lstatSync(copy).isSymbolicLink(),false);
      assert.equal(lstatSync(copy).isDirectory(),true);
      assert.equal(existsSync(join(copy,'docs')),false);
      const copied=join(copy,'marker.txt');
      assert.notEqual(lstatSync(source).ino,lstatSync(copied).ino);
      assert.equal(realpathSync.native(copied).startsWith(realpathSync.native(staged)),true);
      const mode=lstatSync(source).mode;
      writeFileSync(copied,'changed\n');
      chmodSync(copied,0o700);
      assert.equal(readFileSync(source,'utf8'),sourceText);
      assert.equal(lstatSync(source).mode,mode);
    }
    const linked=join(staged,'node_modules','.bin','tool');
    const absolute=join(staged,'node_modules','.bin','abs-tool');
    const aliased=join(staged,'node_modules','.bin','alias-tool');
    const stageRoot=realpathSync.native(staged),projectRoot=realpathSync.native(project);
    for(const link of [linked,absolute,aliased]){
      assert.equal(lstatSync(link).isSymbolicLink(),true);
      const resolved=realpathSync.native(link);
      assert.equal(resolved.startsWith(stageRoot),true);
      assert.equal(resolved.startsWith(projectRoot),false);
    }
    const sourceBin=join(project,'node_modules','pkg','bin.js');
    const mode=lstatSync(sourceBin).mode;
    writeFileSync(linked,'changed-bin\n');
    chmodSync(linked,0o700);
    assert.equal(readFileSync(sourceBin,'utf8'),'bin-source\n');
    assert.equal(lstatSync(sourceBin).mode,mode);
  }finally{remove(parent);remove(stage);}
});

function sha(path:string){return createHash('sha256').update(readFileSync(path)).digest('hex');}
function stagedSymlinks(dir:string):string[]{
  const found:string[]=[];
  const visit=(current:string)=>{
    for(const name of readdirSync(current)){
      const full=join(current,name);
      const info=lstatSync(full);
      if(info.isSymbolicLink()){found.push(readlinkSync(full));continue;}
      if(info.isDirectory())visit(full);
    }
  };
  visit(dir);
  return found;
}

test('npm install file:../ dependencies link as ../../ and stay isolated after staging',()=>{
  const parent=mkdtempSync(join(tmpdir(),'kteam-pack-npm-')),stage=mkdtempSync(join(tmpdir(),'kteam-pack-npm-stage-'));
  const kswarm=join(parent,'kswarm'),broker=join(parent,'intent-broker'),project=join(parent,'kteam'),privateDir=join(parent,'private');
  mkdirSync(join(kswarm,'bin'),{recursive:true});mkdirSync(broker,{recursive:true});mkdirSync(project,{recursive:true});mkdirSync(privateDir);
  writeFileSync(join(privateDir,'secret.txt'),'private-source\n',{mode:0o600});
  writeFileSync(join(kswarm,'index.js'),'console.log("kswarm-marker")\n',{mode:0o644});
  symlinkSync('../index.js',join(kswarm,'bin','run.js'));
  writeFileSync(join(kswarm,'package.json'),JSON.stringify({name:'kswarm',version:'0.0.0',main:'index.js',bin:{'kswarm-marker':'./bin/run.js'}})+'\n');
  writeFileSync(join(kswarm,'.env'),'fixture-dotenv-not-for-assertions\n',{mode:0o600});
  mkdirSync(join(kswarm,'.git'));
  writeFileSync(join(kswarm,'.git','config'),'fixture-git-config-not-for-assertions\n',{mode:0o600});
  symlinkSync('../private',join(kswarm,'escape'));
  writeFileSync(join(broker,'index.js'),'module.exports=1\n',{mode:0o644});
  writeFileSync(join(broker,'package.json'),JSON.stringify({name:'intent-broker',version:'0.0.0',main:'index.js'})+'\n');
  writeFileSync(join(project,'package.json'),JSON.stringify({name:'kteam-pack-fixture',version:'0.0.0',dependencies:{kswarm:'file:../kswarm','intent-broker':'file:../intent-broker'}})+'\n');
  const cli=process.env.npm_execpath;
  const pinned=!!cli&&isAbsolute(cli)&&existsSync(cli);
  const flags=['install','--ignore-scripts','--no-audit','--no-fund','--package-lock=false'];
  const installed=spawnSync(pinned?process.execPath:npmCommand,pinned?[cli!,...flags]:flags,{
    cwd:project,stdio:['ignore','pipe','pipe'],shell:!pinned&&process.platform==='win32',windowsHide:true,timeout:30000,
  });
  if(installed.error)throw installed.error;
  if(installed.status!==0)throw Error('npm_install_failed:'+(installed.stderr??''));
  assert.equal(realpathSync.native(join(project,'node_modules','kswarm')),realpathSync.native(kswarm));
  assert.equal(realpathSync.native(join(project,'node_modules','intent-broker')),realpathSync.native(broker));
  if(process.platform!=='win32'){
    assert.equal(slash(readlinkSync(join(project,'node_modules','kswarm'))),'../../kswarm');
    assert.equal(slash(readlinkSync(join(project,'node_modules','intent-broker'))),'../../intent-broker');
  }
  const sourceIndex=join(kswarm,'index.js'),sourceBroker=join(broker);
  const indexHash=sha(sourceIndex),indexMode=lstatSync(sourceIndex).mode,brokerMode=lstatSync(sourceBroker).mode,privateMode=lstatSync(join(privateDir,'secret.txt')).mode;
  try{
    const staged=pack.stagePackTree(project,stage).destination;
    const stagedIndex=join(staged,'node_modules','kswarm','index.js');
    assert.equal(lstatSync(join(staged,'node_modules','kswarm')).isSymbolicLink(),false);
    assert.equal(lstatSync(join(staged,'node_modules','intent-broker')).isSymbolicLink(),false);
    assert.equal(realpathSync.native(stagedIndex).startsWith(realpathSync.native(staged)),true);
    assert.equal(realpathSync.native(stagedIndex).startsWith(realpathSync.native(kswarm)),false);
    const bin=join(staged,'node_modules','.bin',process.platform==='win32'?'kswarm-marker.cmd':'kswarm-marker');
    const ran=process.platform==='win32'?spawnBatchFile(bin,[],{encoding:'utf8'}):spawnSync(process.execPath,[bin],{encoding:'utf8'});
    if(ran.error)throw ran.error;
    assert.equal(ran.status,0);
    assert.equal((ran.stdout??'').trim(),'kswarm-marker');
    assert.equal(existsSync(join(staged,'node_modules','kswarm','.env')),false);
    assert.equal(existsSync(join(staged,'node_modules','kswarm','.git')),false);
    assert.equal(existsSync(join(staged,'node_modules','kswarm','escape')),false);
    assert.equal(stagedSymlinks(join(staged,'node_modules','kswarm')).some(link=>link.includes('private')),false);
    writeFileSync(stagedIndex,'console.log("changed")\n');
    chmodSync(stagedIndex,0o700);
    chmodSync(join(staged,'node_modules','intent-broker'),0o700);
    assert.equal(sha(sourceIndex),indexHash);
    assert.equal(lstatSync(sourceIndex).mode,indexMode);
    assert.equal(lstatSync(sourceBroker).mode,brokerMode);
    assert.equal(readFileSync(join(privateDir,'secret.txt'),'utf8'),'private-source\n');
    assert.equal(lstatSync(join(privateDir,'secret.txt')).mode,privateMode);
  }finally{remove(parent);remove(stage);}
});

test('a dependency cycle fails closed and an unexpected external link is not copied',()=>{
  const dir=tree(),stage=mkdtempSync(join(tmpdir(),'kteam-pack-cycle-')),outside=mkdtempSync(join(tmpdir(),'kteam-pack-private-'));
  writeFileSync(join(outside,'secret.txt'),'outside-source\n',{mode:0o600});
  const outsideMode=lstatSync(join(outside,'secret.txt')).mode;
  mkdirSync(join(dir,'node_modules','pkg'),{recursive:true});
  symlinkSync('cycle',join(dir,'node_modules','pkg','cycle'));
  try{
    assert.throws(()=>pack.stagePackTree(dir,stage),(error:NodeJS.ErrnoException)=>error.code==='pack_stage_symlink_cycle');
    rmSync(join(dir,'node_modules','pkg','cycle'));
    symlinkSync(outside,join(dir,'node_modules','pkg','escape'));
    assert.throws(()=>pack.stagePackTree(dir,stage),(error:NodeJS.ErrnoException)=>error.code==='pack_external_link_unscoped');
    assert.equal(readFileSync(join(outside,'secret.txt'),'utf8'),'outside-source\n');
    assert.equal(lstatSync(join(outside,'secret.txt')).mode,outsideMode);
  }finally{remove(dir);remove(stage);remove(outside);}
});

test('an unknown dangling symlink below the project root fails closed',()=>{
  const dir=tree(),stage=mkdtempSync(join(tmpdir(),'kteam-pack-dangling-'));
  mkdirSync(join(dir,'build','nested'));
  symlinkSync('missing-target',join(dir,'build','nested','lost.txt'));
  try{
    assert.throws(()=>pack.stagePackTree(dir,stage),(error:NodeJS.ErrnoException)=>error.code==='pack_dangling_symlink'&&String(error.message).includes('build/nested/lost.txt'));
    assert.equal(lstatSync(join(dir,'build','nested','lost.txt')).isSymbolicLink(),true);
    mkdirSync(join(dir,'node_modules'));
    symlinkSync('absent-tool',join(dir,'node_modules','missing-tool'));
    assert.throws(()=>pack.stagePackTree(dir,stage),(error:NodeJS.ErrnoException)=>error.code==='pack_dangling_symlink'&&String(error.message).includes('node_modules/missing-tool'));
  }finally{remove(dir);remove(stage);}
});
