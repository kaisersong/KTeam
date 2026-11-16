import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  newMobileKeypair,
  MobileHandshake,
  MobileFrames,
} from "../src/protocol/mobile-wire.js";
test("original Noise transport pins the computer key, authenticates both directions and rejects replay and tampering", () => {
  const key = newMobileKeypair(),
    psk = randomBytes(32),
    client = new MobileHandshake(true, newMobileKeypair(), psk, key.publicKey),
    server = new MobileHandshake(false, key, psk);
  server.receive(client.send());
  client.receive(server.send());
  server.receive(client.send());
  assert.equal(client.complete, true);
  assert.equal(server.complete, true);
  const a = new MobileFrames(client),
    b = new MobileFrames(server),
    packets = a.encode({ id: "request-1", text: "合成报告".repeat(60000) });
  let value: any;
  for (const packet of packets) value = b.receive(packet) ?? value;
  assert.equal(value.text.length, 240000);
  assert.throws(() => b.receive(packets[0]!));
  const reply = b.encode({ ok: true })[0]!;
  assert.deepEqual(a.receive(reply), { ok: true });
  const bad = b.encode({ ok: true })[0]!;
  assert.throws(() => a.receive(bad.slice(0, -4) + "AAAA"));
});
test("a substituted computer or wrong pairing secret cannot establish a mobile session", () => {
  const key = newMobileKeypair(),
    psk = randomBytes(32),
    a = new MobileHandshake(
      true,
      newMobileKeypair(),
      psk,
      newMobileKeypair().publicKey,
    ),
    b = new MobileHandshake(false, key, psk);
  b.receive(a.send());
  assert.throws(() => a.receive(b.send()), /mobile_host_key_changed/);
  const c = new MobileHandshake(
      true,
      newMobileKeypair(),
      randomBytes(32),
      key.publicKey,
    ),
    d = new MobileHandshake(false, key, psk);
  assert.throws(() => d.receive(c.send()));
});
