import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtempSync,readFileSync,existsSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
test('a caller that leaves an upstream fixture before finally does not leave its original servers or private directory alive',async()=>{
 const env={...process.env};delete env.NODE_TEST_CONTEXT;
 const root=realpathSync(mkdtempSync(join(tmpdir(),'kteam-fixture-life-'))),record=join(root,'own-fixture.json');
 try{await promisify(execFile)(process.execPath,['--preserve-symlinks','--test',resolve('tests/fixtures/abandoned-upstreams.mjs')],{env:{...env,KTEAM_FIXTURE_RECORD:record},timeout:20000,maxBuffer:65536});const saved=JSON.parse(readFileSync(record,'utf8'));assert.equal(existsSync(saved.root),false);await assert.rejects(fetch(saved.url+'/health',{signal:AbortSignal.timeout(1500)}));}finally{rmSync(root,{recursive:true,force:true});}
});
