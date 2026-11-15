import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {visibleInputReceipts,pendingAttachmentSends} from '../desktop/renderer/src/receipt-visibility.js';
test('resolved work-input receipts leave the composer while live and review-needed ones stay',()=>{
 const receipts=[
  {id:'a',status:'completed'},
  {id:'b',status:'queued',queuedState:'delivered'},
  {id:'c',status:'queued',queuedState:'noop'},
  {id:'d',status:'queued',queuedState:'blocked'},
  {id:'e',status:'queued',queuedState:'unknown'},
  {id:'f',status:'queued',queuedState:'stopped'},
  {id:'g',status:'queued',queuedState:'queued'},
  {id:'h',status:'queued',queuedState:'held'},
  {id:'i',status:'queued',queuedState:'waiting'},
  {id:'j',status:'queued'},
  {id:'k',status:'preparing'},
  {id:'l',status:'waiting_boundary'},
  {id:'m',status:'staged'},
  {id:'n',status:'injected'},
  {id:'o',status:'needs_review'},
 ];
 assert.deepEqual(visibleInputReceipts(receipts).map(item=>item.id),['g','h','i','j','k','l','m','n','o']);
 assert.deepEqual(visibleInputReceipts([]),[]);
});
test('only attachment sends that still need reconciliation stay visible',()=>{
 const sends=[{id:'a',status:'complete'},{id:'b',status:'cancelled'},{id:'c',status:'registering_files'},{id:'d',status:'message_sending'}];
 assert.deepEqual(pendingAttachmentSends(sends).map(send=>send.id),['c','d']);
 assert.deepEqual(pendingAttachmentSends([]),[]);
});
test('composer previews use CSP-allowed data URLs and both receipt filters are wired into the components',()=>{
 const attachments=readFileSync(new URL('../../desktop/renderer/src/composer-attachments.tsx',import.meta.url),'utf8');
 assert.ok(attachments.includes('pendingAttachmentSends(receipts[currentRoom]??[])'));
 assert.ok(attachments.includes("'data:'+imageMime(row.name)+';base64,'"));
 assert.ok(!attachments.includes('createObjectURL'));
 const workInputs=readFileSync(new URL('../../desktop/renderer/src/work-inputs.tsx',import.meta.url),'utf8');
 assert.ok(workInputs.includes('visibleInputReceipts(receipts)'));
 const html=readFileSync(new URL('../../desktop/renderer/index.html',import.meta.url),'utf8');
 assert.ok(/img-src 'self' data:/.test(html));
});
