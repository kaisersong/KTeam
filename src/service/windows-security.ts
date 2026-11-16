import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {lstatSync} from 'node:fs';
import {KTeamError} from '../errors.js';

const powershell=()=>join(process.env.SystemRoot??'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
export function windowsPowerShell(script:string,input?:unknown){
 return execFileSync(powershell(),['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{input:input===undefined?undefined:JSON.stringify(input),encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:256*1024,stdio:['pipe','pipe','pipe']}).replace(/^\uFEFF/,'').trim();
}
const aclScript=String.raw`
$ErrorActionPreference='Stop'
[Console]::InputEncoding=New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
$payload=[Console]::In.ReadToEnd()|ConvertFrom-Json
$index=0
foreach($v in $payload.entries) { try {
$identity=[System.Security.Principal.WindowsIdentity]::GetCurrent()
if($v.create -and -not [System.IO.Directory]::Exists($v.path)) {
 $security=New-Object System.Security.AccessControl.DirectorySecurity
 $security.SetOwner($identity.User)
 $security.SetAccessRuleProtection($true,$false)
 $rule=New-Object System.Security.AccessControl.FileSystemAccessRule($identity.User,[System.Security.AccessControl.FileSystemRights]::FullControl,([System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit),[System.Security.AccessControl.PropagationFlags]::None,[System.Security.AccessControl.AccessControlType]::Allow)
 $security.AddAccessRule($rule)
 [void][System.IO.Directory]::CreateDirectory($v.path,$security)
}
$acl=Get-Acl -LiteralPath $v.path
$raw=New-Object System.Security.AccessControl.RawSecurityDescriptor($acl.GetSecurityDescriptorBinaryForm(),0)
if($null -eq $raw.DiscretionaryAcl){throw 'private_acl_required'}
$trusted=@($identity.User.Value,'S-1-5-18','S-1-5-32-544')
$readOnlyRights=[System.Security.AccessControl.FileSystemRights]::ReadAndExecute -bor [System.Security.AccessControl.FileSystemRights]::Synchronize
if($trusted -notcontains $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value){throw 'private_owner_required'}
foreach($rule in $acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])) {
 if($rule.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow -and -not ($rule.PropagationFlags -band [System.Security.AccessControl.PropagationFlags]::InheritOnly) -and $trusted -notcontains $rule.IdentityReference.Value){
  if(-not $v.allowReaders -or ($rule.FileSystemRights -band (-bnot $readOnlyRights)) -ne 0){throw 'private_acl_required'}
 }
}
} catch {[Console]::Write('{"failed":'+$index+'}');exit 0};$index++
}
[Console]::Write('{"ok":true}')
`;
const checked=new Map<string,string>();
const identity=(path:string)=>{const s=lstatSync(path,{bigint:true});return [s.dev,s.ino,s.nlink,s.size,s.mtimeNs,s.ctimeNs,s.mode].join(':');};
/** NTFS change time invalidates this cache; real Windows tests must cover ACL changes. */
type AclEntry={path:string;directory:boolean;create?:boolean;allowReaders?:boolean};
function assertWindowsAccess(entries:AclEntry[]){
 // Journal creation changes directory timestamps without changing its ACL. A live
 // ACL proof remains valid for the same directory identity, but must not be cached
 // under metadata that changed during inspection. Files still require stable bytes.
 for(let attempt=0;attempt<3;attempt++){
  const pending=entries.flatMap(entry=>{const cacheKey=entry.path+(entry.allowReaders?'|import-readers':'|private');let before:string|undefined;try{before=identity(entry.path);if(checked.get(cacheKey)===before)return [];}catch{if(!entry.create)throw new KTeamError(entry.directory?'private_directory_required':'private_file_required');}return [{...entry,before,cacheKey}];});
  if(!pending.length)return;
  let result:any;try{result=JSON.parse(windowsPowerShell(aclScript,{entries:pending}));}catch{throw new KTeamError(pending[0]!.directory?'private_directory_required':'private_file_required');}
  if(result?.ok!==true){const failed=pending[result?.failed]??pending[0]!;throw new KTeamError(failed.directory?'private_directory_required':'private_file_required');}
  const observed=pending.map(entry=>({...entry,after:identity(entry.path)})),changed=observed.find(entry=>entry.before!==undefined&&entry.before!==entry.after&&(!entry.directory||entry.before.split(':').slice(0,2).join(':')!==entry.after.split(':').slice(0,2).join(':')));
  if(changed){if(attempt<2)continue;throw new KTeamError(changed.directory?'private_directory_required':'private_file_required');}
  if(checked.size+pending.length>=4096)checked.clear();
  for(const entry of observed)if(entry.before===undefined||entry.before===entry.after)checked.set(entry.cacheKey,entry.after);else checked.delete(entry.cacheKey);
  return;
 }
}

export function assertWindowsPrivateMany(entries:{path:string;directory:boolean;create?:boolean}[]){assertWindowsAccess(entries);}
/** Explicit external import: trusted owner, regular file, no foreign writes; read-only grants are allowed. */
export function assertWindowsImportSource(path:string){assertWindowsAccess([{path,directory:false,allowReaders:true}]);}

export function assertWindowsPrivate(path:string,directory:boolean,create=false){assertWindowsPrivateMany([{path,directory,create}]);}
