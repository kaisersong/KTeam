import { readFileSync, existsSync, lstatSync, readlinkSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const lock = JSON.parse(readFileSync(join(root, 'sources.lock.json'), 'utf8'));
const docs = join(root, 'docs');
if (!lstatSync(docs).isSymbolicLink() || readlinkSync(docs) !== '../mydocs/kteam'
  || realpathSync(docs) !== realpathSync(resolve(root, '..', 'mydocs', 'kteam'))) {
  throw new Error('docs_must_link_to_mydocs_kteam');
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
let verified = 0;
for (const entry of [...lock.vendoredFiles, ...lock.references, lock.productBaseline]) {
  if (hash(readFileSync(join(root, entry.file))) !== entry.sha256) throw new Error('source_digest_mismatch:' + entry.file);
  verified++;
}
for (const source of lock.sources) {
  const path = resolve(root, '..', source.name);
  if (!existsSync(join(path, '.git'))) {
    if (source.name === 'xiaok-cli') continue; // Vendored contracts are self-contained.
    throw new Error('test_source_missing:' + source.name);
  }
  const revision = execFileSync('git', ['-C', path, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (revision !== source.revision) throw new Error('source_revision_mismatch:' + source.name);
  if (source.name !== 'xiaok-cli') {
    const dirty = execFileSync('git', ['-C', path, 'status', '--porcelain'], { encoding: 'utf8' }).trim();
    if (dirty) throw new Error('integration_source_dirty:' + source.name);
  }
  for (const entry of lock.vendoredFiles.filter(file => file.source === source.name)) {
    const bytes = execFileSync('git', ['-C', path, 'show', source.revision + ':' + entry.upstreamPath]);
    if (hash(bytes) !== entry.sha256) throw new Error('upstream_copy_mismatch:' + entry.file);
  }
}
console.log(JSON.stringify({ ok: true, verifiedFiles: verified, upstreams: lock.sources.map(s => ({ name: s.name, revision: s.revision })) }));
