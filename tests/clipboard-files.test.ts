import {test} from 'node:test';import assert from 'node:assert/strict';import {join} from 'node:path';import {mkdirSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';import {pathToFileURL} from 'node:url';import {privateTempDir} from './helpers/private-temp.js';import {tmpdir} from 'node:os';
import {clipboardFileURLs,clipboardFileBytes,clipboardPaste,macClipboardPaths} from '../desktop/clipboard-files.js';
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

test('copied directories become exact path references, never bytes or a fallback image, including mixed clipboard items',async()=>{
 const root=privateTempDir(join(tmpdir(),'kteam-directory-paste-'));
 const item=(values:Record<string,Blob>)=>({types:Object.keys(values),async getType(type:string){return values[type];}});
 try{const directory=join(root,'中文 目录'),file=join(root,'note.txt');mkdirSync(directory);writeFileSync(join(directory,'private.txt'),'must not be uploaded');writeFileSync(file,'fixture');
 const paste=await clipboardPaste([item({'text/uri-list':new Blob([pathToFileURL(directory)+'\n'+pathToFileURL(directory)]),'image/png':new Blob(['fallback'])})]);assert.deepEqual(paste,{files:[],directories:[directory]});assert.deepEqual(await clipboardPaste([item({'text/uri-list':new Blob([pathToFileURL(directory).href])})],process.platform,false),paste);await assert.rejects(clipboardPaste([item({'text/uri-list':new Blob([pathToFileURL(file).href])})],process.platform,false),/attachment_owner_required/);
 const mixed=await clipboardPaste([item({'text/uri-list':new Blob([pathToFileURL(directory)+'\n'+pathToFileURL(file)])})]);assert.deepEqual(mixed.directories,[directory]);assert.deepEqual(mixed.files,[{name:'note.txt',data:Buffer.from('fixture').toString('base64')}]);assert.ok(!JSON.stringify(mixed).includes('must not be uploaded'));
 assert.deepEqual((await clipboardPaste([item({'electron application/osclipboard;format="FileNameW"':new Blob([Buffer.from(directory+'\0','utf16le')])})],'win32')).directories,[directory]);
 if(process.platform!=='win32'){symlinkSync(directory,join(root,'link-dir'));await assert.rejects(clipboardPaste([item({'text/uri-list':new Blob([pathToFileURL(join(root,'link-dir')).href])})]),/attachment_invalid/);}
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('Finder URI lists preserve more than four directories without consuming attachment slots',async()=>{
 const root=privateTempDir(join(tmpdir(),'kteam-finder-directory-paste-'));
 const uriType='text/uri-list',legacyType='electron application/osclipboard;format="NSFilenamesPboardType"';
 const item=(paths:string[])=>({
  types:[legacyType,uriType],
  async getType(type:string){
   assert.equal(type,uriType,'the Finder legacy format is unnecessary when the URI list is available');
   return new Blob([paths.map(path=>pathToFileURL(path).href).join('\r\n')]);
  }
 });
 try{
  const directories=Array.from({length:6},(_,index)=>join(root,`目录 ${index} #`));
  for(const directory of directories)mkdirSync(directory);
  const files=Array.from({length:5},(_,index)=>join(root,`附件 ${index}.txt`));
  for(const file of files)writeFileSync(file,'fixture');

  assert.deepEqual(await clipboardPaste([item([...directories,directories[0]!])],'darwin',false),{directories,files:[]});
  const mixed=await clipboardPaste([item([...directories,...files.slice(0,4)])],'darwin');
  assert.deepEqual(mixed.directories,directories);
  assert.equal(mixed.files.length,4);
  await assert.rejects(clipboardPaste([item([...directories,...files])],'darwin'),{code:'attachment_limit'});
 }finally{rmSync(root,{recursive:true,force:true});}
});
