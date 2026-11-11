import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

// Windows bsdtar cannot reliably read a Node spawnSync pipe. Use a private
// archive file with explicit -f, and the platform tar executable on PATH.
export function extractPinnedArchive(archive,target){
 const temporary=mkdtempSync(join(tmpdir(),'kteam-source-archive-'));
 try{const file=join(temporary,'source.tar');writeFileSync(file,archive,{mode:0o600});execFileSync('tar',['-xf',file,'-C',target],{stdio:'inherit'});}
 finally{rmSync(temporary,{recursive:true,force:true});}
}
