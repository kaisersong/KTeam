import type {
  KTeamDaemonClientMessage,
  KTeamDaemonRpcErrorMessage,
  KTeamDaemonRpcResultMessage,
  KTeamDaemonServerMessage,
  KTeamDaemonServiceEventMessage,
} from '../daemon/protocol.js';
import type { ReminderTaskType, RecurrenceConfig, TaskExecution } from './types.js';
export {
  createKTeamDaemonRpcId as createReminderRpcId,
  resolveKTeamDaemonSocketPath,
  resolveKTeamDaemonSocketPath as resolveReminderDaemonSocketPath,
  KTEAM_DAEMON_PROTOCOL_VERSION as REMINDER_DAEMON_PROTOCOL_VERSION,
} from '../daemon/protocol.js';

export const REMINDER_DAEMON_SERVICE = 'reminder';

export type ReminderRpcMethod =
  | 'create_from_request'
  | 'create_structured'
  | 'list_for_creator'
  | 'cancel_for_creator'
  | 'list_tasks'
  | 'cancel_task'
  | 'status';

export interface ReminderEventPayload {
  sessionId: string;
  reminderId: string;
  content: string;
  message: string;
  createdAt: number;
  taskType: ReminderTaskType;
  recurrence?: RecurrenceConfig;
  execution?: TaskExecution;
}

export type ReminderClientMessage = KTeamDaemonClientMessage;
export type ReminderRpcResultMessage = KTeamDaemonRpcResultMessage;
export type ReminderRpcErrorMessage = KTeamDaemonRpcErrorMessage;
export type ReminderServerMessage = KTeamDaemonServerMessage;
export type ReminderEventMessage = KTeamDaemonServiceEventMessage & {
  service: typeof REMINDER_DAEMON_SERVICE;
  name: 'delivery';
  payload: ReminderEventPayload;
};