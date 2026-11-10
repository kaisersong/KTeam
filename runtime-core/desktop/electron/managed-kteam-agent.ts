import { existsSync } from 'node:fs';

import { resolveConfiguredModelBinding } from '../../src/ai/providers/model-binding.js';
import type { Config } from '../../src/types.js';
import { KTEAM_DESKTOP_HOST_PARTICIPANT_ID } from '../shared/kswarm-seed-contract.js';

const DEFAULT_CAPABILITIES = [
  'coding',
  'testing',
  'qa',
  'design',
  'planning',
  'research',
  'analysis',
  'source_research',
  'web_research',
  'writing',
  'documentation',
  'review',
  'product',
  'requirements',
  'architecture',
  'system-design',
  'engineering',
  'devops',
  'deployment',
  'data_analysis',
  'report_generation',
  'presentation_generation',
  'presentation_content',
  'slide_generation',
];
const DEFAULT_OUTPUT_CAPABILITIES = ['markdown', 'html', 'report_html'];
const HOSTED_KTEAM_EXECUTION = {
  mode: 'hosted',
  hostParticipantId: KTEAM_DESKTOP_HOST_PARTICIPANT_ID,
} as const;

export interface ManagedKTeamAgentInput {
  desktopModelId?: string | null;
  id?: string;
  name: string;
  description?: string;
  instructions?: string;
  roles?: string[];
  capabilities?: string[];
  maxConcurrentTasks?: number;
}

export interface ManagedKTeamAgentPayload {
  desktopModelId?: string | null;
  id?: string;
  name: string;
  description: string;
  instructions: string;
  runtimeType: 'kteam';
  runtimeSource: 'desktop-agent-runtime';
  runtimePath: string | null;
  execution: typeof HOSTED_KTEAM_EXECUTION;
  runtimeModel: string;
  provider: null;
  model: null;
  baseUrl: null;
  apiKey: null;
  roles: string[];
  capabilities: string[];
  taskCapabilities: string[];
  outputCapabilities: string[];
  runtimeHealth: {
    state: 'unknown';
    source: 'desktop-agent-runtime';
    taskCapabilities: string[];
    outputCapabilities: string[];
  };
  maxConcurrentTasks: number;
}

export interface ResolveLocalKTeamRuntimePathOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  exists?: (candidate: string) => boolean;
}

export function resolveLocalKTeamRuntimePath(
  options: ResolveLocalKTeamRuntimePathOptions = {},
): string | null {
  const env = options.env ?? process.env;
  const pathExists = options.exists ?? existsSync;

  // Default desktop-managed kteam agents must not depend on a separately
  // installed kteam CLI. Only an explicit native override is honored.
  const hinted = env.KSWARM_KTEAM_PATH?.trim();
  if (hinted && pathExists(hinted)) {
    return hinted;
  }

  return null;
}

function arraysEqual(a: string[] | undefined, b: string[] | undefined): boolean {
  return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
}

/** Public metadata only; transport bindings and observed health belong to main/server owners. */
export function buildManagedKTeamAgentSemanticPayload(
  payload: Partial<ManagedKTeamAgentPayload>,
  options: { update?: boolean } = {},
): Record<string, unknown> {
  const fields = ['id', 'name', 'description', 'instructions', 'roles', 'capabilities', 'taskCapabilities',
    'outputCapabilities', 'runtimeType', 'runtimeSource', 'runtimeModel', 'runtimeHealth', 'maxConcurrentTasks', 'desktopModelId'];
  const source = payload as Record<string, unknown>;
  return Object.fromEntries(fields.flatMap(key => {
    if (options.update && ['id', 'runtimeType', 'runtimeHealth'].includes(key)) return [];
    return source[key] === undefined ? [] : [[key, source[key]]];
  }));
}

export function buildManagedKTeamAgentPayload(
  input: ManagedKTeamAgentInput,
  config: Config,
  options: { runtimePath?: string | null; modelId?: string } = {},
): ManagedKTeamAgentPayload {
  const binding = resolveConfiguredModelBinding(config, input.desktopModelId ?? options.modelId ?? config.defaultModelId);
  const runtimePath = options.runtimePath === undefined ? null : options.runtimePath;
  const taskCapabilities = input.capabilities ?? [...DEFAULT_CAPABILITIES];
  const outputCapabilities = [...DEFAULT_OUTPUT_CAPABILITIES];

  return {
    id: input.id,
    ...(input.desktopModelId !== undefined ? { desktopModelId: input.desktopModelId } : {}),
    name: input.name,
    description: input.description ?? `kteam desktop 智能体 (${binding.providerId}/${binding.modelEntry.model})`,
    instructions: input.instructions ?? '',
    runtimeType: 'kteam',
    runtimeSource: 'desktop-agent-runtime',
    runtimePath,
    execution: HOSTED_KTEAM_EXECUTION,
    runtimeModel: binding.modelEntry.model,
    provider: null,
    model: null,
    baseUrl: null,
    apiKey: null,
    roles: input.roles ?? ['worker'],
    capabilities: taskCapabilities,
    taskCapabilities,
    outputCapabilities,
    runtimeHealth: {
      state: 'unknown',
      source: 'desktop-agent-runtime',
      taskCapabilities,
      outputCapabilities,
    },
    maxConcurrentTasks: input.maxConcurrentTasks ?? 6,
  };
}

export function diffManagedKTeamAgentPatch(
  current: Record<string, unknown>,
  desired: ManagedKTeamAgentPayload,
): Partial<ManagedKTeamAgentPayload> | null {
  const patch: Partial<ManagedKTeamAgentPayload> = {};

  const scalarFields: Array<keyof ManagedKTeamAgentPayload> = [
    'name',
    'description',
    'instructions',
    'runtimeType',
    'runtimeSource',
    'runtimePath',
    'runtimeModel',
    'provider',
    'model',
    'baseUrl',
    'apiKey',
    'maxConcurrentTasks',
  ];

  for (const field of scalarFields) {
    if ((current as Record<string, unknown>)[field] !== desired[field]) {
      (patch as Record<string, unknown>)[field] = desired[field];
    }
  }

  if (!arraysEqual(current.roles as string[] | undefined, desired.roles)) {
    patch.roles = desired.roles;
  }
  if (!arraysEqual(current.capabilities as string[] | undefined, desired.capabilities)) {
    patch.capabilities = desired.capabilities;
  }
  if (!arraysEqual(current.taskCapabilities as string[] | undefined, desired.taskCapabilities)) {
    patch.taskCapabilities = desired.taskCapabilities;
  }
  if (!arraysEqual(current.outputCapabilities as string[] | undefined, desired.outputCapabilities)) {
    patch.outputCapabilities = desired.outputCapabilities;
  }
  if (JSON.stringify(current.runtimeHealth ?? null) !== JSON.stringify(desired.runtimeHealth)) {
    patch.runtimeHealth = desired.runtimeHealth;
  }
  if (JSON.stringify(current.execution ?? null) !== JSON.stringify(desired.execution)) {
    patch.execution = desired.execution;
  }

  return Object.keys(patch).length > 0 ? patch : null;
}
