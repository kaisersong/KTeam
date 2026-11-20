import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TeamStore } from "../src/service/team-store.js";
import { MobileDevices, mobilePairFingerprint } from "../src/mobile/devices.js";
import { MobileGateway } from "../src/mobile/gateway.js";
import { mobileB64, newMobileKeypair } from "../src/protocol/mobile-wire.js";
import { acceptPairing } from "../src/protocol/mobile-pairing.js";
import { applyPhoneAuthority, ResponseBarrier } from "../src/protocol/mobile-authority.js";
import { mobileClient } from "./helpers/mobile-client.js";

const phone = {
  installationId: "install-1",
  credentialId: "device-1",
  epoch: 2,
  appliedRevokeSeq: 0,
};

test("pairing persists only after both sides bind the same full key", () => {
  const peerKey = mobileB64(newMobileKeypair().publicKey);
  const fingerprint = mobilePairFingerprint(peerKey);
  assert.equal(fingerprint.length, 12);
  assert.notEqual(fingerprint, peerKey);
  const ready = {
    confirmed: true,
    paired: true,
    localFingerprint: fingerprint,
    remoteFingerprint: fingerprint,
    deviceId: "device-1",
    secret: mobileB64(newMobileKeypair().publicKey),
    epoch: 1,
  };
  assert.equal(acceptPairing({ ...ready, confirmed: false }).persist, false);
  assert.equal(acceptPairing({ ...ready, paired: false }).persist, false);
  assert.equal(acceptPairing({ ...ready, remoteFingerprint: "0123456789ab" }).persist, false);
  assert.equal(acceptPairing({ ...ready, remoteFingerprint: fingerprint.slice(0, 11) }).persist, false);
  assert.equal(acceptPairing({ ...ready, epoch: 1.5 }).persist, false);
  assert.equal(acceptPairing(ready).persist, true);
});

test("close codes only lock, and a revoke wipes only the matching credential generation", () => {
  const barrier = new ResponseBarrier();
  const token = barrier.token();
  const steps: string[] = [];
  const record = (label: string) => {
    steps.push(label);
  };
  const locked = applyPhoneAuthority(
    { computer: phone, locked: false },
    { type: "close" },
    barrier,
    () => record("delete"),
  );
  assert.equal(locked.effect, "lock");
  assert.equal(locked.state.computer?.credentialId, phone.credentialId);
  assert.deepEqual(steps, []);
  for (const code of [4401, 4403, 1006]) {
    const again = applyPhoneAuthority(
      { computer: phone, locked: true },
      { type: "close" },
      barrier,
      () => record("delete-" + code),
    );
    assert.equal(again.effect, "ignore");
    assert.equal(again.state.computer?.credentialId, phone.credentialId);
  }
  const noiseOnly = applyPhoneAuthority(
    locked.state,
    { type: "ready", installationId: phone.installationId },
    barrier,
    () => record("delete"),
  );
  assert.equal(noiseOnly.effect, "ignore");
  assert.equal(noiseOnly.state.locked, true);
  const wrongComputer = applyPhoneAuthority(
    locked.state,
    { type: "ready", installationId: "other", deviceId: phone.credentialId, epoch: phone.epoch },
    barrier,
    () => record("delete"),
  );
  assert.equal(wrongComputer.effect, "ignore");
  const proven = applyPhoneAuthority(
    locked.state,
    { type: "ready", installationId: phone.installationId, deviceId: phone.credentialId, epoch: phone.epoch },
    barrier,
    () => record("delete"),
  );
  assert.equal(proven.effect, "unlock");
  const oldGeneration = applyPhoneAuthority(
    { computer: { ...phone, epoch: 3, appliedRevokeSeq: 0 }, locked: false },
    { type: "revoke", installationId: phone.installationId, deviceId: phone.credentialId, epoch: 2, seq: 1 },
    barrier,
    () => record("delete-old"),
  );
  assert.equal(oldGeneration.effect, "ignore");
  assert.equal(oldGeneration.state.computer?.epoch, 3);
  const restarted = applyPhoneAuthority(
    { computer: { ...phone, authorityLocked: true } as typeof phone, locked: true },
    { type: "close" },
    barrier,
    () => record("delete-restart"),
  );
  assert.equal(restarted.state.computer?.credentialId, phone.credentialId);
  const wiped = applyPhoneAuthority(
    { computer: phone, locked: true },
    { type: "revoke", installationId: phone.installationId, deviceId: phone.credentialId, epoch: 2, seq: 1 },
    barrier,
    () => record("barrier-then-delete"),
  );
  assert.equal(wiped.effect, "wipe");
  assert.equal(wiped.state.computer, undefined);
  assert.deepEqual(steps, ["barrier-then-delete"]);
  assert.equal(barrier.accepts(token), false);
  const late = barrier.token();
  assert.notEqual(late, token);
  assert.equal(barrier.accepts(late), true);
});

