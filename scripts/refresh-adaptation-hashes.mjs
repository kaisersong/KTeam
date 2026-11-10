// Refresh only KTeam-owned build seams; upstream pins and vendored hashes stay fixed.
import {readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const path = join(root, 'sources.lock.json');
const lock = JSON.parse(readFileSync(path, 'utf8'));
for (const entry of lock.runtime.adaptations.files) {
  entry.sha256 = createHash('sha256').update(readFileSync(join(root, entry.file))).digest('hex');
}
writeFileSync(path, JSON.stringify(lock, null, 2) + '\n');
