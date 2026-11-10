import { readFileSync, existsSync, lstatSync, readlinkSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const lock = JSON.parse(readFileSync(join(root, 'sources.lock.json'), 'utf8'));
// The design docs live in the separate mydocs checkout. Build and tests never read them;
// when the docs link is present it must still point at mydocs/kteam and match the pinned digests.
const docs = join(root, 'docs');
const docsLinked = (() => { try { lstatSync(docs); } catch { return false; } return existsSync(docs); })();
if (docsLinked && (!lstatSync(docs).isSymbolicLink() || readlinkSync(docs) !== '../mydocs/kteam'
  || realpathSync(docs) !== realpathSync(resolve(root, '..', 'mydocs', 'kteam')))) {
  throw new Error('docs_must_link_to_mydocs_kteam');
}
const isDoc = entry => entry.file.startsWith('docs/');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
let verified = 0, documentation = 0;
for (const entry of [...lock.vendoredFiles, ...lock.references, lock.productBaseline]) {
  if (isDoc(entry) && !docsLinked) continue;
  if (hash(readFileSync(join(root, entry.file))) !== entry.sha256) throw new Error('source_digest_mismatch:' + entry.file);
  verified++;
  if (isDoc(entry)) documentation++;
}
for (const source of lock.sources) {
  // Isolated frozen checkouts keep validation independent from active sibling development.
  const path = resolve(process.env.KTEAM_UPSTREAM_ROOT ?? resolve(root, '..'), source.name);
  if (!existsSync(join(path, '.git'))) {
    throw new Error('test_source_missing:' + source.name);
  }
  const revision = execFileSync('git', ['-C', path, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (revision !== source.revision) throw new Error('source_revision_mismatch:' + source.name);
  {
    const dirty = execFileSync('git', ['-C', path, 'status', '--porcelain'], { encoding: 'utf8' }).trim();
    if (dirty) throw new Error('integration_source_dirty:' + source.name);
  }
  for (const entry of lock.vendoredFiles.filter(file => file.source === source.name)) {
    const bytes = execFileSync('git', ['-C', path, 'show', source.revision + ':' + entry.upstreamPath]);
    if (hash(bytes) !== entry.sha256) throw new Error('upstream_copy_mismatch:' + entry.file);
  }
}
console.log(JSON.stringify({ ok: true, verifiedFiles: verified, documentation: docsLinked ? documentation : 'not_linked', upstreams: lock.sources.map(s => ({ name: s.name, revision: s.revision })) }));