test("desktop confirmation, expiry, replay, race scan and host identity do not persist a wrong claim", async () => {
  const root = mkdtempSync(join(tmpdir(), "kt-pair-bind-"));
  const store = new TeamStore(root);
  const devices = new MobileDevices(store);
  devices.configure({ action: "enable" });
  const gateway = new MobileGateway(devices, async () => ({ ok: true }));
  const clients: any[] = [];
  try {
    await gateway.start();
    const url = "ws://127.0.0.1:" + gateway.port + "/mobile/connect";
    const invite = devices.invite(gateway.port);
    const changed = await assert.rejects(
      mobileClient(url, { ...invite.payload, credentialId: invite.payload.inviteId, publicKey: mobileB64(newMobileKeypair().publicKey) }),
      /mobile_host_key_changed|mobile_connection_closed/,
    );
    assert.equal(changed, undefined);
    assert.equal(devices.view().requests.length, 0);
    assert.equal(devices.view().devices.length, 0);
    const first = await mobileClient(url, {
      credentialId: invite.payload.inviteId,
      secret: invite.payload.secret,
      publicKey: invite.payload.publicKey,
    });
    clients.push(first);
    const second = await mobileClient(url, {
      credentialId: invite.payload.inviteId,
      secret: invite.payload.secret,
      publicKey: invite.payload.publicKey,
    });
    clients.push(second);
    const pending = await first.call("pair", { name: "第一部手机" });
    assert.equal(pending.pending, true);
    assert.equal(pending.fingerprint, mobilePairFingerprint(mobileB64(first.key.publicKey)));
    assert.equal(Object.hasOwn(devices.view().requests[0], "fingerprint"), false);
    assert.equal(Object.hasOwn(devices.view().requests[0], "peerKey"), false);
    assert.equal(devices.view().devices.length, 0, "an unconfirmed claim must not create a device");
    await assert.rejects(second.call("pair", { name: "抢扫" }), /mobile_pair_conflict/);
    await assert.rejects(
      mobileClient(url, {
        credentialId: invite.payload.inviteId,
        secret: invite.payload.secret,
        publicKey: invite.payload.publicKey,
      }),
      /mobile_connection_closed|mobile_peer_changed/,
    );
    const wrongKey = mobileB64(second.key.publicKey);
    assert.throws(
      () => devices.configure({ action: "approve", id: invite.payload.inviteId, fingerprint: mobilePairFingerprint(wrongKey) }),
      /mobile_pair_mismatch/,
    );
    assert.equal(devices.view().devices.length, 0);
    const now = Date.now;
    Date.now = () => now() + 130000;
    try {
      assert.throws(
        () => devices.configure({
          action: "approve",
          id: invite.payload.inviteId,
          fingerprint: mobilePairFingerprint(mobileB64(first.key.publicKey)),
        }),
        /mobile_invite_expired/,
      );
    } finally {
      Date.now = now;
    }
    assert.equal(devices.view().devices.length, 0);
    devices.configure({
      action: "approve",
      id: invite.payload.inviteId,
      fingerprint: mobilePairFingerprint(mobileB64(first.key.publicKey)),
    });
    const paired = await first.call("pair", { name: "第一部手机" });
    assert.equal(paired.fingerprint, pending.fingerprint);
    assert.equal(paired.epoch, 1);
    assert.equal(acceptPairing({
      confirmed: false,
      paired: true,
      localFingerprint: paired.fingerprint,
      remoteFingerprint: paired.fingerprint,
      deviceId: paired.deviceId,
      secret: paired.secret,
      epoch: paired.epoch,
    }).persist, false);
    const secret = paired.secret;
    await first.call("pair", { action: "finish" });
    await assert.rejects(first.call("pair", { name: "第一部手机" }), /mobile_auth_required|mobile_pair_forbidden|mobile_connection_closed/);
    assert.throws(
      () => devices.configure({
        action: "approve",
        id: invite.payload.inviteId,
        fingerprint: mobilePairFingerprint(mobileB64(first.key.publicKey)),
      }),
      /mobile_invite_expired/,
    );
    assert.equal(devices.view().devices.length, 1);
    assert.equal(store.state<any>("mobile-devices:v1").devices[0].psk.length > 0, true);
    const again = devices.invite(gateway.port);
    await assert.rejects(
      mobileClient(url, {
        credentialId: invite.payload.inviteId,
        secret: invite.payload.secret,
        publicKey: invite.payload.publicKey,
      }),
      /mobile_auth_required|mobile_connection_closed/,
    );
    assert.equal(store.state<any>("mobile-devices:v1").devices[0].id, paired.deviceId);
    assert.notEqual(secret, again.payload.secret);
  } finally {
    clients.forEach((client) => client.close());
    await gateway.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("authenticated revocation is durable before ack, generation scoped, and limited to the current channel", async () => {
  const root = mkdtempSync(join(tmpdir(), "kt-pair-revoke-"));
  const store = new TeamStore(root);
  const devices = new MobileDevices(store);
  devices.configure({ action: "enable" });
  let calls = 0;
  const gateway = new MobileGateway(devices, async () => ({ ok: true, calls: ++calls }));
  const clients: any[] = [];
  try {
    await gateway.start();
    const url = "ws://127.0.0.1:" + gateway.port + "/mobile/connect";
    const pair = async (key?: ReturnType<typeof newMobileKeypair>) => {
      const invite = devices.invite(gateway.port);
      const client = await mobileClient(url, {
        credentialId: invite.payload.inviteId,
        secret: invite.payload.secret,
        publicKey: invite.payload.publicKey,
      }, key);
      clients.push(client);
      await client.call("pair", { name: "手机" });
      devices.configure({
        action: "approve",
        id: invite.payload.inviteId,
        fingerprint: mobilePairFingerprint(mobileB64(client.key.publicKey)),
      });
      const credential = await client.call("pair", { name: "手机" });
      await client.call("pair", { action: "finish" });
      client.close();
      return credential;
    };
    const first = await pair();
    const phone = await mobileClient(url, {
      credentialId: first.deviceId,
      secret: first.secret,
      publicKey: first.publicKey,
    }, clients[0].key);
    clients.push(phone);
    const otherInvite = devices.invite(gateway.port);
    const other = await mobileClient(url, {
      credentialId: otherInvite.payload.inviteId,
      secret: otherInvite.payload.secret,
      publicKey: otherInvite.payload.publicKey,
    });
    clients.push(other);
    await other.call("pair", { name: "另一部" });
    devices.configure({
      action: "approve",
      id: otherInvite.payload.inviteId,
      fingerprint: mobilePairFingerprint(mobileB64(other.key.publicKey)),
    });
    const otherCredential = await other.call("pair", { name: "另一部" });
    await other.call("pair", { action: "finish" });
    other.close();
    const otherPhone = await mobileClient(url, {
      credentialId: otherCredential.deviceId,
      secret: otherCredential.secret,
      publicKey: otherCredential.publicKey,
    }, other.key);
    clients.push(otherPhone);
    assert.equal((await phone.call("hello")).ok, true);
    assert.equal((await otherPhone.call("hello")).ok, true);
    const before = calls;
    devices.configure({ action: "revoke", id: first.deviceId });
    const persisted = new MobileDevices(store).activeRevocation(first.deviceId);
    assert.equal(persisted?.installationId, devices.installationId);
    assert.equal(persisted?.deviceId, first.deviceId);
    assert.equal(persisted?.epoch, first.epoch);
    assert.equal(persisted?.seq, 1);
    assert.deepEqual(Object.keys(persisted ?? {}).sort(), ["deviceId", "epoch", "installationId", "seq", "v"]);
    assert.ok(new MobileDevices(store).view().devices.find((d: any) => d.id === first.deviceId)?.revokedAt);
    gateway.reconcile();
    await assert.rejects(phone.call("rooms.list"), /mobile_device_revoked/);
    assert.equal(calls, before, "a revoke-only channel must not execute another method");
    assert.equal((await otherPhone.call("hello")).ok, true);
    const started = Date.now();
    let closeCode = 0;
    await assert.rejects(
      mobileClient(url, {
        credentialId: first.deviceId,
        secret: first.secret,
        publicKey: first.publicKey,
      }, clients[0].key, {
        ackRevoke: false,
        onClose: (code) => { closeCode = code; },
      }),
      /mobile_device_revoked/,
    );
    for (let n = 0; n < 40 && closeCode === 0; n++) await new Promise((r) => setTimeout(r, 100));
    assert.equal(closeCode, 4403);
    assert.ok(Date.now() - started < 3500, "the revoke channel must end within its time limit");
    const restartedDevices = new MobileDevices(store);
    restartedDevices.configure({ action: "enable", port: 0 });
    const restarted = new MobileGateway(restartedDevices, async () => ({ ok: true, calls: ++calls }));
    await restarted.start();
    const restartedUrl = "ws://127.0.0.1:" + restarted.port + "/mobile/connect";
    await assert.rejects(
      mobileClient(restartedUrl, {
        credentialId: first.deviceId,
        secret: first.secret,
        publicKey: first.publicKey,
      }, clients[0].key),
      /mobile_device_revoked/,
    );
    const invite = restartedDevices.invite(restarted.port);
    const repairClient = await mobileClient(restartedUrl, {
      credentialId: invite.payload.inviteId,
      secret: invite.payload.secret,
      publicKey: invite.payload.publicKey,
    }, clients[0].key);
    clients.push(repairClient);
    await repairClient.call("pair", { name: "手机" });
    restartedDevices.configure({
      action: "approve",
      id: invite.payload.inviteId,
      fingerprint: mobilePairFingerprint(mobileB64(repairClient.key.publicKey)),
    });
    const repaired = await repairClient.call("pair", { name: "手机" });
    await repairClient.call("pair", { action: "finish" });
    assert.equal(repaired.deviceId, first.deviceId);
    assert.notEqual(repaired.secret, first.secret);
    assert.ok(repaired.epoch > first.epoch);
    const kept: string[] = [];
    const outcome = applyPhoneAuthority(
      {
        computer: {
          installationId: restartedDevices.installationId,
          credentialId: repaired.deviceId,
          epoch: repaired.epoch,
          appliedRevokeSeq: 0,
        },
        locked: false,
      },
      { type: "revoke", ...persisted! },
      new ResponseBarrier(),
      () => kept.push("deleted"),
    );
    assert.equal(outcome.effect, "ignore");
    assert.deepEqual(kept, []);
    const fresh = await mobileClient(restartedUrl, {
      credentialId: repaired.deviceId,
      secret: repaired.secret,
      publicKey: repaired.publicKey,
    }, repairClient.key);
    clients.push(fresh);
    assert.equal((await fresh.call("hello")).ok, true);
    await restarted.close();
  } finally {
    clients.forEach((client) => client.close());
    await gateway.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
