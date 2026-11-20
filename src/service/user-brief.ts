import {createHash} from 'node:crypto';
import {fields, KTeamError, record, text} from '../errors.js';
import {notificationQuiet} from '../protocol/notification-preferences.js';
import {notificationPreferences} from './work-notifications.js';
import {findOwnerMessage, originalMessage} from './room-reads.js';
import type {Upstreams} from '../adapters/upstream.js';
import type {TeamStore} from './team-store.js';

const kinds = ['progress', 'eta', 'risk', 'decision', 'receipt', 'retract'] as const;
const day = 24 * 60 * 60_000;
const activeWindow = 15 * 60_000;
const normalize = (value: string) => value.normalize('NFKC').toLowerCase().replace(/[\p{P}\s]/gu, '');

export function replySuppression(value: string) {
  const body = value.trim().replace(/^```(?:json|text)?\s*\n([\s\S]*?)\n```$/i, '$1').trim();
  if (/^\{\s*"respond"\s*:\s*false\s*\}$/.test(body)) return 'no_new_contribution';
  if (/^[（(【\[]?\s*(?:无需(?:发言|回复)|不发言|no reply needed)\s*[。.!！]?[）)】\]]?$/i.test(body)) return 'internal_note_suppressed';
  return undefined;
}

export function userRequestedSilence(value: string) {
  const body = value.trim().replace(/[。.!！\s]+$/, '');
  return /^(?:(?:请)?(?:停止|停掉|停好|完成|处理完|做完)(?:这项(?:工作|任务))?(?:后|之后|了)?[，,\s]*)?(?:无需|不用|不必|不要|别)(?:再)?(?:回复|发言|通知)(?:我|了)?[我了]?$/.test(body) ||
    /^(?:please\s+)?(?:no reply needed|do not reply|don't reply)$/i.test(body);
}

export function parseUserBrief(input: unknown) {
  const value = record(input);
  fields(value, ['text', 'kind', 'expects_reply', 'refs']);
  const body = text(value.text, 'brief_text', 2000).trim();
  const kind = kinds.find(kind => kind === value.kind);
  const ref = value.refs;
  if (!kind || (value.expects_reply !== undefined && typeof value.expects_reply !== 'boolean') ||
    (ref !== undefined && (!Array.isArray(ref) || ref.length !== 1 || typeof ref[0] !== 'string' || !ref[0].trim() || ref[0].length > 256))) {
    throw new KTeamError('invalid_user_brief');
  }
  return {body, kind, expectsReply: value.expects_reply === true, sourceMessageId: ref?.[0] as string | undefined};
}
export type UserBrief = ReturnType<typeof parseUserBrief>;

export const userBriefTool = {
  name: 'notify_user',
  description: '为当前任务暂存一条面向本人、无需阻塞等待的私聊。仅用于需本人决定或处理的阻塞、用户等待的交付、影响承诺的 ETA 或风险变化、撤回上一条。群聊先提交对应的群内说明，成员私聊需引用已在来源群发布的 Bot 消息。写清变化、影响与用户动作；text 必须是群内说明中一段完整的面向本人短摘，不能等于整条说明。调用成功表示已暂存，私聊仍需通过宿主投递校验。禁止包含凭据、私聊内容、@协作请求或重复催办。',
  inputSchema: {
    type: 'object', additionalProperties: false, required: ['text', 'kind'],
    properties: {
      text: {type: 'string', minLength: 1, maxLength: 2000},
      kind: {enum: kinds},
      expects_reply: {type: 'boolean'},
      refs: {type: 'array', minItems: 1, maxItems: 1, items: {type: 'string', maxLength: 256}},
    },
  },
};

export async function deliverUserBrief(input: {
  upstream: Upstreams; store: TeamStore; brief: UserBrief; roomId: string; messageId: string; botId: string;
  jobId: string; taskRef?: string; guard: () => Promise<unknown>; direct: () => Promise<string>;
  send: (target: string, body: string, id: string) => Promise<any>;
}) {
  const {upstream, store, brief, roomId, messageId, botId, jobId} = input;
  const suppress = (reason: string) => ({delivery: 'suppressed' as const, deliveryReason: reason});
  if (replySuppression(brief.body)) return suppress('internal_note_suppressed');
  if (brief.kind === 'progress') return suppress('routine_progress');
  if (/[@\uff20][^\s@]|(?:输入|提供|告诉|给我|粘贴).{0,12}(?:密码|口令|验证码|密钥|password|secret|token)/i.test(brief.body)) return suppress('brief_content_denied');
  await input.guard();
  if (store.settings(roomId)?.kind !== 'group' || store.settings(roomId)?.paused) return suppress('brief_source_denied');
  const source = await upstream.membership(roomId);
  const active = (source.members as any[]).filter(member => member.status === 'active');
  if ((source.room as any)?.status !== 'active' || !active.some(member => member.subject?.userId === 'user.local') ||
    !active.some(member => member.subject?.logicalAgentId === botId)) return suppress('brief_source_denied');
  const message = await originalMessage(upstream, roomId, messageId);
  if (message?.roomId !== roomId || message.sender?.logicalAgentId !== botId || message.sourceRef?.kind !== 'aimp_reply' ||
    (input.taskRef && message.sourceRef.taskRef !== input.taskRef) || typeof message.text !== 'string' ||
    replySuppression(String(message.text)) || !normalize(brief.body) || !message.text.includes(brief.body) ||
    normalize(message.text) === normalize(brief.body)) return suppress('brief_source_invalid');

  const urgent = brief.kind === 'decision';
  const latestUser = await findOwnerMessage(upstream, roomId, candidate => candidate.sender?.userId === 'user.local');
  if (latestUser && userRequestedSilence(String(latestUser.text))) return suppress('user_requested_silence');
  if (!urgent && brief.kind !== 'retract' && Date.now() - Date.parse(latestUser?.createdAt ?? '') < activeWindow) return suppress('user_active_in_room');

  const prefix = 'user-brief:' + roomId + ':';
  const digest = createHash('sha256').update(JSON.stringify([botId, brief.kind, normalize(brief.body)])).digest('hex');
  const id = prefix + digest;
  const isQuiet = () => !urgent && (store.settings(roomId)?.quiet || notificationQuiet(notificationPreferences(store), Date.now()));
  if (store.operation(id)) return suppress('duplicate_suppressed');
  if (isQuiet()) return suppress('brief_quiet_hours');
  const targetRoomId = await input.direct();
  const prior = store.operationsWithPrefix(prefix).filter(row => row.botId === botId && row.targetRoomId === targetRoomId &&
    row.status === 'sent' && row.expectsReply && !row.retracts && !row.retractedBy && Number.isSafeInteger(row.roomSequence)).sort((a, b) => b.createdAt - a.createdAt)[0];
  if (brief.kind === 'retract') {
    if (!prior) return suppress('brief_nothing_to_retract');
    const reply = await findOwnerMessage(upstream, targetRoomId, candidate => candidate.sender?.userId === 'user.local' &&
      (candidate.replyToMessageId === prior.messageId || candidate.roomSequence > prior.roomSequence));
    if (reply) return suppress('brief_already_answered');
  }
  await input.guard();
  const reservation = store.transaction(() => {
    if (store.operation(id)) return {reason: 'duplicate_suppressed'};
    const now = Date.now();
    if (isQuiet()) return {reason: 'brief_quiet_hours'};
    const rows = store.operationsWithPrefix(prefix);
    const recent = rows.filter(row => row.createdAt > now - day);
    if (recent.length >= 3 || (!urgent && brief.kind !== 'retract' && recent.some(row => row.kind !== 'decision' && row.kind !== 'retract'))) return {reason: 'brief_budget_exhausted'};
    if (brief.kind === 'retract' && (store.operation(prior.id)?.revision !== prior.revision || rows.some(row => row.retracts === prior.id))) return {reason: 'brief_already_retracted'};
    return {op: store.saveOperation({id, roomId, sourceMessageId: messageId, targetRoomId, botId, jobId,
      kind: brief.kind, expectsReply: brief.expectsReply, retracts: brief.kind === 'retract' ? prior.id : undefined, status: 'sending', createdAt: now}, 0)};
  });
  if (!reservation.op) return suppress(reservation.reason!);
  const op = reservation.op;
  const title = String((source.room as any).title).replace(/[\r\n]/g, ' ').slice(0, 160);
  const body = '[来自「' + title + '」]\n' + (op.retracts ? '上一条待回复提醒已作废。\n' : '') + brief.body;
  try {
    const sent = await input.send(targetRoomId, body, id);
    if (!sent?.messageId || !Number.isSafeInteger(sent.roomSequence)) throw new KTeamError('brief_receipt_invalid', 502);
    store.transaction(() => {
      store.saveOperation({...op, status: 'sent', messageId: sent.messageId, roomSequence: sent.roomSequence}, op.revision);
      if (op.retracts) store.saveOperation({...prior, retractedBy: id}, prior.revision);
    });
    return {delivery: 'dm' as const, deliveryReason: brief.kind, roomId: targetRoomId, messageId: sent.messageId};
  } catch {
    store.saveOperation({...op, status:'unknown'}, op.revision);
    return suppress('brief_delivery_unknown');
  }
}
