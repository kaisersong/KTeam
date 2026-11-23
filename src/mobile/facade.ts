import {previewMessageReference} from '../service/message-references.js';
import { randomUUID, createHash } from "node:crypto";
import { hostname } from "node:os";
import { KTeamError, record, fields, text } from "../errors.js";
import type { TeamStore } from "../service/team-store.js";
import type { MobileDevices, MobilePrincipal } from "./devices.js";
import { generatedFilePreview } from "../runtime/generated-files.js";
import { generatedFileRecords } from "../runtime/generated-file-receipts.js";
import { isMobileWrite } from "../protocol/mobile-write-entry.js";
import { Plugins } from "../service/plugins.js";
import { modelCatalog } from "../runtime/native.js";
import { BotCapabilities } from "../service/bot-capabilities.js";
import { mobileApprovalOperationId } from "../protocol/mobile-approval-operation.js";
import { projectInbox } from "../service/inbox.js";

const dailyWorkWrites=new Set(["dailyWork.watch","dailyWork.preset","dailyWork.confirm","dailyWork.refresh","dailyWork.snooze","dailyWork.replyDraft"]);
const scopedWorkWrites=new Set(["artifacts.peerReview","artifacts.reviewDecision","routines.save","routines.trial","routines.pause","routines.remove"]);

