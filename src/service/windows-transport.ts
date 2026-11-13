import https from 'node:https';
import {checkServerIdentity} from 'node:tls';
import http from 'node:http';
import {join} from 'node:path';
import {writeFileSync,renameSync,unlinkSync,lstatSync,existsSync} from 'node:fs';
import {randomUUID,X509Certificate} from 'node:crypto';
import {privateRead,socketPath} from './config.js';
import {KTeamError} from '../errors.js';
import {parseDataJson} from '../protocol/json.js';
import {windowsPowerShell} from './windows-security.js';

// This ephemeral, per-host trust anchor is never installed in an OS certificate store.
// BoringSSL (Electron) requires CA basic constraints and certificate-signing key usage,
// even though Node/OpenSSL also accepts the old self-signed leaf as an explicit CA.
const certificateScript=String.raw`
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
$rsa=New-Object System.Security.Cryptography.RSACryptoServiceProvider(2048)
$rsa.PersistKeyInCsp=$false
try {
 $request=New-Object System.Security.Cryptography.X509Certificates.CertificateRequest('CN=localhost',$rsa,[System.Security.Cryptography.HashAlgorithmName]::SHA256,[System.Security.Cryptography.RSASignaturePadding]::Pkcs1)
 $request.CertificateExtensions.Add((New-Object System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension($true,$true,0,$true)))
 $request.CertificateExtensions.Add((New-Object System.Security.Cryptography.X509Certificates.X509KeyUsageExtension(([System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyCertSign -bor [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature -bor [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyEncipherment),$true)))
 $eku=New-Object System.Security.Cryptography.OidCollection
 [void]$eku.Add((New-Object System.Security.Cryptography.Oid('1.3.6.1.5.5.7.3.1')))
 $request.CertificateExtensions.Add((New-Object System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension($eku,$false)))
 [byte[]]$san=0x30,0x11,0x82,0x09,0x6c,0x6f,0x63,0x61,0x6c,0x68,0x6f,0x73,0x74,0x87,0x04,0x7f,0,0,1
 $request.CertificateExtensions.Add((New-Object System.Security.Cryptography.X509Certificates.X509Extension('2.5.29.17',$san,$false)))
 $cert=$request.CreateSelfSigned([DateTimeOffset]::UtcNow.AddMinutes(-5),[DateTimeOffset]::UtcNow.AddDays(30))
 try {
  $password=[Guid]::NewGuid().ToString('N')+[Guid]::NewGuid().ToString('N')
  $result=@{pfx=[Convert]::ToBase64String($cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Pfx,$password));password=$password;certificate=[Convert]::ToBase64String($cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert))}
  [Console]::Write(($result|ConvertTo-Json -Compress))
 } finally {$cert.Dispose()}
} finally {$rsa.Dispose()}
`;
export const windowsEndpointPath=(root:string)=>join(root,'host-endpoint.json');
export function windowsCertificate(){
 try{const data=JSON.parse(windowsPowerShell(certificateScript));const cert=new X509Certificate(Buffer.from(data.certificate,'base64'));return {pfx:Buffer.from(data.pfx,'base64'),passphrase:String(data.password),ca:cert.toString()};}catch{throw new KTeamError('windows_tls_unavailable',503);}
}
export function publishWindowsEndpoint(root:string,port:number,ca:string,epoch:number){
 const path=windowsEndpointPath(root),temporary=path+'.'+randomUUID();
 if(existsSync(path)&&!lstatSync(path).isFile())throw new KTeamError('host_endpoint_occupied');
 try{writeFileSync(temporary,JSON.stringify({version:1,port,ca,epoch}),{flag:'wx',mode:0o600});renameSync(temporary,path);}finally{if(existsSync(temporary))unlinkSync(temporary);}
}
export function readWindowsEndpoint(root:string){
 const value=parseDataJson(privateRead(windowsEndpointPath(root)),64*1024) as any;
 if(!value||Object.keys(value).some(key=>!['version','port','ca','epoch'].includes(key))||value.version!==1||!Number.isInteger(value.port)||value.port<1||value.port>65535||!Number.isSafeInteger(value.epoch)||value.epoch<1||typeof value.ca!=='string'||Buffer.byteLength(value.ca)>16384)throw new KTeamError('host_endpoint_invalid');
 try{new X509Certificate(value.ca);}catch{throw new KTeamError('host_endpoint_invalid');}
 return value as {version:1;port:number;ca:string;epoch:number};
}
/** No plaintext token is sent to a Windows local listener without pinned TLS verification. */
export function localRequest(root:string,options:http.RequestOptions,callback:(response:http.IncomingMessage)=>void){
 if(process.platform==='win32'){const endpoint=readWindowsEndpoint(root);return https.request({...options,host:'127.0.0.1',hostname:'127.0.0.1',port:endpoint.port,socketPath:undefined,createConnection:undefined,ca:endpoint.ca,servername:'localhost',checkServerIdentity,rejectUnauthorized:true,minVersion:'TLSv1.2',agent:false},callback);}
 return http.request({...options,socketPath:socketPath(root),agent:false},callback);
}
