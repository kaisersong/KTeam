import { createHash, randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

export const KTEAM_DAEMON_PROTOCOL_VERSION = 1;

export interface KTeamDaemonClientInfo {
  clientInstanceId: string;
  sessionId: string;
  creatorUserId: string;
  workspaceRoot: string;
  clientVersion: string;
  protocolVersion: number;
  defaultTimeZone: string;
}

export interface KTeamDaemonHelloMessage extends KTeamDaemonClientInfo {
  type: 'hello';
  sentAt: number;
}

export interface KTeamDaemonHelloAckMessage {
  type: 'hello_ack';
  daemonVersion: string;
  protocolVersion: number;
  sentAt: number;
}

export interface KTeamDaemonHeartbeatMessage {
  type: 'heartbeat';
  clientInstanceId: string;
  sentAt: number;
}

export interface KTeamDaemonRpcRequestMessage {
  type: 'rpc';
  id: string;
  service: string;
  method: string;
  params: Record<string, unknown>;
}

export interface KTeamDaemonRpcResultMessage {
  type: 'rpc_result';
  id: string;
  result: unknown;
}

export interface KTeamDaemonRpcErrorMessage {
  type: 'rpc_error';
  id: string;
  message: string;
  code?: string;
}

export interface KTeamDaemonServiceEventMessage {
  type: 'service_event';
  service: string;
  name: string;
  payload: Record<string, unknown>;
}

export type KTeamDaemonClientMessage =
  | KTeamDaemonHelloMessage
  | KTeamDaemonHeartbeatMessage
  | KTeamDaemonRpcRequestMessage;

export type KTeamDaemonServerMessage =
  | KTeamDaemonHelloAckMessage
  | KTeamDaemonRpcResultMessage
  | KTeamDaemonRpcErrorMessage
  | KTeamDaemonServiceEventMessage;

export function createKTeamDaemonRpcId(): string {
  return randomUUID();
}

export function resolveKTeamDaemonSocketPath(label?: string): string {
  const base = label ?? `${os.userInfo().username}:${os.homedir()}`;
  const id = createHash('sha256').update(base).digest('hex').slice(0, 16);
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\kteam-daemon-${id}`;
  }
  return path.join(os.tmpdir(), `kteam-daemon-${id}.sock`);
}
