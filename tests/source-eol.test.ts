import {privateTempDir as mkdtempSync} from './helpers/private-temp.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cpSync,mkdirSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const tracked=(...paths:string[])=>execFileSync('git',['-C',root,'ls-files','-z','--',...paths],{encoding:'utf8'}).split('\0').filter(Boolean);
const BINARY_EXTENSIONS=['png','ico','icns','jpg','jpeg','gif','webp','dmg','zip','woff','woff2','ttf','otf','node','wasm','pdf'];

test('.gitattributes pins working-tree text to LF and marks binary assets as binary',()=>{
 const attrs=readFileSync(join(root,'.gitattributes'),'utf8');
 assert.match(attrs,/^\*\s+text=auto\s+eol=lf$/m);
 for(const ext of BINARY_EXTENSIONS)assert.match(attrs,new RegExp(`^\\*\\.${ext}\\s+binary\\s+-eol$`,'m'),ext);
 const present=new Set(tracked().map(f=>f.includes('.')?f.slice(f.lastIndexOf('.')+1).toLowerCase():''));
 for(const ext of [...present].filter(ext=>BINARY_EXTENSIONS.includes(ext))){
  const sample=tracked().find(f=>f.toLowerCase().endsWith('.'+ext));
  assert.ok(sample,ext);
  const out=execFileSync('git',['-C',root,'check-attr','text','eol','binary','--',sample],{encoding:'utf8'});
  assert.match(out,/: binary: set$/m,sample);
  assert.match(out,/: text: unset$/m,sample);
  assert.match(out,/: eol: unset$/m,sample);
 }
 const textSample='src/vendor/kswarm/runtime-capabilities.js';
 const textAttr=execFileSync('git',['-C',root,'check-attr','text','eol','binary','--',textSample],{encoding:'utf8'});
 assert.match(textAttr,/: eol: lf$/m,textSample);
 assert.doesNotMatch(textAttr,/: binary: set$/m,textSample);
});

test('verify:sources reports source_digest_mismatch when a locked file is checked out as CRLF',()=>{
 const temp=realpathSync(mkdtempSync(join(tmpdir(),'kteam-eol-')));
 try{
  const copy=join(temp,'kteam');
  const lock=JSON.parse(readFileSync(join(root,'sources.lock.json'),'utf8'));
  const files=['scripts/verify-sources.mjs','sources.lock.json',...lock.vendoredFiles.map((f:any)=>f.file),...lock.references.map((f:any)=>f.file).filter((f:string)=>!f.startsWith('docs/'))];
  for(const file of files){mkdirSync(dirname(join(copy,file)),{recursive:true});cpSync(join(root,file),join(copy,file));}
  const target=lock.vendoredFiles[0].file;
  const original=readFileSync(join(copy,target));
  assert.equal(original.includes(Buffer.from('\r\n')),false,'fixture must start as LF');
  writeFileSync(join(copy,target),Buffer.from(original.toString('binary').replaceAll('\n','\r\n'),'binary'));
  assert.throws(
   ()=>execFileSync(process.execPath,[join(copy,'scripts/verify-sources.mjs')],{encoding:'utf8',env:{...process.env,KTEAM_UPSTREAM_ROOT:process.env.KTEAM_UPSTREAM_ROOT??resolve(root,'..')}}),
   (error:any)=>String(error.stderr??'').includes('source_digest_mismatch:'+target)||String(error.message??'').includes('source_digest_mismatch:'+target),
  );
 }finally{rmSync(temp,{recursive:true,force:true});}
});