export class MobileFacade {
  private inboxSequence = 0;
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
    const write=isMobileWrite(method)||method==="messages.seen";
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
    if (method === "approvals.decide") {
      if (!["allow_once", "deny"].includes(String(payload.decision)))
        throw new KTeamError("mobile_approval_scope_forbidden", 403);
      const approvalId = text(payload.id, "approval_id");
      if (operationId !== mobileApprovalOperationId(approvalId))
        throw new KTeamError("mobile_operation_invalid");
    }
    const id = "mobile-operation:" + p.id + ":" + operationId,
      digest = createHash("sha256")
        .update(JSON.stringify({ method, input: payload }))
        .digest("hex"),
      prior = this.store.operation(id);
    if (prior) {
      if (prior.digest !== digest)
        throw new KTeamError("mobile_operation_conflict", 409);
      if (prior.status === "completed") {
        if(scopedWorkWrites.has(prior.method))await this.deps.conversations.owner(text(prior.roomId,"room_id"));
        if(dailyWorkWrites.has(prior.method))return this.dailyReceipt(p,prior);
        this.assert(p);
        return prior.result;
      }
      if (prior.status === "rejected") throw new KTeamError(prior.code, 409);
      throw new KTeamError("mobile_operation_unknown", 409);
    }
    if (method === "approvals.decide") {
      const approval = this.store.operation(String(payload.id));
      if (
        !approval ||
        approval.status !== "pending" ||
        approval.hash !== payload.expectedHash
      )
        throw new KTeamError("tool_approval_changed", 409);
    }
    this.store.saveOperation(
      {
        id,
        deviceId: p.id,
        method,
        digest,
        ...(["messages.send", "attachments.send"].includes(method)
          ? { roomId: payload.roomId, messageId: payload.id }
          : scopedWorkWrites.has(method)||dailyWorkWrites.has(method)?{roomId:payload.roomId}:{}),
        ...(method==="dailyWork.replyDraft"?{sourceItemId:payload.id}:{}),
        ...(method === "approvals.decide"
          ? {
              approvalId: payload.id,
              decision: payload.decision,
              expectedHash: payload.expectedHash,
            }
          : {}),
        status: "executing",
        createdAt: Date.now(),
      },
      0,
    );
    try {
      const requestId=createHash("sha256").update(id).digest("hex");
      const result = await this.write(p, method, payload, requestId),
        current = this.store.operation(id);
      const receipt=method==="dailyWork.confirm"?{appliedRevision:result.appliedRevision}
        :method==="dailyWork.watch"||method==="dailyWork.preset"||method==="dailyWork.refresh"||method==="dailyWork.snooze"?{ok:true}:result;
      this.store.saveOperation(
        { ...current, status: "completed", result:receipt },
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
  private async dailyScope(p:MobilePrincipal,room:unknown){
    const d=this.deps;
    const daily=d.automation.dailyWork as import("../service/assistant-daily.js").AssistantDaily|undefined;
    if(!daily||d.automation.assistant.identity()?.roomId!==text(room,"room_id"))throw new KTeamError("assistant_scope_required",403);
    await d.automation.assistant.verifyDailyScope();
    this.assert(p);
    return daily;
  }
  private async dailyReceipt(p:MobilePrincipal,op:any){
    const daily=await this.dailyScope(p,op.roomId);
    if(op.method==="dailyWork.watch")return daily.watches.view(()=>this.assert(p));
    if(op.method==="dailyWork.preset")return daily.planView();
    if(op.method==="dailyWork.confirm")return {...daily.planView(),appliedRevision:op.result.appliedRevision};
    if(op.method==="dailyWork.replyDraft"){
      await daily.assertItemVisible({id:op.sourceItemId});
      this.assert(p);
      return op.result;
    }
    const result=await daily.view();
    this.assert(p);
    return result;
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
            "artifact_review_read",
            "conversation_work_details",
            "artifact_review_write",
            "routine_management",
            ...(d.automation.dailyWork?["assistant_daily_work","assistant_watch"]:[]),
            "declarative_plugins",
            "member_creation",
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
      case "dailyWork.plan":
      case "dailyWork.watches":
      case "dailyWork.today":
      case "dailyWork.sources":
      case "dailyWork.news":
      case "dailyWork.original": {
        const {roomId,...input}=i;
        const daily=await this.dailyScope(p,roomId);
        if(method==="dailyWork.sources"){
          fields(input,["yzj"]);
          if(typeof input.yzj!=="boolean")throw new KTeamError("daily_invalid_input");
          return daily.catalog(input.yzj);
        }
        if(method==="dailyWork.news")return daily.news(input);
        if(method==="dailyWork.original")return daily.original(input);
        fields(input,[]);
        if(method==="dailyWork.watches")return daily.watches.view(()=>this.assert(p));
        return method==="dailyWork.plan"?daily.clientPlan():daily.view();
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
      case "messages.reference":
        return previewMessageReference(d.upstream,i);
      case "messages.page":
        return d.conversationUpdates.history(i);
      case "conversations.updates":
        return d.conversationUpdates.read(i);
      case "inbox.read": {
        fields(i, []);
        const snapshot = projectInbox(d.inboxState, d.inboxSource());
        return {
          ...snapshot,
          attentionCursor: { epoch: d.epoch, sequence: ++this.inboxSequence },
        };
      }
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
      case "work.list": {
        fields(i, ["roomId","before"]);
        const result=await d.conversationUpdates.records(i);
        return {ok:true,nextBefore:result.nextBefore,jobs:result.jobs.filter((job:any)=>job.groupPlanAvailable||job.workEvidenceAvailable||job.peerReviewVersion)
          .map(({id,createdAt,state,groupPlanAvailable,workEvidenceAvailable,peerReviewVersion}:any)=>({id,createdAt,state,groupPlanAvailable,workEvidenceAvailable,peerReviewVersion}))};
      }
      case "work.stageEvidence":
        return d.conversationUpdates.stageEvidence(i);
      case "work.detail": {
        fields(i, ["roomId","jobId"]);
        const roomId=text(i.roomId,"room_id");
        const {job,viewRevision}=await d.conversationUpdates.detail({roomId,jobId:text(i.jobId,"job_id"),part:"summary"});
        return {ok:true,viewRevision,work:{
          groupPlan:job.groupPlan,workEvidence:job.workEvidence,workEvidenceLimited:job.workEvidenceLimited,
          peerReviewVersion:job.peerReviewVersion,peerReviewStale:job.peerReviewStale,
        }};
      }
      case "routines.list": {
        fields(i, ["roomId"]);
        const roomId=text(i.roomId,"room_id");
        const [routines,catalog,scope]=await Promise.all([
          d.automation.routines.list(roomId),d.collaboration.bots(),d.conversations.scope(roomId),
        ]);
        const ids=new Set(scope.members.filter((member:any)=>member.status==="active"&&member.subject.kind==="agent").map((member:any)=>member.subject.logicalAgentId));
        const candidates=catalog.bots.filter((bot:any)=>ids.has(bot.id)&&this.store.binding(bot.id)?.kind==="xiaok-hosted")
          .map(({id,name}:any)=>({id,name}));
        await d.conversations.scope(roomId);
        return {...routines,candidates};
      }
      case "messages.get": {
        fields(i, ["roomId","messageId"]);
        return d.conversations.message(text(i.roomId,"room_id"),text(i.messageId,"message_id"));
      }
      case "plugins.list":
        fields(i, []);
        return new Plugins(this.store).list();
      case "plugins.commands":
        fields(i, []);
        return new Plugins(this.store).commands();
      case "plugins.draft":
        return new Plugins(this.store).draft(i);
      case "plugins.preview":
        return new Plugins(this.store).preview(i);
      case "members.models": {
        fields(i, []);
        const {models,defaultModelId}=await modelCatalog();
        return {ok:true,models:models.map(({id,label})=>({id,label})),defaultModelId};
      }
      case "artifacts.review": {
        fields(i, ["roomId", "toolCallId"]);
        const roomId = text(i.roomId, "room_id");
        const toolCallId = text(i.toolCallId, "tool_call_id");
        const { name, sha256, baselineSha256, historical, lines, peerReviewers, decision } =
          await d.artifactReview.view(roomId, toolCallId, { reconcile: false });
        return { ok: true, name, sha256, baselineSha256, historical, lines, peerReviewers, decision };
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
        if(op?.status==="completed"&&scopedWorkWrites.has(op.method))await d.conversations.owner(text(op.roomId,"room_id"));
        const result=op?.status==="completed"?(dailyWorkWrites.has(op.method)?await this.dailyReceipt(p,op):op.result):undefined;
        return op
          ? {
              ok: true,
              status: op.status,
              result,
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
  private async write(p: MobilePrincipal, method: string, i: any, requestId: string) {
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
        const result = await d.approvals.decide(i, () => this.assert(p, true));
        void d.automation.tick();
        return result;
      }
      case "questions.answer":
        return d.automation.privateChats.answer(i);
      case "artifacts.peerReview":
      case "artifacts.reviewDecision": {
        const {roomId,...input}=i;
        await d.conversations.owner(text(roomId,"room_id"));
        const assertCurrent=()=>this.assert(p);
        assertCurrent();
        const result=method==="artifacts.peerReview"
          ?await d.artifactReview.requestPeer(roomId,{...input,requestId},assertCurrent)
          :await d.artifactReview.submit(roomId,input,assertCurrent);
        void d.automation.tick();
        return result;
      }
      case "dailyWork.watch":
      case "dailyWork.preset":
      case "dailyWork.confirm":
      case "dailyWork.refresh":
      case "dailyWork.snooze":
      case "dailyWork.replyDraft": {
        const {roomId,...input}=i;
        const daily=await this.dailyScope(p,roomId);
        const guard=()=>this.assert(p);
        if(method==="dailyWork.watch")return daily.watches.change(input,guard);
        if(method==="dailyWork.preset")return daily.choosePreset(input,guard);
        if(method==="dailyWork.confirm")return daily.confirm(input,guard);
        if(method==="dailyWork.snooze")return daily.snooze(input,guard);
        if(method==="dailyWork.replyDraft")return daily.replyDraft(input,d.automation.assistant.identity().botId,guard);
        fields(input,[]);
        const result=await daily.refresh();
        guard();
        return result;
      }
      case "routines.save":
      case "routines.trial":
      case "routines.pause":
      case "routines.remove": {
        await d.conversations.owner(text(i.roomId,"room_id"));
        const assertCurrent=()=>this.assert(p);
        const routines=d.automation.routines;
        const result=method==="routines.save"?await routines.save({...i,requestId},assertCurrent)
          :method==="routines.trial"?await routines.trial({...i,requestId},assertCurrent)
          :method==="routines.pause"?await routines.pause(i,assertCurrent)
          :await routines.remove(i,assertCurrent);
        if(method==="routines.trial")void d.automation.tick();
        return result;
      }
      case "plugins.install":
        return new Plugins(this.store).install(i);
      case "plugins.change":
        return new Plugins(this.store).change(i);
      case "members.create":
        return d.coordinator.createMember({...i,requestId},{requestSource:"user",assertCurrent:()=>this.assert(p)});
      case "work.stageReview":
        return d.conversationUpdates.reviewStage(i,()=>this.assert(p));
      case "work.append": {
        await d.conversations.owner(text(i.roomId,"room_id"));this.assert(p);
        const result=await d.automation.inputs!.submit({...i,id:"msg_"+createHash("sha256").update(requestId).digest("hex").slice(0,32)});void d.automation.tick();return result;
      }
      case "work.stopJob": {
        fields(i,["roomId","jobId"]);
        await d.conversations.owner(text(i.roomId,"room_id"));this.assert(p);
        return d.automation.stopWork(i.roomId,text(i.jobId,"job_id"));
      }
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
