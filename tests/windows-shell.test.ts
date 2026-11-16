import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readOnlyWindowsShell,windowsWorkingPaths} from '../src/service/windows-shell.js';

const sample=String.raw`cd /d C:\Users\song\kteam-src && echo ===CHCP=== & findstr /s /n /i "chcp" src\*.ts & echo ===CRASH=== & findstr /s /n /i "crashReporter minidump" src\*.ts & echo ===UPDATER=== & findstr /s /n /i "autoUpdater electron-updater" src\*.ts & echo ===LONGPATH=== & findstr /s /n /i "longPath \\\\?\\" src\*.ts & echo ===END===`;
test('Windows diagnostic query uses cd /d target, retains literal backslashes and is read-only',()=>{
 assert.deepEqual(windowsWorkingPaths(sample,String.raw`C:\Users\song`),[String.raw`C:\Users\song\kteam-src`]);
 assert.equal(readOnlyWindowsShell(sample,()=>true),true);
 assert.equal(readOnlyWindowsShell(sample,word=>!word.includes('src')),false);
 assert.equal(readOnlyWindowsShell(String.raw`findstr /s "needle" src\*.ts 2>nul`,()=>true),true);
 assert.deepEqual(windowsWorkingPaths(String.raw`cd /d C:\project && tool > proof.txt 2>&1`,String.raw`C:\Users\song`),[String.raw`C:\project`,String.raw`C:\project\proof.txt`]);
});
test('Windows directory inspection rejects expansion and tracks outside paths and redirects',()=>{
 for(const command of ['cd /d %USERPROFILE% & node script.js','cd /d !TARGET! & node script.js','echo ok ^& del file','(echo ok & del file)','call script.cmd','cmd /c del file','cd D:\\other & node script.js'])assert.equal(windowsWorkingPaths(command,String.raw`C:\project`),undefined,command);
 assert.deepEqual(windowsWorkingPaths(String.raw`cd /d "C:\project" && node script.js > D:\outside\proof.txt`,String.raw`C:\Users\song`),[String.raw`C:\project`,String.raw`D:\outside\proof.txt`]);
 assert.deepEqual(windowsWorkingPaths(String.raw`findstr pattern ..\other\*.ts`,String.raw`C:\project`),[String.raw`C:\project`,String.raw`C:\other`]);
 assert.deepEqual(windowsWorkingPaths(`node -e "console.log('changed')"`,String.raw`C:\project`),[String.raw`C:\project`]);
 assert.deepEqual(windowsWorkingPaths(String.raw`tool sub\..\..\outside\proof.txt`,String.raw`C:\project`),[String.raw`C:\project`,String.raw`C:\outside\proof.txt`]);
 for(const command of [String.raw`tool C:..\outside`,String.raw`tool > C:..\outside`,String.raw`tool \\?\C:\outside`])assert.equal(windowsWorkingPaths(command,String.raw`C:\project`),undefined);
 for(const command of ['del file','echo ok > proof.txt','node script.js','findstr pattern file & del file','echo "unclosed'])assert.equal(readOnlyWindowsShell(command,()=>true),false,command);
});
