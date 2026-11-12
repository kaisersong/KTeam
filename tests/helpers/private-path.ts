import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {statSync} from 'node:fs';
/** Windows: the DACL is protected (no inheritance) and grants only the current user, SYSTEM and Administrators. */
export function assertWindowsPrivate(path:string){
 const out=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','$a=Get-Acl -LiteralPath $env:T; "protected=$($a.AreAccessRulesProtected)"; $a.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]) | ForEach-Object { $_.IdentityReference.Value }; "me=$([System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value)"'],{env:{...process.env,T:path},encoding:'utf8',stdio:['ignore','pipe','pipe']});
 const lines=out.trim().split(/\r?\n/),me=lines.at(-1)!.slice(3);
 assert.equal(lines[0],'protected=True',path);
 assert.deepEqual([...new Set(lines.slice(1,-1))].sort(),[me,'S-1-5-18','S-1-5-32-544'].sort(),path);
}
/** A private credential path: POSIX mode bits; on Windows (which has no mode bits) the equivalent DACL. */
export function assertPrivatePath(path:string,mode:number){
 if(process.platform==='win32'){assertWindowsPrivate(path);return;}
 assert.equal(statSync(path).mode&0o777,mode,path);
}
