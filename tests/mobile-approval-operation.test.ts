import { createHash } from "node:crypto";
import { mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { privateTempDir as mkdtempSync } from "./helpers/private-temp.js";
import { TeamStore } from "../src/service/team-store.js";
import { ToolApprovals } from "../src/service/tool-approvals.js";
import { MobileDevices, mobilePairFingerprint } from "../src/mobile/devices.js";
import { MobileFacade } from "../src/mobile/facade.js";
import { mobileB64, newMobileKeypair } from "../src/protocol/mobile-wire.js";
import { mobileApprovalOperationId } from "../src/protocol/mobile-approval-operation.js";

async function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "kteam-approval-op-")));
  const config = join(root, "config");
  mkdirSync(config);
  const previous = process.env.KTEAM_MODEL_CONFIG_DIR;
  process.env.KTEAM_MODEL_CONFIG_DIR = config;
  const store = new TeamStore(root);
  const devices = new MobileDevices(store);
  devices.configure({ action: "enable" });
  const invite = devices.invite(1);
  const key = newMobileKeypair();
  const peer = mobileB64(key.publicKey);
  const invitePrincipal = devices.authenticate(invite.payload.inviteId).principal;
  devices.pair(invitePrincipal, peer, { name: "手机" });
  devices.configure({
    action: "approve",
    id: invite.payload.inviteId,
    fingerprint: mobilePairFingerprint(peer),
    allowApprovals: true,
  });
  const credential = devices.pair(invitePrincipal, peer, { name: "手机" });
  devices.pair(invitePrincipal, peer, { action: "finish" });
  const device = devices.authenticate(credential.deviceId).principal;
  const approvals = new ToolApprovals(store);
  let decides = 0;
  const original = approvals.decide.bind(approvals);
  approvals.decide = async (value: unknown) => {
    decides += 1;
    return original(value);
  };
  const conversations={async scope(roomId:string){assert.equal(roomId,'room');}};
  const facade = new MobileFacade({ approvals, conversations, automation: { tick() {} } }, store, devices);
  return {
    store,
    device,
    approvals,
    facade,
    original,
    decisions: () => decides,
    async approval(command = "printf ok") {
      const controller = new AbortController();
      const work = approvals.ask(
        { roomId: "room", botId: "bot", jobId: "job-" + command },
        "bash",
        { command },
        controller.signal,
        async () => {},
      );
      const until = Date.now() + 3000;
      let row: any;
      while (!(row = approvals.list().find((item) => item.jobId === "job-" + command))) {
        if (Date.now() > until) throw Error("expected approval");
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      return { row, work, controller };
    },
    close() {
      approvals.close();
      store.close();
      if (previous === undefined) delete process.env.KTEAM_MODEL_CONFIG_DIR;
      else process.env.KTEAM_MODEL_CONFIG_DIR = previous;
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function digest(input: Record<string, unknown>) {
  return createHash("sha256").update(JSON.stringify({ method: "approvals.decide", input })).digest("hex");
}

test("approval operation id is bound to the approval, and executing or unknown is read without another decision", async () => {
  const f = await fixture();
  try {
    const { row, work, controller } = await f.approval();
    const operationId = mobileApprovalOperationId(row.id);
    assert.equal(operationId.includes(String(row.id)), false);
    assert.equal(operationId.includes("allow"), false);
    await assert.rejects(
      f.facade.call(f.device, "approvals.decide", {
        operationId: "approval_" + "ab".repeat(16),
        id: row.id,
        expectedHash: row.hash,
        decision: "allow_once",
      }),
      /mobile_operation_invalid/,
    );
    const mobileId = "mobile-operation:" + f.device.id + ":" + operationId;
    const input = { id: row.id, expectedHash: row.hash, decision: "allow_once" };
    f.store.saveOperation({
      id: mobileId,
      deviceId: f.device.id,
      method: "approvals.decide",
      digest: digest(input),
      approvalId: row.id,
      decision: "allow_once",
      expectedHash: row.hash,
      status: "executing",
      createdAt: Date.now(),
    }, 0);
    await assert.rejects(
      f.facade.call(f.device, "approvals.decide", { operationId, ...input }),
      /mobile_operation_unknown/,
    );
    assert.equal(f.decisions(), 0);
    assert.equal(f.store.operation(row.id).status, "pending");
    const current = f.store.operation(mobileId);
    f.store.saveOperation({ ...current, status: "unknown" }, current.revision);
    const viewed = await f.facade.call(f.device, "operations.get", { operationId });
    assert.equal(viewed.status, "unknown");
    assert.equal(f.decisions(), 0);
    assert.equal(f.store.operation(row.id).status, "pending");
    controller.abort();
    assert.equal(await work, false);
  } finally {
    f.close();
  }
});

test("a committed approval is not executed again when the mobile row is still executing, and the opposite decision conflicts", async () => {
  const f = await fixture();
  try {
    const { row, work } = await f.approval("printf committed");
    const operationId = mobileApprovalOperationId(row.id);
    const input = { id: row.id, expectedHash: row.hash, decision: "allow_once" };
    await f.facade.call(f.device, "approvals.decide", { operationId, ...input });
    assert.equal(await work, true);
    assert.equal(f.decisions(), 1);
    assert.equal(f.store.operation(row.id).status, "allowed");
    assert.deepEqual(await f.facade.call(f.device,"operations.get",{operationId}),{
      ok:true,status:"completed",result:{ok:true,status:"allowed",decision:"allow_once",matchesRequest:true},
    });
    const mobileId = "mobile-operation:" + f.device.id + ":" + operationId;
    const saved = f.store.operation(mobileId);
    f.store.saveOperation({ ...saved, status: "executing" }, saved.revision);
    await assert.rejects(
      f.facade.call(f.device, "approvals.decide", { operationId, ...input }),
      /mobile_operation_unknown/,
    );
    assert.equal(f.decisions(), 1);
    assert.equal(f.store.operation(row.id).status, "allowed");
    f.store.saveOperation({ ...f.store.operation(mobileId), status: "completed", result: saved.result }, f.store.operation(mobileId).revision);
    await assert.rejects(
      f.facade.call(f.device, "approvals.decide", { operationId, ...input, decision: "deny" }),
      /mobile_operation_conflict/,
    );
    assert.equal(f.decisions(), 1);
    assert.equal(f.store.operation(row.id).decision, "allow_once");
  } finally {
    f.close();
  }
});

test("not_received does not replay a decision that is no longer pending, and a pending retry uses the same operation", async () => {
  const f = await fixture();
  try {
    const decided = await f.approval("printf decided");
    await f.original({ id: decided.row.id, expectedHash: decided.row.hash, decision: "deny" });
    assert.equal(await decided.work, false);
    assert.equal(f.decisions(), 0, "the direct desktop decision is outside the phone entry count");
    const operationId = mobileApprovalOperationId(decided.row.id);
    await assert.rejects(
      f.facade.call(f.device, "approvals.decide", {
        operationId,
        id: decided.row.id,
        expectedHash: decided.row.hash,
        decision: "deny",
      }),
      /tool_approval_changed/,
    );
    assert.equal(f.store.operation("mobile-operation:" + f.device.id + ":" + operationId), null);
    assert.equal(f.store.operation(decided.row.id).status, "denied");
    const missing = await f.facade.call(f.device, "operations.get", { operationId });
    assert.equal(missing.status, "not_received");

    const pending = await f.approval("printf pending");
    const retryId = mobileApprovalOperationId(pending.row.id);
    await f.facade.call(f.device, "approvals.decide", {
      operationId: retryId,
      id: pending.row.id,
      expectedHash: pending.row.hash,
      decision: "allow_once",
    });
    assert.equal(await pending.work, true);
    assert.equal(f.decisions(), 1);
    assert.equal(f.store.operation(pending.row.id).status, "allowed");
  } finally {
    f.close();
  }
});

test("two phone decisions and a desktop race admit one committed decision", async () => {
  const f = await fixture();
  try {
    const phone = await f.approval("printf phone-race");
    const operationId = mobileApprovalOperationId(phone.row.id);
    const input = { id: phone.row.id, expectedHash: phone.row.hash };
    const raced = await Promise.allSettled([
      f.facade.call(f.device, "approvals.decide", { operationId, ...input, decision: "allow_once" }),
      f.facade.call(f.device, "approvals.decide", { operationId, ...input, decision: "deny" }),
    ]);
    assert.equal(raced.filter((item) => item.status === "fulfilled").length, 1);
    assert.equal(f.decisions(), 1);
    assert.ok(["allowed", "denied"].includes(f.store.operation(phone.row.id).status));
    await phone.work;

    const both = await f.approval("printf both-ends");
    const bothId = mobileApprovalOperationId(both.row.id);
    const before = f.decisions();
    const ends = await Promise.allSettled([
      f.facade.call(f.device, "approvals.decide", {
        operationId: bothId,
        id: both.row.id,
        expectedHash: both.row.hash,
        decision: "allow_once",
      }),
      f.original({ id: both.row.id, expectedHash: both.row.hash, decision: "deny" }),
    ]);
    assert.equal(ends.filter((item) => item.status === "fulfilled").length, 1);
    assert.ok(f.decisions() - before <= 1);
    assert.ok(["allowed", "denied"].includes(f.store.operation(both.row.id).status));
    await both.work;
  } finally {
    f.close();
  }
});
