import { types } from 'node:util';
import { createHash, Hash } from 'node:crypto';
import { loadConfigSync } from '../../src/utils/config.js';
import { resolveRuntimeModelBinding } from '../../src/ai/providers/control-plane.js';
import { buildDshBoundedRequest } from '../../src/runtime/admission/request-bounds.js';
import { decodeDshChatCompletion } from '../../src/runtime/admission/model-response.js';
import { buildDshDraftCandidate, type DshDraftCandidate } from '../../src/runtime/multi-agent/dsh-draft-candidate.js';
import { dshAHash, dshAJson, type DshARecord } from '../../src/runtime/multi-agent/dsh-admission-data.js';
import { captureGithubOpaqueRecord } from '../../src/runtime/multi-agent/dsh-github-read-data.js';
import { createSingleRequestHttpsFetch, readSingleRequestOwnedReply, readOriginalSingleRequestPhysicalReceipt } from '../../src/runtime/sol-pi/single-request-https.js';
import { createIntrinsicSet, settleIntrinsicOperations } from '../../src/runtime/verification/intrinsic-async-collection.js';
import { assertStandardIpcPromise } from '../../src/runtime/verification/native-ipc-promise.js';
import { readOriginalDshDraftSourceBody, readOriginalDshAdmissionPort } from './desktop-multi-agent-store.js';
import { readOriginalMainDshDraftLaunch, readOriginalMainDshDraftLaunchBinding } from './dsh-draft-root-source.js';
import { readOriginalDshModelPricingEvidence, readOriginalMainDshModelSource } from './main-dsh-model-source.js';
import { readOriginalMainDshBusinessSource } from './main-dsh-business-source.js';
import { readOriginalMainDshBudgetAuthoritySource, type MainDshBudgetAuthoritySource } from './main-dsh-budget-authority-source.js';
import { readOriginalDshBudgetRuntimeBinding, readOriginalDshBudgetPort, readOriginalDshDraftAttemptReceipt, readOriginalDshBudgetObservation, readOriginalDshBudgetCommitProof, assertOriginalDshBudgetCommitProofCurrent } from './harness-optimization-service.js';
import { parseDshInput, dshBudgetCommandDigest } from './harness-dsh-budget-data.mjs';
import type { OriginalMainPhysicalPort } from './main-room-root-admission.js';
const apply = Reflect.apply, get = WeakMap.prototype.get, set = WeakMap.prototype.set, descriptor = Object.getOwnPropertyDescriptor, own = Object.hasOwn, keys = Reflect.ownKeys, prototype = Object.getPrototypeOf;
const create = Object.create, define = Object.defineProperty, freeze = Object.freeze, NativePromise = Promise, then = Promise.prototype.then, NativeError = Error;
const mapGet = Map.prototype.get, mapSet = Map.prototype.set, isProxy = types.isProxy, isPromise = types.isPromise, isError = types.isNativeError, isArray = Array.isArray;
const objectPrototype = Object.prototype, arrayPrototype = Array.prototype, nativeStack = descriptor(new NativeError(), 'stack');
const hashUpdate = Hash.prototype.update, hashDigest = Hash.prototype.digest, now = Date.now;
const endpoint = 'https://api.deepseek.com/chat/completions';
function fail(code = 'DSH_DRAFT_MODEL_UNAVAILABLE'): never { throw new NativeError(code); }
function data(target: object, key: PropertyKey, value: unknown): void { define(target, key, { __proto__: null, value, enumerable: true } as PropertyDescriptor); }
function sha(bytes: Uint8Array): string { const value = createHash('sha256'); apply(hashUpdate, value, [bytes]); return apply(hashDigest, value, ['hex']) as string; }
interface LaunchView {
    readonly originalClaim: object;
    readonly originalSlotDelivery: object;
    readonly command: Readonly<DshARecord>;
    readonly slot: Readonly<DshARecord>;
    readonly inputManifest: Readonly<DshARecord>;
    readonly executionContext: object;
    readonly scope: Readonly<{
        profileId: string;
        workspaceId: string;
        principalId: string;
    }>;
    readonly accountId: string;
    readonly reservationId: string;
    readonly ownerWorkId: string;
    readonly draftInvocationId: string;
    readonly draftCommitKey: string;
    readonly ownerVersion: number;
    readonly modelId: string;
    readonly tenantId: string;
    readonly mandateId: string;
    readonly mandateRevision: number;
    readonly authorizationEpoch: number;
    readonly budgetAuthorityHash: string;
    readonly deadline: number;
    assertCurrent(): void;
    assertLocal(): void;
}
interface Attempt {
    realm: object;
    store: object;
    runtime: object;
    budgetSource: object;
    source: object;
    launch: LaunchView;
    attemptId: string;
    bodyHash: string;
    requestBody: string;
    commands: Map<string, {
        input: unknown;
        current(): void;
    }>;
    current(): void;
    local(): void;
    physical?: object;
    result?: DshDraftModelResult;
}
const attempts = new WeakMap<object, Attempt>();
interface LaunchRun {
    source: object;
    realm: object;
    store: object;
    runtime: object;
    budgetSource: object;
    launch: object;
    completed: boolean;
    mAcquireEntered: boolean;
    mSettled: boolean;
    failurePresent: boolean;
    failure: unknown;
    completion: Promise<void>;
    tails: ReturnType<typeof createIntrinsicSet<Promise<void>>>;
    unknown: ReturnType<typeof createIntrinsicSet<unknown>>;
}
interface SdkObservation {
    pending: boolean;
    completion: Promise<void>;
    valuePresent: boolean;
    value: unknown;
    runs: ReturnType<typeof createIntrinsicSet<LaunchRun>>;
}
interface SourceBirth {
    realm: object;
    store: object;
    runtime: object;
    budgetSource: object;
    runs: WeakMap<object, LaunchRun>;
}
export interface DshDraftModelResult {
    readonly kind: 'original_dsh_draft_model_result_v1';
    readonly candidate: DshDraftCandidate;
    readonly budgetCommitReceipt: object;
    assertCurrent(): void;
    assertKnown(): void;
    waitKnown(): Promise<void>;
}
export interface MainDshDraftModelSource {
    runDraft(originalLaunch: object): Promise<object>;
    stopAccepting(): void;
    close(): Promise<void>;
}