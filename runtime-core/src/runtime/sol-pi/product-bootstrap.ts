import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, lstatSync, realpathSync, readdirSync, existsSync, openSync, closeSync, fstatSync, constants } from 'node:fs';
import { homedir, version as osVersion } from 'node:os';
import { join, resolve, isAbsolute, normalize, dirname } from 'node:path';
import { resolveRuntimeModelBinding } from '../../ai/providers/control-plane.js';
import type { Config } from '../../types.js';
import { MULTI_AGENT_TOOL_NAMES, CHILD_COMMUNICATION_TOOL_NAMES } from '../../ai/tools/multi-agent.js';
import type { AgentSessionState, AgentSessionSnapshot } from '../../ai/runtime/session.js';
import type { ObservationReadFileScope } from './observation-service.js';
import { freezeDeepSeekRecipeCounter, type DeepSeekRecipeEnvironment, type DeepSeekRecipeManifest } from './deepseek-capacity-profile.js';
import { resolveProductionCapacityProfile } from './capacity-admission.js';
import { validateSemanticPolicy, type ValidatedSemanticPolicy } from './semantic-policy.js';
import {reserveCompoundDomainBytes} from './compound-domain-budget.js';
import {reserveSessionAliasBytes} from '../../ai/runtime/session-store/aliases.js';
import {assertCompoundHostStorage,inspectCompoundHostSources,type CompoundHostStorage} from './compound-host-storage.js';
import {openCompoundExecutionDomain} from './compound-execution-domain.js';
import { validateOrdinaryChildrenPolicy, type OrdinaryChildrenPolicy } from './delegation-policy.js';
import {isRegisteredRecipeManifest,selectRecipeManifestPath} from './recipe-environment-registration.js';

export interface ProductObservationPolicy { readonly opaqueProductObservationPolicy: never }
interface Policy {
  ordinaryChildren?: OrdinaryChildrenPolicy;
  semanticCompaction?: ValidatedSemanticPolicy;
  compoundExecution?: {version:1;mode:'mechanism-experiment'};
  version: 1; environmentId: 'deepseek-recipe-0.1.1'; model: 'deepseek-flash';
  destination: { provider: string; url: string }; localPersistence: true; allowUnclassifiedText: true;
  allowModelDisclosure: true; allowIncomplete: false; expiresAt: number;
  readFileScopes: ObservationReadFileScope[]; bashSources: Array<{ command: string; cwd: string }>;
}
interface PermissionRevisionPort { getRevision(): number; onRevisionChanged(listener: (revision: number) => void): () => void }
const policies = new WeakMap<object, Policy>();
const digest = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
function deny(reason: string): never { throw new Error(`SOL_PI_PRODUCT_${reason}`); }
function keys(value: unknown, allowed: string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) deny('INVALID_POLICY');
}
function text(value: unknown, max = 4096): asserts value is string {
  if (typeof value !== 'string' || !value || value.length > max || /[\x00-\x1f\x7f]/.test(value)) deny('INVALID_POLICY');
}
function line(value: unknown): value is number { return Number.isSafeInteger(value) && Number(value) > 0; }
function policyOf(value: ProductObservationPolicy): Policy {
  const policy = value && policies.get(value); if (!policy || policy.expiresAt <= Date.now()) deny('POLICY_EXPIRED_OR_UNTRUSTED'); return policy;
}
/** Main-owned review display of the already parsed user grant; never rereads a file. */
export function describeProductObservationPolicy(approved: ProductObservationPolicy) {
  const policy = policyOf(approved);
  return Object.freeze({ model: policy.model, destination: Object.freeze({ ...policy.destination }), expiresAt: policy.expiresAt,
    ordinaryChildren: policy.ordinaryChildren && Object.freeze({ ...policy.ordinaryChildren, nativeTools: Object.freeze([...policy.ordinaryChildren.nativeTools]) }),
    compoundExecution:policy.compoundExecution&&Object.freeze({...policy.compoundExecution}),
    semanticCompaction: policy.semanticCompaction && Object.freeze({ ...policy.semanticCompaction, pricing: Object.freeze({ ...policy.semanticCompaction.pricing }) }),
    readFileScopes: Object.freeze(policy.readFileScopes.map(scope => Object.freeze({ ...scope }))),
    bashSources: Object.freeze(policy.bashSources.map(source => Object.freeze({ ...source }))),
    localPersistence: policy.localPersistence, allowUnclassifiedText: policy.allowUnclassifiedText, allowModelDisclosure: policy.allowModelDisclosure });
}