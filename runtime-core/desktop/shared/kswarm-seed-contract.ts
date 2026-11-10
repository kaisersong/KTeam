export interface KSwarmAgentLike {
  id: string;
  name?: string;
  runtimeType?: string;
  roles?: string[];
  archivedAt?: number | null;
  status?: string;
}

export interface KSwarmCreateAgentInput {
  id: string;
  name: string;
  description: string;
  instructions: string;
  runtimeType: 'kteam';
  roles: string[];
  capabilities: string[];
}

export interface SeedAgentReconciliationPlan {
  create: KSwarmCreateAgentInput[];
  archive: string[];
}

const SHARED_CAPABILITIES = ['coding', 'testing', 'design', 'planning'];

export const KTEAM_PO_SEED_ID = 'kteam-po';
export const KTEAM_WORKER_SEED_ID = 'kteam-worker';
export const KTEAM_DESKTOP_HOST_PARTICIPANT_ID = 'kteam-desktop';
const KTEAM_LEGACY_SEED_ID = 'kteam';

export function createKTeamPoSeed(): KSwarmCreateAgentInput {
  return {
    id: KTEAM_PO_SEED_ID,
    name: 'PO-Agent',
    description: 'kteam 项目负责人种子智能体',
    instructions: '你是 kteam 项目负责人（PO）种子智能体，负责规划、拆解、派发、审核和交付把关。',
    runtimeType: 'kteam',
    roles: ['project_owner'],
    capabilities: SHARED_CAPABILITIES,
  };
}

export function createKTeamWorkerSeed(): KSwarmCreateAgentInput {
  return {
    id: KTEAM_WORKER_SEED_ID,
    name: 'Worker-Agent',
    description: 'kteam 执行者种子智能体',
    instructions: '你是 kteam 执行者种子智能体，负责执行已分配任务并提交结果。',
    runtimeType: 'kteam',
    roles: ['worker'],
    capabilities: SHARED_CAPABILITIES,
  };
}

function isArchived(agent: KSwarmAgentLike): boolean {
  return agent.archivedAt != null;
}

function hasRole(agent: KSwarmAgentLike, role: string): boolean {
  return agent.roles?.includes(role) ?? false;
}

function isDedicatedPoSeed(agent: KSwarmAgentLike): boolean {
  return !isArchived(agent) && agent.id === KTEAM_PO_SEED_ID;
}

function isDedicatedWorkerSeed(agent: KSwarmAgentLike): boolean {
  return !isArchived(agent) && agent.id === KTEAM_WORKER_SEED_ID;
}

function isLegacyFullRoleKTeamSeed(agent: KSwarmAgentLike): boolean {
  return (
    !isArchived(agent) &&
    agent.id === KTEAM_LEGACY_SEED_ID &&
    agent.runtimeType === 'kteam' &&
    hasRole(agent, 'project_owner') &&
    hasRole(agent, 'worker')
  );
}

export function buildSeedAgentReconciliationPlan(agents: KSwarmAgentLike[]): SeedAgentReconciliationPlan {
  const hasPoSeed = agents.some(isDedicatedPoSeed);
  const hasWorkerSeed = agents.some(isDedicatedWorkerSeed);
  const legacy = agents.find(isLegacyFullRoleKTeamSeed);

  const create: KSwarmCreateAgentInput[] = [];
  if (!hasPoSeed) create.push(createKTeamPoSeed());
  if (!hasWorkerSeed) create.push(createKTeamWorkerSeed());

  const archive = legacy && create.length > 0 ? [legacy.id] : [];
  return { create, archive };
}

export function getPreferredPoAgentId(agents: KSwarmAgentLike[]): string | null {
  const active = agents.filter((agent) => !isArchived(agent));
  return (
    active.find((agent) => agent.id === KTEAM_PO_SEED_ID)?.id ??
    active.find((agent) => agent.id === KTEAM_LEGACY_SEED_ID && hasRole(agent, 'project_owner'))?.id ??
    active.find((agent) => agent.id === 'cli-kteam' && hasRole(agent, 'project_owner'))?.id ??
    active.find((agent) => hasRole(agent, 'project_owner'))?.id ??
    null
  );
}

export function getPreferredWorkerSeedId(agents: KSwarmAgentLike[], poAgentId?: string | null): string | null {
  const worker = agents.find((agent) => !isArchived(agent) && agent.id === KTEAM_WORKER_SEED_ID);
  if (!worker || worker.id === poAgentId) return null;
  return worker.id;
}
