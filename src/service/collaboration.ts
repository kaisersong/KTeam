import { Upstreams } from '../adapters/upstream.js';
import { intentHash, validateL0 } from '../protocol/aimp.js';
import { KTeamError, fields, record, text } from '../errors.js';

export const LOCAL_HUMAN = 'human://kteam.local/user.local';
export function agentAddress(id: string): string { return 'agent://kteam.local/' + encodeURIComponent(id); }
function rows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new KTeamError('upstream_response_invalid', 502);
  return value.map(record);
}
export class CollaborationService {
  constructor(private upstream: Upstreams) {}
  async bots() {
    const result = await this.upstream.listBots();
    return { ok: true, bots: rows(result.agents).map(agent => ({
      id: agent.id, name: agent.name, description: agent.description, status: agent.status,
      runtimeType: agent.runtimeType, runtimeSource: agent.runtimeSource,
      // Existing project harness support is NOT KTeam execution admission.
      kteamExecution: 'not_verified',
    })) };
  }
  async runtimes() {
    const result = await this.upstream.listRuntimes();
    return { ok: true, runtimes: rows(result.runtimes).map(runtime => ({
      type: runtime.type, displayName: runtime.displayName, detected: runtime.detected,
      supportedByProject: runtime.supported, projectCallability: runtime.callability,
      kteamExecution: 'not_verified', reason: 'binding_probe_required',
    })) };
  }
  teams() { return this.upstream.listTeams(); }
  async createTeam(value: unknown) {
    const input = record(value);
    fields(input, ['title','goal','memberAgentIds','requestId']);
    const title = text(input.title, 'title');
    const goal = text(input.goal, 'goal', 8192);
    const requestId = text(input.requestId, 'request_id');
    if (!Array.isArray(input.memberAgentIds) || input.memberAgentIds.length < 1 || input.memberAgentIds.length > 5) throw new KTeamError('invalid_members');
    const ids = input.memberAgentIds.map(id => text(id, 'member'));
    if (new Set(ids).size !== ids.length) throw new KTeamError('duplicate_member');
    await this.upstream.requireReady();
    const agents = rows((await this.upstream.listBots()).agents);
    if (ids.some(id => !agents.some(agent => agent.id === id && !agent.archivedAt))) throw new KTeamError('agent_not_found', 404);
    return this.upstream.createTeam({ title, description: goal, memberAgentIds: ids, clientRequestKey: 'kteam:' + requestId });
  }
  async send(value: unknown,beforeSend?:(envelope:ReturnType<typeof validateL0>)=>void) {
    const envelope = validateL0(value);
    if (envelope.from !== LOCAL_HUMAN) throw new KTeamError('sender_identity_mismatch', 403);
    await this.upstream.requireReady();
    const team = await this.upstream.getTeam(envelope.room_id);
    const allowed = new Set([LOCAL_HUMAN, ...rows(team.members).filter(m => m.status === 'active').flatMap(member => {
      const subject = record(member.subject);
      return subject.kind === 'agent' && typeof subject.logicalAgentId === 'string' ? [agentAddress(subject.logicalAgentId)] : [];
    })]);
    if ([...envelope.to, ...envelope.mentions].some(id => !allowed.has(id))) throw new KTeamError('recipient_not_member', 403);
    let replyToMessageId: unknown;
    if (envelope.reply_to) {
      const target = rows(team.messages).find(message => {
        if (!message.sourceRef) return false;
        const ref = record(message.sourceRef);
        return ref.kind === 'aimp_l0' && ref.envelope && record(ref.envelope).id === envelope.reply_to;
      });
      if (!target) throw new KTeamError('reply_message_not_found', 404);
      replyToMessageId = target.messageId;
    }
    const digest = intentHash(envelope);
    beforeSend?.(envelope);
    const result = await this.upstream.sendMessage(envelope.room_id, {
      kind: 'text', text: envelope.body, threadId: envelope.thread_id,
      ...(replyToMessageId ? { replyToMessageId } : {}),
      contextScope: { kind: 'room_only' },
      // L0 is conversation only. No wake, assignment, execution, approval or inferred commitment.
      responsePolicy: 'none', mentions: [], idempotencyKey: 'aimp:' + envelope.id,
      sourceRef: { kind: 'aimp_l0', envelope, intentHash: digest },
    });
    const message = record(result.message);
    const ref = record(message.sourceRef);
    // ts/locale are outside the intent hash. A retry returns the stored original envelope.
    if (ref.intentHash !== digest) throw new KTeamError('aimp_id_conflict', 409);
    return { ok: true, reused: result.reused === true, messageId: message.messageId,
      roomSequence: message.roomSequence, envelope: ref.envelope, effect: 'conversation_only' };
  }
  async messages(roomId: string, after: number, limit: number,before?:number,tail=false) {
    const result = await this.upstream.messages(roomId, after, limit,before,tail);
    return { ...result, messages: rows(result.messages).map(message => ({
      messageId: message.messageId, roomId: message.roomId, threadId: message.threadId,
      sender: message.sender, text: message.text, roomSequence: message.roomSequence, createdAt: message.createdAt,
      ...(message.sourceRef && record(message.sourceRef).kind === 'aimp_l0'
        ? { envelope: record(message.sourceRef).envelope } : { protocol: 'legacy_display_only' }),
      ...(message.sourceRef&&record(message.sourceRef).kind==='aimp_reply'?{workRef:record(message.sourceRef).taskRef}:{}),
    })) };
  }
}
