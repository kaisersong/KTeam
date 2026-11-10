import {types} from 'node:util';
import {captureGithubOpaqueRecord} from '../../src/runtime/multi-agent/dsh-github-read-data.js';
import {captureDispatchBusinessData} from '../../src/runtime/conversation-activity/dispatch-business-data.js';
import {dshAJson} from '../../src/runtime/multi-agent/dsh-admission-data.js';
import {createIntrinsicSet,settleIntrinsicOperations} from '../../src/runtime/verification/intrinsic-async-collection.js';
import {retainSourceErrorTails} from '../../src/runtime/verification/source-error-tails.js';
import {assertStandardIpcPromise} from '../../src/runtime/verification/native-ipc-promise.js';
import type {KSwarmDshAdmission,KSwarmDshAudience,KSwarmDshContext,KSwarmDshOperation,KSwarmDshReplyView} from '../../src/runtime/conversation-activity/owned-kswarm-business.js';
import {readOriginalMainDshBootstrapAuthority,type MainDshBootstrapAuthority} from './main-dsh-bootstrap-authority.js';
import {readOriginalDshAdmissionPort,readOriginalDshClaimedCommand,type DshClaimedCommandView} from './desktop-multi-agent-store.js';
import {readOriginalDshDraftModelResult,type DshDraftModelResult} from './main-dsh-draft-model-source.js';
import {readOriginalMainDshBudgetAuthoritySource} from './main-dsh-budget-authority-source.js';
import {readOriginalDshBudgetRuntimeBinding,readOriginalDshBudgetPort,takeOriginalDshDraftAdmission,assertOriginalDshDraftAdmissionCurrent,readOriginalDshBudgetCommitProof,assertOriginalDshBudgetCommitProofCurrent} from './harness-optimization-service.js';
import {readKSwarmOwnedDshServiceScope,getKSwarmOwnedDshTransport,readOriginalKSwarmDshReply} from './kswarm-service.js';
const apply=Reflect.apply,freeze=Object.freeze,create=Object.create,define=Object.defineProperty,descriptor=Object.getOwnPropertyDescriptor,own=Object.hasOwn,isProxy=types.isProxy,isPromise=types.isPromise;
const signalAborted=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'aborted')!.get!,signalReason=Object.getOwnPropertyDescriptor(AbortSignal.prototype,'reason')!.get!;
const NativePromise=Promise,then=Promise.prototype.then,get=WeakMap.prototype.get,set=WeakMap.prototype.set,NativeError=Error;
function fail(code='DSH_MAIN_BUSINESS_SOURCE_REQUIRED'):never{throw new NativeError(code);}
interface Frame {proof:object;operation:KSwarmDshOperation;input:unknown;holder:Record<string,unknown>;active:boolean;settlement?:boolean;claim?:DshClaimedCommandView;auditCommand?:Readonly<Record<string,unknown>>;originalClaim?:object;slotOwnerVersion?:number;draftResult?:DshDraftModelResult;draftReceipt?:object;draftModelSource?:object;draftModelToken?:object;budget?:{port:object;reserveProof:object;receipt:object};signal:AbortSignal;finish():void}
export interface MainDshBusinessDelivery {readonly reply:unknown;readonly observation:KSwarmDshReplyView;release():void}
export interface MainDshBusinessSource {
 readonly admission:KSwarmDshAdmission;
 bindService(service:object):void;bindStore(store:object):void;
 prepareOwner(signal:AbortSignal):Promise<MainDshBusinessDelivery>;
 sendClaim(claim:object,signal:AbortSignal):Promise<MainDshBusinessDelivery>;
 readOwnerBasis(originalDelivery:object,signal:AbortSignal):Promise<MainDshBusinessDelivery>;
 readDraftSlot(originalDelivery:object,signal:AbortSignal):Promise<MainDshBusinessDelivery>;
 reconcileCommand(commandId:string,signal:AbortSignal):Promise<MainDshBusinessDelivery>;
 reconcileControl(operationId:string,ownerDomain:string,signal:AbortSignal):Promise<MainDshBusinessDelivery>;
 stageDraft(originalModelSource:object,originalModelResult:object,signal:AbortSignal):Promise<MainDshBusinessDelivery>;
 commitDraft(originalModelSource:object,originalModelResult:object,signal:AbortSignal):Promise<MainDshBusinessDelivery>;
 readDraft(originalModelSource:object,originalModelResult:object,signal:AbortSignal):Promise<MainDshBusinessDelivery>;
 stopAccepting():void;close():Promise<void>;
}