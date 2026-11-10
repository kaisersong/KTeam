import { AsyncLocalStorage } from 'node:async_hooks';
import { readFile } from 'node:fs/promises';
import { types } from 'node:util';
import { resolve } from 'node:path';
import {
  createRoomTurnCustody,
  type RoomTurnCustody,
} from './original-room-turn-custody.js';
import {
  createIntrinsicSet,
  settleIntrinsicOperations,
} from '../../src/runtime/verification/intrinsic-async-collection.js';
import { assertStandardIpcPromise } from '../../src/runtime/verification/native-ipc-promise.js';
import { readCurrentOriginalRootExecutionContext } from '../../src/runtime/verification/original-root-execution-context.js';
import { hasOriginalMainSdkBridgeInstallation } from '../../src/runtime/verification/original-main-sdk-bridge.js';
import { readCurrentOriginalTaskRunnerResourceContext } from '../../src/runtime/task-host/task-runtime-host.js';
import {
  readOriginalMainDshControlSourceBinding,
  readOriginalMainMaterialEvent,
  type MainMaterialEventView,
} from './main-dsh-control-source.js';
import {
  readOriginalKnowledgeSourceReceipt,
  type OriginalKnowledgeSourceReceipt,
} from './kb-store-sqlite.js';
import { readOriginalKnowledgeExtractorBinding } from './kb-source-extractor.js';
import type { SourceExtractionResult } from './kb-store.js';
const apply = Reflect.apply,
  get = WeakMap.prototype.get,
  set = WeakMap.prototype.set,
  descriptor = Object.getOwnPropertyDescriptor,
  keys = Reflect.ownKeys,
  own = Object.hasOwn;
const freeze = Object.freeze,
  create = Object.create,
  define = Object.defineProperty,
  NativePromise = Promise,
  then = Promise.prototype.then;
const isProxy = types.isProxy,
  isPromise = types.isPromise,
  buffer = Buffer.isBuffer,
  originalReadFile = readFile;
const scope = new AsyncLocalStorage<object>(),
  scopeGet = AsyncLocalStorage.prototype.getStore,
  scopeRun = AsyncLocalStorage.prototype.run;
const sources = new WeakMap<object, SourceRow>(),
  requests = new WeakMap<object, RequestRow>();
const births = new WeakMap<object, WeakMap<object, Promise<object>>>();
const retainedFailures = createIntrinsicSet<object>();
interface ServicesBinding {
  storageScope: Readonly<{ profileId: string; workspaceId: string }>;
  principalId: string;
  parseOfficeDocument: Function;
}
interface SourceRow {
  userSource: object;
  services: object;
  binding: ServicesBinding;
  custody: RoomTurnCustody;
  active: ReturnType<typeof createIntrinsicSet<RequestRow>>;
  used: WeakMap<
    object,
    {
      receipt: unknown;
      extractor: unknown;
      promise: Promise<SourceExtractionResult>;
    }
  >;
  closed: boolean;
  physicalUnconfirmed: boolean;
}
interface RequestRow {
  owner: SourceRow;
  frame: MainMaterialEventView;
  receipt: OriginalKnowledgeSourceReceipt;
  token: object;
  active: boolean;
  custody: RoomTurnCustody;
  executionRef: string;
}
export interface OriginalMainMaterialContext {
  readonly kind: 'original_main_material_context_v1';
  readonly executionClass: 'material_turn';
  readonly executionRef: string;
  readonly source: object;
  readonly services: object;
  readonly scope: Readonly<{
    profileId: string;
    workspaceId: string;
    principalId: string;
  }>;
  readonly parentRef: null;
  readonly signal: AbortSignal;
  assertCurrent(): void;
  assertLocal(): void;
}
function denied(): Error {
  return Error('MAIN_MATERIAL_ORIGINAL_SOURCE_REQUIRED');
}
function local(row: RequestRow): void {
  if (!row.active || row.owner.closed || row.owner.physicalUnconfirmed)
    throw denied();
  row.frame.assertLocal();
  row.receipt.assertLocal();
  row.custody.local();
}
function current(row: RequestRow): void {
  local(row);
  row.custody.syncVoid(row.frame.assertCurrent, undefined, []);
  row.custody.syncVoid(row.receipt.assertCurrent, undefined, []);
  local(row);
}
const consumeExports = () => {};
/** Inherited contexts are verified again by the original Native Owner, never DTOs. */
export function captureOriginalMaterialExecutionParent(): object | null {
  const token = apply(scopeGet, scope, []) as object | undefined;
  if (token) {
    const row = apply(get, requests, [token]) as RequestRow | undefined;
    if (!row) throw denied();
    current(row);
    return token;
  }
  return (
    readCurrentOriginalTaskRunnerResourceContext() ??
    readCurrentOriginalRootExecutionContext()
  );
}
/** A signal is cancellation data, never an authority or a replacement context. */
export function readOptionalOriginalMaterialExecutionSignal(
  context: unknown,
): AbortSignal | null {
  const row = apply(get, requests, [context]) as RequestRow | undefined;
  return row?.frame.signal ?? null;
}
/** Pure membership-based lifetime, not a creator or an effect permission. */
export function readOptionalOriginalMaterialExecutionLifetime(
  context: unknown,
): Readonly<{
  signal: AbortSignal;
  assertCurrent(): void;
  assertLocal(): void;
}> | null {
  const row = apply(get, requests, [context]) as RequestRow | undefined;
  if (!row) return null;
  return freeze({
    signal: row.frame.signal,
    assertCurrent: () => current(row),
    assertLocal: () => local(row),
  });
}