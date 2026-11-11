import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

// Windows bsdtar cannot reliably read a Node spawnSync pipe. Use a private
// archive file with explicit -f. Git Bash tar interprets a C: path as a remote
// host, so Windows uses its native bsdtar rather than a PATH-selected GNU tar.
export function extractPinnedArchive(archive,target){
 const temporary=mkdtempSync(join(tmpdir(),'kteam-source-archive-'));
 try{const file=join(temporary,'source.tar');writeFileSync(file,archive,{mode:0o600});const tar=process.platform==='win32'?join(process.env.SystemRoot??'C:\\Windows','System32','tar.exe'):'tar';execFileSync(tar,['-xf',file,'-C',target],{stdio:'inherit'});}
 finally{rmSync(temporary,{recursive:true,force:true});}
}
