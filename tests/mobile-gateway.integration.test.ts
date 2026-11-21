import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { TeamStore } from "../src/service/team-store.js";
import { MobileDevices, mobilePairFingerprint } from "../src/mobile/devices.js";
import { MobileGateway } from "../src/mobile/gateway.js";
import { mobileB64 } from "../src/protocol/mobile-wire.js";
import { mobileClient } from "./helpers/mobile-client.js";
import { realUpstreams } from "./helpers/real-upstreams.js";
import { TeamCoordinator } from "../src/service/coordination.js";
import { startHost } from "../src/service/server.js";
import { hostRequest } from "../src/service/client.js";
import { initConfig } from "../src/service/config.js";
import { recordGeneratedFile } from "../src/runtime/generated-file-receipts.js";
import { captureGeneratedFile } from "../src/runtime/generated-files.js";
test("actual encrypted gateway requires desktop confirmation, independent device identity, persisted restart and immediate connection revocation", async () => {
  const root = mkdtempSync(join(tmpdir(), "kt-mobile-")),
    store = new TeamStore(root),
    devices = new MobileDevices(store);
  devices.configure({ action: "enable" });
  let calls = 0;
  let gateway = new MobileGateway(devices, async () => ({
    ok: true,
    calls: ++calls,
  }));
  let pair: any, phone: any;
  try {
    await gateway.start();
    const { payload } = devices.invite(gateway.port),
      url = "ws://127.0.0.1:" + gateway.port + "/mobile/connect";
    pair = await mobileClient(url, {
      credentialId: payload.inviteId,
      secret: payload.secret,
      publicKey: payload.publicKey,
    });
    await assert.rejects(
      pair.call("rooms.list"),
      /mobile_pair_required|mobile_method/,
    );
    assert.equal((await pair.call("pair", { name: "合成手机" })).pending, true);
    devices.configure({
      action: "approve",
      id: payload.inviteId,
      fingerprint: mobilePairFingerprint(mobileB64(pair.key.publicKey)),
      allowApprovals: true,
    });
    const credential = await pair.call("pair", { name: "合成手机" });
    assert.equal(credential.paired, true);
    const saved = {
      credentialId: credential.deviceId,
      secret: credential.secret,
      publicKey: credential.publicKey,
    };
    await pair.call("pair", { action: "finish" });
    pair.close();
    phone = await mobileClient(url, saved, pair.key);
    assert.equal((await phone.call("hello")).calls, 1);
    phone.close();
    await gateway.close();
    gateway = new MobileGateway(new MobileDevices(store), async () => ({
      ok: true,
      calls: ++calls,
    }));
    await gateway.start();
    assert.equal(
      "ws://127.0.0.1:" + gateway.port + "/mobile/connect",
      url,
      "desktop restart must retain the endpoint already saved on the phone",
    );
    phone = await mobileClient(url, saved, pair.key);
    assert.equal((await phone.call("hello")).calls, 2);
    gateway.devices.configure({ action: "revoke", id: saved.credentialId });
    gateway.reconcile();
    await assert.rejects(phone.call("hello"));
    assert.throws(
      () => gateway.devices.authenticate(saved.credentialId),
      /mobile_auth_required/,
    );
  } finally {
    pair?.close();
    phone?.close();
    await gateway.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
test("original host mobile facade reads real rooms and receipts without main credentials, rejects privileged methods and revokes archived Room access", async () => {
  const f = await realUpstreams();
  const root = join(f.root, "host");
  mkdirSync(root, { mode: 0o700 });
  let store = new TeamStore(root);
  const coordinator = new TeamCoordinator(f.upstream, store, 1, {
    catalog: async () => ({ defaultModelId: "fixture" }),
    identity: async () => ({ model: "fixture", fingerprint: "fixture" }),
  });
  let host: any, pair: any, phone: any;
  try {
    const member = await coordinator.createMember(
      { name: "移动验收员", modelId: "fixture", requestId: "mobile-member" },
      { requestSource: "user" },
    );
    const deliveryMember = await coordinator.createMember(
      { name: "交付员", modelId: "fixture", requestId: "mobile-delivery-member" },
      { requestSource: "user" },
    );
    store.setState("assistant-proactivity", { enabled: false });
    const path = join(f.root, "mobile-report.md");
    writeFileSync(path, "# 合成手机产物\n");
    for (const actor of [member, deliveryMember]) {
      const jobId = "mobile-file-job:" + actor.roomId;
      store.enqueue(jobId, actor.roomId, "synthetic-origin");
      const job = store.job(jobId);
      job.activeBotId = actor.bot.id;
      job.state = "delivered";
      job.results = [{botId:actor.bot.id,messageId:"synthetic-delivery"}];
      store.save(job);
      recordGeneratedFile(store, job, {
        id: "mobile-file-call",
        name: "write",
        state: "completed",
        botId: actor.bot.id,
        file: captureGeneratedFile(path, root, actor.roomId),
      });
    }
    store.switchSource(member.bot.id, null, "synthetic");
    store.close();
    initConfig(root, {
      version: 1,
      brokerUrl: f.upstream.options.brokerUrl,
      kswarmUrl: f.upstream.options.kswarmUrl,
    });
    host = await startHost({ root, upstream: f.upstream.options });
    await assert.rejects(
      hostRequest(root, "kteam-companion", "/v1/mobile/settings", {
        action: "enable",
      }),
      /mobile_admin_forbidden/,
    );
    await assert.rejects(
      hostRequest(root, "kteam-companion", "/v1/work/pause-all", {}),
      /app_settings_forbidden/,
    );
    await hostRequest(root, "kteam-main", "/v1/work/pause-all", {});
    assert.equal((await hostRequest(root, "kteam-main", "/v1/status")).workPaused, true);
    await assert.rejects(
      hostRequest(root, "kteam-companion", "/v1/work/resume-all", {}),
      /app_settings_forbidden/,
    );
    await hostRequest(root, "kteam-main", "/v1/work/resume-all", {});
    const settings = await hostRequest(
      root,
      "kteam-main",
      "/v1/mobile/settings",
      { action: "enable" },
    );
    const invite: any = await hostRequest(
      root,
      "kteam-main",
      "/v1/mobile/settings",
      { action: "invite" },
    );
    const url = "ws://127.0.0.1:" + settings.port + "/mobile/connect";
    pair = await mobileClient(url, {
      credentialId: invite.payload.inviteId,
      secret: invite.payload.secret,
      publicKey: invite.payload.publicKey,
    });
    await pair.call("pair", { name: "隔离验收手机" });
    await hostRequest(root, "kteam-main", "/v1/mobile/settings", {
      action: "approve",
      id: invite.payload.inviteId,
      fingerprint: mobilePairFingerprint(mobileB64(pair.key.publicKey)),
      allowApprovals: true,
    });
    const credential = await pair.call("pair", { name: "隔离验收手机" });
    await pair.call("pair", { action: "finish" });
    pair.close();
    phone = await mobileClient(
      url,
      {
        credentialId: credential.deviceId,
        secret: credential.secret,
        publicKey: credential.publicKey,
      },
      pair.key,
    );
    const rooms = await phone.call("rooms.list");
    assert.ok(rooms.rooms.some((r: any) => r.roomId === member.roomId));
    assert.equal(
      (await phone.call("bots.list")).bots.find(
        (b: any) => b.id === member.bot.id,
      ).name,
      "移动验收员",
    );
    const files = await phone.call("artifacts.list", { roomId: member.roomId });
    assert.equal(files.items[0].name, "mobile-report.md");
    assert.doesNotMatch(JSON.stringify(files), new RegExp(f.root));
    assert.equal(
      (
        await phone.call("artifacts.preview", {
          roomId: member.roomId,
          toolCallId: "mobile-file-call",
        })
      ).kind,
      "markdown",
    );
    const reviewTarget = {roomId:deliveryMember.roomId,toolCallId:"mobile-file-call"};
    assert.ok((await phone.call("hello")).capabilities.includes("artifact_review_read"));
    const diff = await phone.call("artifacts.review",reviewTarget);
    assert.equal(diff.sha256,files.items[0].sha256);
    assert.deepEqual(diff.lines[0],{kind:"context",after:1,text:"# 合成手机产物"});
    assert.equal(diff.decision,undefined);
    await assert.rejects(
      phone.call("artifacts.review",{...reviewTarget,action:"accept"}),
      /input|field/,
    );
    await assert.rejects(
      phone.call("artifacts.review.submit",reviewTarget),
      /mobile_method_forbidden/,
    );
    await assert.rejects(phone.call("host.stop"), /mobile_method_forbidden/);
    await assert.rejects(
      phone.call("model.settings"),
      /mobile_method_forbidden/,
    );
    await assert.rejects(
      phone.call("approvals.decide", {
        operationId: randomUUID(),
        id: "synthetic",
        expectedHash: "synthetic",
        decision: "allow_always",
      }),
      /mobile_approval_scope_forbidden/,
    );
    await assert.rejects(
      phone.call("approvals.decide", {
        operationId: "invalid-approved",
        id: "synthetic",
        expectedHash: "synthetic",
        decision: "allow_always",
      }),
      /mobile_approval_scope_forbidden/,
    );

    const operationId = randomUUID(),
      messageId = "msg_" + randomUUID().replace(/-/g, ""),
      send = {
        operationId,
        roomId: member.roomId,
        id: messageId,
        text: "合成手机发送验收",
        createdAt: new Date().toISOString(),
        mentions: [],
      };
    const first = await phone.call("messages.send", send);
    const repeated = await phone.call("messages.send", send);
    assert.deepEqual(repeated, first);
    assert.equal(
      (await phone.call("operations.get", { operationId })).status,
      "completed",
    );
    await assert.rejects(
      phone.call("messages.send", { ...send, text: "different" }),
      /mobile_operation_conflict/,
    );
    const history = await phone.call("messages.page", {
      roomId: member.roomId,
      tail: true,
    });
    assert.equal(
      history.messages.filter((m: any) => m.text === "合成手机发送验收").length,
      1,
    );
    const uploadId = "upload_" + randomUUID().replace(/-/g, "");
    await phone.call("attachments.stage", {
      operationId: randomUUID(),
      roomId: member.roomId,
      id: uploadId,
      name: "mobile-evidence.md",
      data: Buffer.from("# 合成附件").toString("base64"),
    });
    const attachmentId = "msg_" + randomUUID().replace(/-/g, "");
    await phone.call("attachments.send", {
      operationId: randomUUID(),
      roomId: member.roomId,
      id: attachmentId,
      text: "附件验收",
      uploadIds: [uploadId],
    });
    const room = (await f.upstream.membership(member.roomId)).room;
    f.broker.room.archiveRoom(
      { roomId: member.roomId, expectedRoomRevision: room.revision },
      {
        sessionId: "mobile-scope-revoked",
        requestSource: "user",
        actor: { kind: "user", userId: "user.local" },
        issuedAt: new Date().toISOString(),
      },
    );
    await assert.rejects(
      phone.call("artifacts.preview", {
        roomId: member.roomId,
        toolCallId: "mobile-file-call",
      }),
      /team_scope_changed/,
    );
    const deliveryRoom = (await f.upstream.membership(deliveryMember.roomId)).room;
    f.broker.room.archiveRoom(
      { roomId:deliveryMember.roomId, expectedRoomRevision:deliveryRoom.revision },
      {
        sessionId:"mobile-review-scope-revoked",requestSource:"user",
        actor:{kind:"user",userId:"user.local"},issuedAt:new Date().toISOString(),
      },
    );
    await assert.rejects(phone.call("artifacts.review",reviewTarget),/team_scope_changed/);
  } finally {
    pair?.close();
    phone?.close();
    await host?.close();
    try {
      store.close();
    } catch {}
    await f.close();
  }
});

test("blind remote relay carries actual encrypted device traffic and closes revoked phones", async () => {
  const { startMobileRelay } = await import("../src/mobile/relay.js");
  const relay = await startMobileRelay(
    "synthetic-relay-token-0000000000000000",
  );
  const root = mkdtempSync(join(tmpdir(), "kt-mobile-relay-")),
    store = new TeamStore(root),
    devices = new MobileDevices(store);
  devices.configure({ action: "enable" });
  devices.configure({
    action: "relay",
    url: "ws://127.0.0.1:" + relay.port,
    token: "synthetic-relay-token-0000000000000000",
  });
  const gateway = new MobileGateway(devices, async () => ({
    ok: true,
    private: "synthetic encrypted result",
  }));
  let pair: any, phone: any;
  try {
    const health = await fetch("http://127.0.0.1:" + relay.port + "/health");
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true });
    await gateway.start();
    for (let n = 0; n < 100 && gateway.relayStatus !== "connected"; n++)
      await new Promise((r) => setTimeout(r, 20));
    assert.equal(gateway.relayStatus, "connected");
    const invite = devices.invite(gateway.port);
    pair = await mobileClient(invite.payload.relay!, {
      credentialId: invite.payload.inviteId,
      secret: invite.payload.secret,
      publicKey: invite.payload.publicKey,
    });
    await pair.call("pair", { name: "远程合成手机" });
    devices.configure({
      action: "approve",
      id: invite.payload.inviteId,
      fingerprint: mobilePairFingerprint(mobileB64(pair.key.publicKey)),
    });
    const credential = await pair.call("pair", { name: "远程合成手机" });
    await pair.call("pair", { action: "finish" });
    pair.close();
    phone = await mobileClient(
      invite.payload.relay!,
      {
        credentialId: credential.deviceId,
        secret: credential.secret,
        publicKey: credential.publicKey,
      },
      pair.key,
    );
    assert.equal(
      (await phone.call("hello")).private,
      "synthetic encrypted result",
    );
    devices.configure({ action: "revoke", id: credential.deviceId });
    gateway.reconcile();
    await assert.rejects(phone.call("hello"));
  } finally {
    pair?.close();
    phone?.close();
    await gateway.close();
    await relay.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("confirmed re-pairing reuses the proven device identity, rotates credentials and keeps same-name phones separate", async () => {
  const root = mkdtempSync(join(tmpdir(), "kt-mobile-repair-"));
  const store = new TeamStore(root), devices = new MobileDevices(store);
  devices.configure({ action: "enable" });
  const gateway = new MobileGateway(devices, async () => ({ ok: true }));
  const clients: any[] = [];
  try {
    await gateway.start();
    const pairDevice = async (key?: any, approvals = false) => {
      const { payload } = devices.invite(gateway.port);
      const client = await mobileClient("ws://127.0.0.1:" + gateway.port + "/mobile/connect", {
        credentialId: payload.inviteId, secret: payload.secret, publicKey: payload.publicKey,
      }, key);
      clients.push(client);
      assert.equal((await client.call("pair", { name: "我的 iPhone" })).pending, true);
      devices.configure({ action: "approve", id: payload.inviteId, fingerprint: mobilePairFingerprint(mobileB64(client.key.publicKey)), allowApprovals: approvals });
      const credential = await client.call("pair", { name: "我的 iPhone" });
      await client.call("pair", { action: "finish" });
      client.close();
      return { credential, key: client.key };
    };
    const first = await pairDevice(undefined, true);
    const old = await mobileClient("ws://127.0.0.1:" + gateway.port + "/mobile/connect", {
      credentialId: first.credential.deviceId, secret: first.credential.secret, publicKey: first.credential.publicKey,
    }, first.key);
    clients.push(old);
    await old.call("hello");
    const second = await pairDevice(first.key);
    assert.equal(second.credential.deviceId, first.credential.deviceId);
    assert.notEqual(second.credential.secret, first.credential.secret);
    assert.equal(devices.view().devices.length, 1);
    assert.equal(devices.view().devices[0].allowApprovals, false);
    await assert.rejects(old.call("hello"));
    const third = await pairDevice();
    assert.notEqual(third.credential.deviceId, first.credential.deviceId);
    assert.equal(devices.view().devices.length, 2);
    devices.configure({ action: "revoke", id: second.credential.deviceId });
    const fourth = await pairDevice(first.key);
    assert.equal(fourth.credential.deviceId, first.credential.deviceId);
    assert.equal(devices.view().devices.length, 2);
    assert.equal(devices.view().devices.find((d: any) => d.id === fourth.credential.deviceId)?.revokedAt, undefined);
    const reopened = new MobileDevices(store);
    assert.equal(reopened.view().devices.length, 2);
  } finally {
    clients.forEach(c => c.close());
    await gateway.close(); store.close(); rmSync(root, { recursive: true, force: true });
  }
});
