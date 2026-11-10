import {captureDispatchBusinessData} from '../../src/runtime/conversation-activity/dispatch-business-data.js';
import {dshAJson} from '../../src/runtime/multi-agent/dsh-admission-data.js';
import {readOriginalDshClaimedCommand,readOriginalDshDomainMetadata} from './desktop-multi-agent-store.js';
import {readOriginalKSwarmDshReply} from './kswarm-service.js';
import {readOriginalDshBudgetPort,readOriginalDshDraftAdmission,assertOriginalDshDraftAdmissionCurrent} from './harness-optimization-service.js';
import type {KSwarmDshAdmission} from '../../src/runtime/conversation-activity/owned-kswarm-business.js';
const freeze=Object.freeze,safe=Number.isSafeInteger,parseTime=Date.parse,NativeError=Error;
export interface OriginalDshDraftRootCandidate {
 readonly kind:'original_dsh_draft_root_candidate_v1';readonly candidateOnly:true;
 readonly scope:Readonly<{profileId:string;workspaceId:string;principalId:string}>;
 readonly ownerWorkId:string;readonly draftInvocationId:string;readonly draftCommitKey:string;readonly deadlineAt:number;
 readonly payloadCanonical:string;readonly authorizationRef:string;
}
import { readOriginalDshDraftSourceBody, readOriginalDshAdmissionPort, type DshDraftSourceBodyView } from './desktop-multi-agent-store.js';
import { readOriginalMainDshBusinessSource, readOriginalMainDshDraftSlot } from './main-dsh-business-source.js';
import { readOriginalMainDshBudgetAuthoritySource } from './main-dsh-budget-authority-source.js';
import { captureGithubOpaqueRecord } from '../../src/runtime/multi-agent/dsh-github-read-data.js';
import { createRoomTurnCustody, type RoomTurnCustody } from '../../src/runtime/verification/original-sdk-custody.js';
import { createIntrinsicSet, settleIntrinsicOperations, aggregateIntrinsicErrors, appendIntrinsic } from '../../src/runtime/verification/intrinsic-async-collection.js';
import { types as launchTypes } from 'node:util';
const launchMapGet = Map.prototype.get, launchMapSet = Map.prototype.set, LaunchMap = Map;
const launchIsProxy = launchTypes.isProxy, launchIsPromise = launchTypes.isPromise;
type DraftNativePort = ReturnType<typeof import('./main-room-root-admission.js')['readOriginalMainDshDraftAdmission']>;
interface LaunchTicket {
    custody: RoomTurnCustody;
    cleanup: RoomTurnCustody;
    completed: boolean;
    row?: DraftLaunchRow;
}
interface DraftLaunchRow {
    realm: object;
    store: object;
    runtime: object;
    budgetSource: object;
    businessSource: object;
    claim: object;
    slotDelivery: object;
    body: DshDraftSourceBodyView;
    candidate: OriginalDshDraftRootCandidate;
    ownerVersion: number;
    reservationId: string;
    context?: object;
    closed: boolean;
    consumed: boolean;
    enqueued: boolean;
    cancelled: boolean;
    proof: object;
    ticket: LaunchTicket;
    native?: DraftNativePort;
    cancel?: Promise<void>;
}
export interface MainDshDraftLaunchSource {
    open(originalClaim: object, originalSlotDelivery: object): Promise<object>;
    stopAccepting(): void;
    close(): Promise<void>;
}