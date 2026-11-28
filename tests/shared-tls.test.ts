import assert from 'node:assert/strict';
import {X509Certificate} from 'node:crypto';
import {test} from 'node:test';
import {assertSharedCertificate,certificateDigest,createSharedTLS,sharedHost} from '../src/service/shared-tls.js';

test('共享 TLS 使用 IPv6 字面地址生成并验证 IP SAN',()=>{
 const endpoint='https://[FD12:0:0:0:0:ABCD:0:1]:9443';
 const host=sharedHost(endpoint);
 assert.equal(host,'fd12::abcd:0:1');
 const certificate=new X509Certificate(createSharedTLS(endpoint).certificate);
 assert.ok(certificate.checkIP('fd12:0:0:0:0:abcd:0:1'));
 const trust={endpoint,coordinatorId:'',publicKey:'',certificateSha256:certificateDigest(certificate)};
 assert.doesNotThrow(()=>assertSharedCertificate(certificate,trust));
 assert.throws(()=>assertSharedCertificate(certificate,{...trust,endpoint:'https://[fd12::abcd:0:2]:9443'}),
  {code:'shared_certificate_mismatch'});
});
