import {privateTempDir as mkdtempSync} from './helpers/private-temp.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {realpathSync,writeFileSync,rmSync,linkSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runtimeOutputPage} from '../src/runtime/runtime-output.js';
test('original model spill reader preserves multibyte boundaries and rejects traversal, hardlinks and invalid cursors',()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'kteam-output-')));try{const content='汉🙂é'.repeat(20),file=join(root,'proof.txt');writeFileSync(file,content);let output='',offset=0;for(let i=0;i<100;i++){const page=runtimeOutputPage(root,'proof',offset,7);output+=page.text;assert.doesNotMatch(page.text,/\uFFFD/);if(!page.hasMore)break;assert.ok(page.nextOffset>offset);offset=page.nextOffset;}assert.equal(output,content);assert.throws(()=>runtimeOutputPage(root,'../proof'),/runtime_output_invalid/);assert.throws(()=>runtimeOutputPage(root,'proof',1),/runtime_output_invalid/);assert.throws(()=>runtimeOutputPage(root,'proof',0,1),/runtime_output_invalid/);linkSync(file,join(root,'other.txt'));assert.throws(()=>runtimeOutputPage(root,'proof'),/runtime_output_invalid/);unlinkSync(join(root,'other.txt'));}finally{rmSync(root,{recursive:true,force:true});}
});

import {sharedRuntime} from '../src/runtime/native.js';
test('registry retains its actual sanitized return through a host port that is not given to tool code',async()=>{
 const core=await sharedRuntime();let captures=0,retained='';const registry=new core.ToolRegistry({autoMode:true},[{permission:'safe',definition:{name:'fixture_large_return',description:'synthetic',inputSchema:{type:'object'}},async execute(_input:any,context:any){assert.equal(context.retainToolOutput,undefined);return 'SYNTHETIC_RETURN\nAuthorization: Bearer syntheticfixturecredentialonly\n'+'v'.repeat(9000);}}]);
 try{const result=await registry.executeTool('fixture_large_return',{}, {retainToolOutput:(content:string)=>{captures++;retained=content;return '\nSYNTHETIC_HOST_HINT';}});assert.equal(captures,1);assert.match(retained,/SYNTHETIC_RETURN/);assert.doesNotMatch(retained,/syntheticfixturecredentialonly/);assert.match(result,/SYNTHETIC_HOST_HINT/);}finally{registry.dispose();}
});
