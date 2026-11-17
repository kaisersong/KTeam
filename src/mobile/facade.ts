import { randomUUID, createHash } from "node:crypto";
import { hostname } from "node:os";
import { KTeamError, record, fields, text } from "../errors.js";
import type { TeamStore } from "../service/team-store.js";
import type { MobileDevices, MobilePrincipal } from "./devices.js";
import { generatedFilePreview } from "../runtime/generated-files.js";
import { generatedFileRecords } from "../runtime/generated-file-receipts.js";
import { BotCapabilities } from "../service/bot-capabilities.js";
export class MobileFacade {
  constructor(
    private deps: any,
    private store: TeamStore,
    private devices: MobileDevices,
  ) {}
  private assert(p: MobilePrincipal, approve = false) {
    if (p.kind !== "device") throw new KTeamError("mobile_pair_required", 403);
    this.devices.assert(p, approve);
  }
  async call(p: MobilePrincipal, method: string, value: unknown) {
    this.assert(p, method === "approvals.decide");
    const input = record(value ?? {});
    const write = [
      "messages.send",
      "attachments.stage",
      "attachments.cancel",
      "attachments.send",
      "questions.answer",
      "approvals.decide",
      "inbox.change",
      "work.stop",
      "messages.seen",
    ].includes(method);
    if (!write) {
      const result = await this.read(p, method, input);
      this.assert(p);
      return result;
    }
    const operationId = text(input.operationId, "operation_id");
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(operationId))
      throw new KTeamError("mobile_operation_invalid");
    const payload = { ...input };
    delete payload.operationId;
    const id = "mobile-operation:" + p.id + ":" + operationId,
      digest = createHash("sha256")
        .update(JSON.stringify({ method, input: payload }))
        .digest("hex"),
      prior = this.store.operation(id);
    if (prior) {
      if (prior.digest !== digest)
        throw new KTeamError("mobile_operation_conflict", 409);
      if (prior.status === "completed") return prior.result;
      if (prior.status === "rejected") throw new KTeamError(prior.code, 409);
      throw new KTeamError("mobile_operation_unknown", 409);
    }
    this.store.saveOperation(
      {
        id,
        deviceId: p.id,
        method,
        digest,
        ...(["messages.send", "attachments.send"].includes(method)
          ? { roomId: payload.roomId, messageId: payload.id }
          : {}),
        status: "executing",
        createdAt: Date.now(),
      },
      0,
    );
    try {
      const result = await this.write(p, method, payload),
        current = this.store.operation(id);
      this.store.saveOperation(
        { ...current, status: "completed", result },
        current.revision,
      );
      return result;
    } catch (error) {
      const current = this.store.operation(id);
      const rejected =
        error instanceof KTeamError &&
        error.status < 500 &&
        !/unknown/.test(error.code);
      this.store.saveOperation(
        {
          ...current,
          status: rejected ? "rejected" : "unknown",
          code:
            error instanceof KTeamError
              ? error.code
              : "mobile_operation_unknown",
        },
        current.revision,
      );
      throw error;
    }
  }
  private async read(p: MobilePrincipal, method: string, i: any) {
    const d = this.deps;
    switch (method) {
      case "hello":
        fields(i, []);
        return {
          ok: true,
          protocol: 1,
          installationId: this.devices.installationId,
          computerName: hostname(),
          hostEpoch: d.epoch,
          capabilities: [
            "messages",
            "attachments",
            "mentions",
            "artifacts",
            "inbox",
            "approval_once",
            "single_chat_skills",
          ],
        };
      case "rooms.list": {
        fields(i, []);
        const result = await d.collaboration.teams();
        const rooms = (result.rooms ?? []).filter(
          (r: any) =>
            this.store.settings(r.roomId) &&
            this.store.settings(r.roomId)?.kind !== "peer",
        );
        return {
          ok: true,
          rooms: await d.sidebar.decorate(
            rooms.map((r: any) => ({
              ...r,
              kind: this.store.settings(r.roomId)?.kind ?? "group",
            })),
          ),
        };
      }
      case "bots.list": {
        fields(i, []);
        const result = await d.collaboration.bots();
        return {
          ok: true,
          bots: result.bots.map((b: any) => ({
            id: b.id,
            name: b.name,
            isAssistant: d.automation.assistant.identity()?.botId === b.id,
          })),
        };
      }
      case "messages.page":
        return d.conversationUpdates.history(i);
      case "conversations.updates":
        return d.conversationUpdates.read(i);
      case "inbox.read":
        fields(i, []);
        return d.inboxSource();
      case "group.members": {
        fields(i, ["roomId"]);
        const roomId = text(i.roomId, "room_id");
        await d.conversations.scope(roomId);
        const result = await d.upstream.membership(roomId);
        return {
          ok: true,
          members: result.members
            .filter((m: any) => m.status === "active")
            .map((m: any) => ({ subject: m.subject })),
        };
      }
      case "artifacts.list": {
        fields(i, ["roomId", "cursor"]);
        await d.conversations.scope(text(i.roomId, "room_id"));
        const r = generatedFileRecords(this.store, i.roomId, i.cursor);
        await d.conversations.scope(i.roomId);
        return r;
      }
      case "artifacts.preview": {
        fields(i, ["roomId", "toolCallId"]);
        await d.conversations.scope(text(i.roomId, "room_id"));
        const r = generatedFilePreview(
          this.store,
          i.roomId,
          text(i.toolCallId, "tool_call_id"),
        );
        await d.conversations.scope(i.roomId);
        return r;
      }
      case "attachments.preview":
        return d.composerAttachments.preview(i);
      case "skills.list": {
        fields(i, ["roomId", "botId"]);
        const result = await new BotCapabilities(d.upstream, this.store).view(
          text(i.botId, "bot_id"),
          text(i.roomId, "room_id"),
        );
        return result;
      }
      case "operations.get": {
        fields(i, ["operationId"]);
        let op = this.store.operation(
          "mobile-operation:" +
            p.id +
            ":" +
            text(i.operationId, "operation_id"),
        );
        if (
          op &&
          ["executing", "unknown"].includes(op.status) &&
          op.roomId &&
          op.messageId
        ) {
          await d.conversations.scope(op.roomId);
          if (op.method === "attachments.send")
            await d.composerAttachments.view(op.roomId);
          else await d.automation.reconcileSubmissions(op.roomId);
          const original = this.store.submission(op.messageId);
          if (
            original?.state === "sent" &&
            original.roomId === op.roomId &&
            original.originId
          ) {
            const current = this.store.operation(op.id);
            op = this.store.saveOperation(
              {
                ...current,
                status: "completed",
                result: {
                  ok: true,
                  messageId: original.originId,
                  reconciled: true,
                },
              },
              current.revision,
            );
          }
        }
        return op
          ? {
              ok: true,
              status: op.status,
              result: op.status === "completed" ? op.result : undefined,
              code: op.code,
            }
          : { ok: true, status: "not_received" };
      }
      default:
        throw new KTeamError("mobile_method_forbidden", 403);
    }
  }
  private uploadId(p: MobilePrincipal, value: unknown) {
    const id = text(value, "upload_id");
    if (!/^upload_[a-f0-9]{32}$/.test(id))
      throw new KTeamError("attachment_invalid");
    return (
      "upload_" +
      createHash("sha256")
        .update(p.id + ":" + id)
        .digest("hex")
        .slice(0, 32)
    );
  }
  private async write(p: MobilePrincipal, method: string, i: any) {
    const d = this.deps;
    this.assert(p, method === "approvals.decide");
    switch (method) {
      case "messages.send": {
        fields(i, [
          "roomId",
          "id",
          "text",
          "createdAt",
          "mentions",
          "replyToMessageId",
        ]);
        const roomId = text(i.roomId, "room_id");
        await d.conversations.owner(roomId);
        const createdAt = text(i.createdAt, "created_at");
        if (!Number.isFinite(Date.parse(createdAt)))
          throw new KTeamError("mobile_time_invalid");
        return d.sendHumanMessage({
          aimp: "1.0",
          id: text(i.id, "message_id"),
          room_id: roomId,
          thread_id: "thread-" + roomId,
          from: "human://kteam.local/user.local",
          to: [],
          mentions: i.mentions ?? [],
          ts: createdAt,
          act: "chat",
          source_level: "principal",
          classification: "internal",
          ...(i.replyToMessageId
            ? { reply_to: text(i.replyToMessageId, "message_id") }
            : {}),
          body: text(i.text, "text"),
        });
      }
      case "attachments.stage":
        return d.composerAttachments.stage({
          ...i,
          id: this.uploadId(p, i.id),
        });
      case "attachments.cancel":
        return d.composerAttachments.cancel({
          ...i,
          id: this.uploadId(p, i.id),
        });
      case "attachments.send": {
        await new BotCapabilities(d.upstream, this.store).validateCommand(
          text(i.roomId, "room_id"),
          String(i.text ?? ""),
        );
        const r = await d.composerAttachments.send({
          ...i,
          uploadIds: Array.isArray(i.uploadIds)
            ? i.uploadIds.map((id: unknown) => this.uploadId(p, id))
            : i.uploadIds,
        });
        void d.automation.tick();
        return r;
      }
      case "approvals.decide": {
        fields(i, ["id", "expectedHash", "decision"]);
        if (!["allow_once", "deny"].includes(i.decision))
          throw new KTeamError("mobile_approval_scope_forbidden", 403);
        const result = await d.approvals.decide(i);
        void d.automation.tick();
        return result;
      }
      case "questions.answer":
        return d.automation.privateChats.answer(i);
      case "work.stop":
        fields(i, ["roomId"]);
        await d.conversations.owner(text(i.roomId, "room_id"));
        return d.automation.pause(i.roomId);
      case "messages.seen": {
        const roomId = text(i.roomId, "room_id");
        await d.conversations.scope(roomId);
        fields(i, ["roomId", "sequences"]);
        if (
          !Array.isArray(i.sequences) ||
          i.sequences.length > 300 ||
          i.sequences.some((v: any) => !Number.isSafeInteger(v) || v < 1)
        )
          throw new KTeamError("invalid_input");
        this.store.markSeen(roomId, i.sequences);
        return { ok: true };
      }
      case "inbox.change": {
        const current = d.inboxSource();
        return d.inboxState.change(
          i,
          Object.entries(current).flatMap(([k, rows]) =>
            Array.isArray(rows) &&
            [
              "questions",
              "approvals",
              "proposals",
              "creations",
              "jobs",
            ].includes(k)
              ? rows.map((item: any) =>
                  d.inboxState.project(
                    (
                      {
                        questions: "question",
                        approvals: "approval",
                        proposals: "proposal",
                        creations: "creation",
                        jobs: "job",
                      } as any
                    )[k],
                    item,
                  ),
                )
              : [],
          ),
        );
      }
      default:
        throw new KTeamError("mobile_method_forbidden", 403);
    }
  }
}
