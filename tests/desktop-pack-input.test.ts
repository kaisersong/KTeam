import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {existsSync,lstatSync,mkdtempSync,mkdirSync,readFileSync,readlinkSync,rmSync,statSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../..',import.meta.url));
const pack=createRequire(import.meta.url)(join(root,'scripts/desktop-pack-input.mjs')) as {
  packInputPlan:(dir:string)=>{hide:string[];links:Array<{name:string;target:string;dangling:boolean}>};
  stagePackTree:(dir:string,destination:string)=>{plan:{hide:string[]};destination:string};
  statVisiblePackEntries:(dir:string)=>string[];
  commandStatus:(result:{status?:number|null;signal?:NodeJS.Signals|null;error?:Error}|null)=>number|null;
  runPack:(options:{root:string;build:string[];pack:string[];verify?:string[];stage?:string;stdio?:'ignore'|'inherit';keepStage?:boolean})=>number;
  NON_PAYLOAD_LINKS:string[];
};

function tree(){
  const dir=mkdtempSync(join(tmpdir(),'kteam-pack-input-'));
  writeFileSync(join(dir,'package.json'),'{"name":"fixture"}\n');
  mkdirSync(join(dir,'payload'));
  writeFileSync(join(dir,'payload','readme.txt'),'payload\n');
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
    assert.equal(readFileSync(join(staged.destination,'payload','readme.txt'),'utf8'),'payload\n');
    assert.equal(readlinkSync(join(staged.destination,'outside.txt')),outsideFile);
    assert.equal(lstatSync(join(dir,'docs')).isSymbolicLink(),true);
    assert.equal(readlinkSync(join(dir,'design-qa.md')),'docs/design/desktop/design-qa-presence-peer-exchanges.md');
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
      assert.equal(readFileSync(join(dest,'payload','readme.txt'),'utf8'),'payload\n');
    }
    assert.equal(readlinkSync(join(dir,'docs')),'missing-docs-checkout');
    assert.equal(readlinkSync(join(dir,'design-qa.md')),'docs/design/desktop/design-qa-presence-peer-exchanges.md');
  }finally{remove(dir);remove(first);remove(second);}
});

test('a signalled build is a failed command and does not start packing or move links',()=>{
  const dir=tree(),marker=join(dir,'pack-started'),stage=join(tmpdir(),'kteam-pack-unstarted-'+process.pid);
  const killed=spawnSync(process.execPath,['-e','process.kill(process.pid,"SIGKILL")']);
  assert.equal(killed.status,null);
  assert.equal(pack.commandStatus(killed),null);
  assert.equal(pack.commandStatus({status:0}),0);
  assert.equal(pack.commandStatus({status:2}),2);
  try{
    const status=pack.runPack({root:dir,stdio:'ignore',stage,build:[process.execPath,'-e','process.kill(process.pid,"SIGKILL")'],pack:[process.execPath,'-e','require("fs").writeFileSync(process.argv[1],"started")',marker]});
    assert.equal(status,1);
    assert.equal(existsSync(marker),false);
    assert.equal(existsSync(stage),false);
    assert.equal(readlinkSync(join(dir,'docs')),'missing-docs-checkout');
  }finally{remove(dir);remove(stage);}
});

test('SIGINT while the pack child is running leaves the source links in place',async()=>{
  const dir=tree(),marker=join(tmpdir(),'kteam-pack-entered-'+process.pid),stage=join(tmpdir(),'kteam-pack-interrupt-'+process.pid);
  const script=`import {runPack} from './scripts/desktop-pack-input.mjs';
const code=runPack({root:process.argv[1],stdio:'ignore',stage:process.argv[3],build:[process.execPath,'-e','process.exit(0)'],pack:[process.execPath,'-e','require("fs").writeFileSync(process.argv[1],"in"); setInterval(()=>{},1000);',process.argv[2]]});
process.exit(code);`;
  const child=node(script,[dir,marker,stage],{detached:true});
  try{
    const deadline=Date.now()+5000;
    while(!existsSync(marker)){
      if(Date.now()>deadline)throw Error('pack_child_did_not_start');
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    process.kill(-(child.pid as number),'SIGINT');
    const code=await new Promise<number|null>((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('pack_child_survived_sigint')),5000);
      child.once('exit',status=>{clearTimeout(timer);resolve(status);});
    });
    assert.notEqual(code,0);
    assert.equal(readlinkSync(join(dir,'docs')),'missing-docs-checkout');
    assert.equal(readlinkSync(join(dir,'design-qa.md')),'docs/design/desktop/design-qa-presence-peer-exchanges.md');
    assert.equal(existsSync(join(dir,'package.json')),true);
  }finally{
    try{process.kill(-(child.pid as number),'SIGKILL');}catch{/* already exited */}
    remove(dir);remove(stage);rmSync(marker,{force:true});
  }
});
