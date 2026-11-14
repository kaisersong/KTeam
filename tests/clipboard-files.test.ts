import {test} from 'node:test';import assert from 'node:assert/strict';import {join} from 'node:path';import {writeFileSync,symlinkSync,rmSync} from 'node:fs';import {pathToFileURL} from 'node:url';import {privateTempDir} from './helpers/private-temp.js';import {tmpdir} from 'node:os';
import {clipboardFileURLs,clipboardFileBytes,macClipboardPaths} from '../desktop/clipboard-files.js';
test('clipboard files accept OS file URLs, deduplicate and bound actual bytes; directories and links cannot become uploads',async()=>{const root=privateTempDir(join(tmpdir(),'kteam-clipboard-'));try{const path=join(root,'合成资料.txt');writeFileSync(path,'synthetic');assert.deepEqual(clipboardFileURLs(pathToFileURL(path)+'\n'+pathToFileURL(path)+'\nhttps://example.com'),[path]);assert.deepEqual(await clipboardFileBytes([path]),[{name:'合成资料.txt',data:Buffer.from('synthetic').toString('base64')}]);await assert.rejects(clipboardFileBytes([root]));writeFileSync(join(root,'large'),Buffer.alloc(4*1024*1024+1));await assert.rejects(clipboardFileBytes([join(root,'large')]),/library_file_too_large/);await assert.rejects(clipboardFileBytes(Array(5).fill(path)),/attachment_limit/);if(process.platform!=='win32'){symlinkSync(path,join(root,'link'));await assert.rejects(clipboardFileBytes([join(root,'link')]),/ELOOP/);}}finally{rmSync(root,{recursive:true,force:true});}});
test('macOS Finder clipboard plist preserves multiple copied file paths',{skip:process.platform!=='darwin'},async()=>{assert.deepEqual(await macClipboardPaths(Buffer.from('<?xml version="1.0"?><plist version="1.0"><array><string>/tmp/one.txt</string><string>/tmp/two.png</string></array></plist>')),['/tmp/one.txt','/tmp/two.png']);});

test('async MIME clipboard snapshots preserve copied file precedence, Windows file names and image limits',async()=>{
 const {clipboardAttachments}=await import('../desktop/clipboard-files.js');const root=privateTempDir(join(tmpdir(),'kteam-clipboard-mime-'));
 const item=(values:Record<string,Blob>)=>({types:Object.keys(values),async getType(type:string){return values[type];}});
 try{const path=join(root,'copied.txt');writeFileSync(path,'copied');const expected=[{name:'copied.txt',data:Buffer.from('copied').toString('base64')}];
  assert.deepEqual(await clipboardAttachments([item({'text/uri-list':new Blob([pathToFileURL(path)+'\n'+pathToFileURL(path)]),'image/png':new Blob(['fallback'])})]),expected);
  assert.deepEqual(await clipboardAttachments([item({'electron application/osclipboard;format="FileNameW"':new Blob([Buffer.from(path+'\0','utf16le')])})],'win32'),expected);
  assert.deepEqual(await clipboardAttachments([item({'image/png':new Blob(['image'])})]),[{name:'粘贴图片.png',data:Buffer.from('image').toString('base64')}]);
  assert.deepEqual(await clipboardAttachments([item({'text/plain':new Blob(['ordinary text'])})]),[]);
  await assert.rejects(clipboardAttachments([item({'image/png':new Blob([Buffer.alloc(4*1024*1024+1)])})]),/library_file_too_large/);
  await assert.rejects(clipboardAttachments([{types:['image/png'],async getType(){throw Error('clipboard_changed');}}]),/clipboard_changed/);
 }finally{rmSync(root,{recursive:true,force:true});}
});
