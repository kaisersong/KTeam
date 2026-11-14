import { randomUUID } from 'node:crypto';
import { Failure, requireValue } from './errors.mjs';
import { digest, validatePackage, safePath } from './package.mjs';

const viewSpace = s => ({ id: s.id, title: s.title, status: s.status, revision: s.revision, draftVersionId: s.draftVersionId, activeReleaseId: s.activeReleaseId });
const viewVersion = v => ({ id: v.id, spaceId: v.spaceId, status: v.status, entry: v.entry, totalBytes: v.total, createdAt: v.createdAt });
const account = (s, id, limits) => s.accounts[id] ??= { id, requests: 0, used: 0, reserved: 0, stored: 0, storageReserved: 0, ...limits };
function own(s, owner, id) { const space = s.spaces[id]; requireValue(space && space.owner === owner && space.status !== 'deleted', 'space_not_found', 404); return space; }
function revision(space, expected) { requireValue(Number.isSafeInteger(expected) && expected === space.revision, 'revision_conflict', 409); }
function idempotency(s, owner, op, key, fingerprint) {
  requireValue(typeof key === 'string' && key.length >= 8 && key.length <= 128, 'idempotency_key_required');
  const id = digest(`${owner}\0${op}\0${key}`); const existing = s.operations[id];
  if (existing) requireValue(existing.fingerprint === fingerprint, 'idempotency_conflict', 409);
  requireValue(Object.keys(s.operations).length < 4096 || existing, 'prototype_capacity', 503);
  return { id, existing };
}
export class SpaceService {
  constructor({ state, blobs, limits = {} }) {
    this.state = state; this.blobs = blobs;
    this.limits = { requestLimit: 1000, byteLimit: 1024 * 1024, storageLimit: 50 * 1024 * 1024, spaceLimit: 3, ...limits };
    this.globalLimits = { requestLimit: 100000, byteLimit: 100 * 1024 * 1024, storageLimit: 500 * 1024 * 1024, spaceLimit: 100 };
  }
  async create(owner, title, key) {
    requireValue(typeof title === 'string' && title.trim().length > 0 && title.length <= 100, 'invalid_title');
    const id = randomUUID(), fingerprint = digest(title.trim());
    return this.state.change(s => {
      const op = idempotency(s, owner, 'create', key, fingerprint);
      if (op.existing) return viewSpace(own(s, owner, op.existing.spaceId));
      requireValue(Object.values(s.spaces).filter(x => x.owner === owner && x.status !== 'deleted').length < this.limits.spaceLimit, 'space_quota', 429);
      requireValue(Object.keys(s.spaces).length < 100, 'prototype_capacity', 503);
      const space = { id, owner, title: title.trim(), status: 'draft', revision: 0, draftVersionId: null, activeReleaseId: null };
      s.spaces[id] = space; account(s, owner, this.limits); account(s, '@global', this.globalLimits);
      s.operations[op.id] = { spaceId: id, fingerprint }; return viewSpace(space);
    });
  }
  async list(owner) { return Object.values((await this.state.load()).state.spaces).filter(s => s.owner === owner && s.status !== 'deleted').map(viewSpace); }
  async read(owner, id) {
    const { state: s } = await this.state.load(); const space = own(s, owner, id);
    return { ...viewSpace(space), versions: Object.values(s.versions).filter(v => v.spaceId === id).map(viewVersion), releases: Object.values(s.releases).filter(r => r.spaceId === id) };
  }
  async quota(owner) { return account((await this.state.load()).state, owner, this.limits); }
  async operation(owner, kind, spaceId, key) {
    requireValue(['create', 'upload', 'publish', 'rollback', 'unpublish'].includes(kind), 'invalid_operation');
    requireValue(typeof key === 'string' && key.length >= 8 && key.length <= 128, 'invalid_operation');
    const { state: s } = await this.state.load();
    if (kind !== 'create') own(s, owner, spaceId);
    const scope = kind === 'create' ? kind : `${kind}:${spaceId}`;
    const op = s.operations[digest(`${owner}\0${scope}\0${key}`)];
    if (!op) return { status: 'unknown' }; // A missing receipt is not proof that an in-flight write failed.
    if (kind === 'upload') return { status: s.versions[op.versionId]?.status === 'ready' ? 'complete' : 'pending', versionId: op.versionId };
    if (kind === 'create') return { status: 'complete', spaceId: op.spaceId };
    return { status: 'complete' };
  }
  async upload(owner, id, input, expectedRevision, key) {
    const pkg = validatePackage(input); const versionId = randomUUID();
    const prepared = await this.state.change(s => {
      const space = own(s, owner, id); const op = idempotency(s, owner, `upload:${id}`, key, pkg.fingerprint);
      if (op.existing) return s.versions[op.existing.versionId];
      revision(space, expectedRevision);
      for (const q of [account(s, owner, this.limits), account(s, '@global', this.globalLimits)]) {
        requireValue(q.stored + q.storageReserved + pkg.total <= q.storageLimit, 'storage_quota', 429);
        q.storageReserved += pkg.total;
      }
      const version = { id: versionId, spaceId: id, owner, status: 'pending', entry: pkg.entry, total: pkg.total, manifest: pkg.manifest, scriptHashes: pkg.scriptHashes, createdAt: new Date().toISOString() };
      s.versions[versionId] = version; s.operations[op.id] = { versionId, fingerprint: pkg.fingerprint }; return version;
    });
    if (prepared.status === 'ready') return viewVersion(prepared);
    // Pending + reserved bytes are durable. Same-key retry safely resumes sealed content.
    for (const file of pkg.files) await this.blobs.put(`${id}/${prepared.id}/${file.sha256}`, file.bytes, file.type);
    return this.state.change(s => {
      const space = own(s, owner, id); const v = s.versions[prepared.id];
      if (v.status === 'ready') return viewVersion(v);
      requireValue(v.status === 'pending', 'version_conflict', 409);
      v.status = 'ready';
      for (const q of [s.accounts[owner], s.accounts['@global']]) { q.storageReserved -= v.total; q.stored += v.total; }
      // A concurrent upload may finish first. Keep both versions without silently replacing its draft.
      if (space.revision === expectedRevision) { space.draftVersionId = v.id; space.revision++; }
      return viewVersion(v);
    });
  }
  async publish(owner, id, targetVersion, expectedRevision, key, rollback = false) {
    const initial = (await this.state.load()).state; const current = own(initial, owner, id);
    const fingerprint = digest(JSON.stringify({ targetVersion, expectedRevision }));
    const preflight = idempotency(initial, owner, `${rollback ? 'rollback' : 'publish'}:${id}`, key, fingerprint);
    if (preflight.existing) return preflight.existing.result;
    revision(current, expectedRevision);
    const candidateId = rollback ? initial.releases[targetVersion]?.versionId : targetVersion;
    const candidate = initial.versions[candidateId];
    requireValue(candidate?.spaceId === id && candidate.status === 'ready', 'version_not_found', 404);
    // Verify the sealed package before activation; expectedRevision is checked again atomically.
    for (const file of candidate.manifest) await this.materialize({ key: `${id}/${candidate.id}/${file.sha256}`, file });
    const releaseId = randomUUID();
    return this.state.change(s => {
      const space = own(s, owner, id);
      const op = idempotency(s, owner, `${rollback ? 'rollback' : 'publish'}:${id}`, key, fingerprint);
      if (op.existing) return op.existing.result;
      revision(space, expectedRevision);
      const versionId = rollback ? s.releases[targetVersion]?.versionId : targetVersion;
      const v = s.versions[versionId]; requireValue(v && v.spaceId === id && v.status === 'ready', 'version_not_found', 404);
      const release = { id: releaseId, spaceId: id, versionId, createdAt: new Date().toISOString() };
      s.releases[releaseId] = release; space.activeReleaseId = releaseId; space.status = 'published'; space.revision++;
      const result = { space: viewSpace(space), release }; s.operations[op.id] = { fingerprint, result }; return result;
    });
  }
  async unpublish(owner, id, expectedRevision, key) {
    return this.state.change(s => {
      const space = own(s, owner, id); const op = idempotency(s, owner, `unpublish:${id}`, key, digest(String(expectedRevision)));
      if (op.existing) return op.existing.result;
      revision(space, expectedRevision); space.status = 'unpublished'; space.revision++;
      const result = viewSpace(space); s.operations[op.id] = { fingerprint: digest(String(expectedRevision)), result }; return result;
    });
  }
  async admit(id, requestedPath, head) {
    const holdId = randomUUID();
    return this.state.change(s => {
      const space = s.spaces[id]; requireValue(space?.status === 'published', 'not_found', 404);
      const release = s.releases[space.activeReleaseId], version = s.versions[release.versionId];
      const path = safePath(requestedPath || version.entry); const file = version.manifest.find(f => f.path === path);
      requireValue(file, 'not_found', 404); const amount = head ? 0 : file.size;
      requireValue(Object.keys(s.holds).length < 10000, 'prototype_capacity', 503);
      const accounts = [s.accounts[space.owner], s.accounts['@global']];
      for (const q of accounts) { requireValue(q.requests < q.requestLimit && q.used + q.reserved + amount <= q.byteLimit, 'traffic_quota', 429); q.requests++; q.reserved += amount; }
      s.holds[holdId] = { id: holdId, owner: space.owner, spaceId: id, versionId: version.id, amount, state: 'reserved', actual: 0, createdAt: new Date().toISOString() };
      return { holdId, file, key: `${id}/${version.id}/${file.sha256}`, scriptHashes: version.scriptHashes };
    });
  }
  async settle(holdId, actual) {
    return this.state.change(s => {
      const hold = s.holds[holdId]; requireValue(hold, 'hold_not_found', 404);
      if (hold.state === 'closed') return false;
      requireValue(Number.isSafeInteger(actual) && actual >= 0 && actual <= hold.amount, 'invalid_settlement');
      for (const q of [s.accounts[hold.owner], s.accounts['@global']]) { q.reserved -= hold.amount; q.used += actual; }
      hold.state = 'closed'; hold.actual = actual; return true;
    });
  }
  async materialize(admission) {
    const bytes = await this.blobs.get(admission.key);
    if (bytes.length !== admission.file.size || digest(bytes) !== admission.file.sha256) throw new Failure('content_integrity_failed', 503);
    return bytes;
  }
}
