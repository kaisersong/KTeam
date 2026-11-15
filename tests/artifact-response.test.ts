import {test} from 'node:test';
import assert from 'node:assert/strict';
import {publishedArtifactResult} from '../src/runtime/artifact-delivery.js';

test('published artifact response exposes the final Windows path, including nested references, without invalid JSON escapes',()=>{
 const candidate=String.raw`C:\Users\analyst\报告\.kteam-candidate-A\candidate.html`,target=String.raw`C:\Users\analyst\报告\final.html`;
 const result=JSON.parse(publishedArtifactResult({success:true,path:candidate,files:[{path:candidate}],note:'Open '+candidate,other:String.raw`C:\Users\analyst\unrelated.html`},candidate,target));
 assert.equal(result.path,target);assert.equal(result.files[0].path,target);assert.equal(result.note,'Open '+target);assert.equal(result.other,String.raw`C:\Users\analyst\unrelated.html`);assert.equal(result.success,true);
});

test('published artifact response preserves quoted POSIX paths and unrelated renderer fields',()=>{
 const candidate='/tmp/报告 "draft"/.candidate/candidate.html',target='/tmp/报告 "final"/report.html';
 const result=JSON.parse(publishedArtifactResult({success:true,path:candidate,nested:[candidate,null,42],title:'Keep "quoted" text'},candidate,target));
 assert.equal(result.path,target);assert.deepEqual(result.nested,[target,null,42]);assert.equal(result.title,'Keep "quoted" text');
});
