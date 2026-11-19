import {test} from 'node:test';
import assert from 'node:assert/strict';
import {lstatSync,mkdtempSync,mkdirSync,readFileSync,readlinkSync,rmSync,statSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../..',import.meta.url));
const {packInputPlan,hideDanglingPackLinks,statVisiblePackEntries,NON_PAYLOAD_LINKS}=createRequire(import.meta.url)(join(root,'scripts/desktop-pack-input.mjs')) as {
  packInputPlan:(dir:string)=>{hide:string[];links:Array<{name:string;target:string;dangling:boolean}>};
  hideDanglingPackLinks:(dir:string)=>{plan:{hide:string[]};restore:()=>void};
  statVisiblePackEntries:(dir:string)=>string[];
  NON_PAYLOAD_LINKS:string[];
};

function tree(){
  const dir=mkdtempSync(join(tmpdir(),'kteam-pack-input-'));
  writeFileSync(join(dir,'package.json'),'{"name":"fixture"}\n');
  symlinkSync('missing-docs-checkout',join(dir,'docs'));
  symlinkSync('docs/design/desktop/design-qa-presence-peer-exchanges.md',join(dir,'design-qa.md'));
  return dir;
}

test('a broken documentation link is stat ENOENT and is not a payload file',()=>{
  const dir=tree();
  assert.throws(()=>statSync(join(dir,'design-qa.md')),(error:NodeJS.ErrnoException)=>error.code==='ENOENT');
  assert.throws(()=>statSync(join(dir,'docs')),(error:NodeJS.ErrnoException)=>error.code==='ENOENT');
  const plan=packInputPlan(dir);
  assert.deepEqual(plan.hide,['design-qa.md','docs']);
  assert.deepEqual(NON_PAYLOAD_LINKS,['design-qa.md','docs']);
  assert.equal(readFileSync(join(root,'scripts/desktop-pack-input.mjs'),'utf8').includes('mydocs'),false);
  assert.equal(readFileSync(join(root,'scripts/pack-desktop.mjs'),'utf8').includes('electron-builder/out/cli/cli.js'),true);
  assert.match(readFileSync(join(root,'package.json'),'utf8'),/"pack:desktop": "node scripts\/pack-desktop.mjs"/);
});

test('hiding dangling documentation links lets a following stat walk finish, then restores the links',()=>{
  const dir=tree();
  const held=hideDanglingPackLinks(dir);
  assert.deepEqual(held.plan.hide,['design-qa.md','docs']);
  const visible=statVisiblePackEntries(dir);
  assert.equal(visible.includes('design-qa.md'),false);
  assert.equal(visible.includes('docs'),false);
  assert.equal(visible.includes('package.json'),true);
  held.restore();
  assert.equal(lstatSync(join(dir,'docs')).isSymbolicLink(),true);
  assert.equal(readlinkSync(join(dir,'design-qa.md')),'docs/design/desktop/design-qa-presence-peer-exchanges.md');
});

test('a reachable documentation link stays, and an unknown dangling link fails closed',()=>{
  const dir=tree();
  mkdirSync(join(dir,'real-docs','design','desktop'),{recursive:true});
  writeFileSync(join(dir,'real-docs','design','desktop','design-qa-presence-peer-exchanges.md'),'owned note\n');
  rmSync(join(dir,'docs'));
  symlinkSync('real-docs',join(dir,'docs'));
  rmSync(join(dir,'design-qa.md'));
  symlinkSync('docs/design/desktop/design-qa-presence-peer-exchanges.md',join(dir,'design-qa.md'));
  const plan=packInputPlan(dir);
  assert.deepEqual(plan.hide,[]);
  assert.equal(statSync(join(dir,'design-qa.md')).isFile(),true);
  symlinkSync('missing-other',join(dir,'other.md'));
  assert.throws(()=>packInputPlan(dir),(error:NodeJS.ErrnoException)=>error.code==='pack_dangling_symlink');
});
