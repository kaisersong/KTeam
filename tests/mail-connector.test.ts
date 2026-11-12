import {privateTempDir as mkdtempSync} from './helpers/private-temp.js';
import {tmpdir} from 'node:os';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {realpathSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {execFileSync,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import tls from 'node:tls';
import {pathToFileURL} from 'node:url';
import {windowsCertificate} from '../src/service/windows-transport.js';

test('mail connection check authenticates real TLS IMAP and SMTP servers without sending email',async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'kteam-mail-'))),key=join(root,'key.pem'),cert=join(root,'cert.pem');const windows=process.platform==='win32'?windowsCertificate():undefined;if(windows)writeFileSync(cert,windows.ca);else execFileSync('/usr/bin/openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=KTeam Fictional Test','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'});
 const commands:string[]=[],sockets=new Set<tls.TLSSocket>(),secure=windows?{pfx:windows.pfx,passphrase:windows.passphrase}:{key:readFileSync(key),cert:readFileSync(cert)};
 const imap=tls.createServer(secure,socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.write('* OK [CAPABILITY IMAP4rev1 AUTH=PLAIN SASL-IR] KTeam fixture\r\n');let buffer='';socket.on('data',bytes=>{buffer+=bytes.toString();while(buffer.includes('\r\n')){const end=buffer.indexOf('\r\n'),line=buffer.slice(0,end);buffer=buffer.slice(end+2);const [tag,raw]=line.split(' '),command=raw?.toUpperCase();commands.push('imap:'+command);if(command==='CAPABILITY')socket.write('* CAPABILITY IMAP4rev1 AUTH=PLAIN SASL-IR\r\n');if(command==='LIST')socket.write('* LIST (\\HasNoChildren) "/" "INBOX"\r\n');if(command==='ID')socket.write('* ID NIL\r\n');if(command==='LOGOUT'){socket.end('* BYE closing\r\n'+tag+' OK logout\r\n');return;}socket.write(tag+' OK completed\r\n');}});});
 const smtp=tls.createServer(secure,socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.write('220 fixture ESMTP\r\n');let buffer='';socket.on('data',bytes=>{buffer+=bytes.toString();while(buffer.includes('\r\n')){const end=buffer.indexOf('\r\n'),line=buffer.slice(0,end);buffer=buffer.slice(end+2);const command=line.split(' ')[0]!.toUpperCase();commands.push('smtp:'+command);if(command==='EHLO')socket.write('250-fixture\r\n250 AUTH PLAIN\r\n');else if(command==='AUTH')socket.write('235 2.7.0 authenticated\r\n');else if(command==='QUIT')socket.end('221 bye\r\n');else socket.write('250 OK\r\n');}});});
 await Promise.all([new Promise<void>(r=>imap.listen(0,'127.0.0.1',r)),new Promise<void>(r=>smtp.listen(0,'127.0.0.1',r))]);
 try{const script=`import {verifyMail} from ${JSON.stringify(pathToFileURL(resolve('dist/src/runtime/mail-connector.js')).href)};await verifyMail(${JSON.stringify({username:'fixture@example.invalid',password:'FICTIONAL_PASSWORD',imapHost:'127.0.0.1',imapPort:(imap.address() as any).port,imapSecure:true,smtpHost:'127.0.0.1',smtpPort:(smtp.address() as any).port,smtpSecure:true})});`;
  await promisify(execFile)(process.execPath,['--input-type=module','-e',script],{timeout:25000,env:{...process.env,NODE_EXTRA_CA_CERTS:cert}});assert(commands.includes('imap:AUTHENTICATE'));assert(commands.includes('imap:NOOP'));assert(commands.includes('smtp:AUTH'));assert(!commands.includes('smtp:MAIL'));assert(!commands.includes('smtp:DATA'));
 }finally{for(const socket of sockets)socket.destroy();await Promise.all([new Promise<void>(r=>imap.close(()=>r())),new Promise<void>(r=>smtp.close(()=>r()))]);rmSync(root,{recursive:true,force:true});}
});
