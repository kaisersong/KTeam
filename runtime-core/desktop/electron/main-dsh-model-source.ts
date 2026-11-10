import type {OriginalMainPhysicalPort} from './main-room-root-admission.js';
import {types} from 'node:util';
import {createHash,Hash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {loadConfigSync} from '../../src/utils/config.js';
import {resolveRuntimeModelBinding} from '../../src/ai/providers/control-plane.js';
import {buildDshBoundedRequest} from '../../src/runtime/admission/request-bounds.js';
import {buildDshAssessmentPrompt,parseDshAssessmentOutput,DSH_ASSESSMENT_PROMPT_VERSION} from '../../src/runtime/admission/assessment-output.js';
import {decodeDshChatCompletion} from '../../src/runtime/admission/model-response.js';
import {dshAHash,dshAJson} from '../../src/runtime/multi-agent/dsh-admission-data.js';
import {captureGithubOpaqueRecord} from '../../src/runtime/multi-agent/dsh-github-read-data.js';
import {createSingleRequestHttpsFetch,readSingleRequestOwnedReply,readOriginalSingleRequestPhysicalReceipt} from '../../src/runtime/sol-pi/single-request-https.js';
import {createIntrinsicSet,settleIntrinsicOperations} from '../../src/runtime/verification/intrinsic-async-collection.js';
import {retainSourceErrorTails} from '../../src/runtime/verification/source-error-tails.js';
import {assertStandardIpcPromise} from '../../src/runtime/verification/native-ipc-promise.js';
import {readOriginalDshAdmissionPort,readOriginalDshAssessmentRequest,readOriginalDshAssessmentSourceBody,assertOriginalDshAssessmentExecutionAuthority,type DshAssessmentRequestView} from './desktop-multi-agent-store.js';
import {readOriginalDshBudgetRuntimeBinding,readOriginalDshBudgetPort,readOriginalDshBudgetObservation,readOriginalDshBudgetAttemptReceipt,type OriginalDshBudgetRuntimeBinding} from './harness-optimization-service.js';
import {dshBudgetCommandDigest,parseDshInput} from './harness-dsh-budget-data.mjs';
import {readOriginalMainDshBudgetAuthoritySource,type MainDshBudgetAuthoritySource} from './main-dsh-budget-authority-source.js';
const apply=Reflect.apply,get=WeakMap.prototype.get,set=WeakMap.prototype.set,descriptor=Object.getOwnPropertyDescriptor,own=Object.hasOwn,freeze=Object.freeze,create=Object.create,define=Object.defineProperty;
const mapGet=Map.prototype.get,mapSet=Map.prototype.set,NativeAbort=AbortController,abort=AbortController.prototype.abort;
const NativePromise=Promise,then=Promise.prototype.then,NativeError=Error,isProxy=types.isProxy,isPromise=types.isPromise,now=Date.now,monotonicNative=performance.now,hashUpdate=Hash.prototype.update,hashDigest=Hash.prototype.digest;
function monotonic():number{const value=apply(monotonicNative,performance,[]);if(typeof value!=='number'||!Number.isFinite(value)||value<0)throw new NativeError('DSH_MODEL_CLOCK_UNAVAILABLE',{cause:value});return value;}
function fail(code='DSH_MODEL_SOURCE_UNAVAILABLE'):never{throw new NativeError(code);}
function sha(raw:string):string{const hash=createHash('sha256');apply(hashUpdate,hash,[raw,'utf8']);return apply(hashDigest,hash,['hex']) as string;}
function utf8(bytes:Uint8Array):string{return apply(decode,new NativeDecoder('utf-8',{fatal:true}),[bytes]) as string;}
function data<T>(raw:unknown,key:string):T{if(!raw||typeof raw!=='object'||isProxy(raw))fail();const row=descriptor(raw,key);if(!row||!own(row,'value'))fail();return row.value as T;}
interface Attempt {
 store:object;source:object;runtime:object;budgetSource:object;attemptId:string;request:DshAssessmentRequestView;commands:Map<string,{input:unknown;current():void}>;
 bodyHash?:string;requestBody?:string;physicalReceipt?:object;budgetAttempt?:object;result?:DshAssessmentResultView;current():void;local():void;
}
const attempts=new WeakMap<object,Attempt>();
export interface OriginalDshModelResourceContext {
 readonly kind:'original_dsh_model_resource_context_v1';readonly executionClass:'admission_probe'|'live_preview';readonly executionRef:string;readonly bodyHash:string;
 readonly scope:Readonly<{profileId:string;workspaceId:string;principalId:string}>;assertCurrent():void;assertLocal():void;
}
export interface DshAssessmentResultView {
 readonly attemptId:string;readonly modelId:string;readonly promptVersion:string;readonly ruleVersion:string;readonly evidenceManifestHash:string;readonly dataEgressPolicyRef:string;readonly validUntil:number;readonly assessmentVersion:1|2;readonly purpose:'admission'|'preview';
 readonly result:Readonly<{suggestedIntent:'draft_request'|'followup'|'chat'|'ambiguous';evidenceRefs:readonly string[];uncertainty:string|null}>;
 assertCurrent():void;assertLocal():void;assertKnown():void;waitKnown():Promise<void>;
}
export interface MainDshModelSource {runAssessment(attemptId:string):Promise<object>;stopAccepting():void;close():Promise<void>}
export interface OriginalDshModelPricingEvidence {
 readonly kind:'original_dsh_model_pricing_evidence_v1';readonly providerId:'deepseek';readonly modelId:'deepseek-flash';readonly modelProfileId:'deepseek-flash-dsh-text-v1';readonly protocol:'openai_legacy';readonly destination:string;
 readonly contextTokenLimit:1048576;readonly maxOutputTokens:393216;readonly inputMicrosPerMillion:300000;readonly outputMicrosPerMillion:1200000;readonly currency:'USD';readonly scale:6;readonly validUntil:number;readonly pricingEvidenceHash:string;
 readonly contextSemantics:'input_and_output';readonly outputSemantics:'total_completion_tokens';assertCurrent():void;assertLocal():void;
}
interface OriginalModelSourceState {realm:object;store:object;runtime:object;budgetSource:object;local():void;pricing():OriginalDshModelPricingEvidence}
export interface OriginalDshModelPricingRequest {
 readonly realm:object;readonly store:object;readonly runtime:object;readonly budgetSource:object;
 readonly request:DshAssessmentRequestView;readonly signal:AbortSignal;readonly validUntil:number;
 assertCurrent():void;assertLocal():void;
}