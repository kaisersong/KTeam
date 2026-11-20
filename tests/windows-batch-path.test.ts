import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

if(process.platform==='win32'){
  const root=fileURLToPath(new URL('../..',import.meta.url));
  const {spawnBatchFile}=await import(pathToFileURL(join(root,'scripts/mobile-install.mjs')).href) as {
    spawnBatchFile:(scriptPath:string,args:string[],options?:{encoding?:BufferEncoding})=>{status:number|null;stdout?:string;error?:Error};
  };
  test('a batch file in a directory containing spaces and & runs as one command',()=>{
    const parent=join(tmpdir(),'kteam space & name');
    const injected=join(tmpdir(),'kteam-cmd-injected.txt');
    rmSync(parent,{recursive:true,force:true});
    rmSync(injected,{force:true});
    mkdirSync(parent,{recursive:true});
    const script=join(parent,'tool.cmd');
    const result=join(parent,'result.txt');
    writeFileSync(script,'@echo off\r\necho %~1>"'+result.replaceAll('"','""')+'"\r\n');
    try{
      const ran=spawnBatchFile(script,['SAFE'],{encoding:'utf8'});
      if(ran.error)throw ran.error;
      assert.equal(ran.status,0);
      assert.equal(readFileSync(result,'utf8').trim(),'SAFE');
      assert.equal(existsSync(injected),false);
    }finally{rmSync(parent,{recursive:true,force:true});rmSync(injected,{force:true});}
  });
}
