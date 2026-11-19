import { test } from "node:test";
import assert from "node:assert/strict";
import { ResponseBarrier } from "../src/protocol/mobile-authority.js";
import {
  MobileWriteGate,
  MobileWriteRefused,
  mobileActionDisabled,
  performMobileCall,
} from "../src/protocol/mobile-write-entry.js";

type Write = { method: string; payload: unknown };

function screen() {
  const gate = new MobileWriteGate();
  const barrier = new ResponseBarrier();
  const writes: Write[] = [];
  const verifies: number[] = [];
  let ready = true;
  let releaseConnect: (() => void) | undefined;
  const connectWait: Array<() => void> = [];
  const transport = {
    get isReady() { return ready; },
    connect() {
      verifies.push(1);
      return new Promise<void>((resolve) => {
        releaseConnect = () => {
          ready = true;
          resolve();
        };
        connectWait.push(releaseConnect);
      });
    },
    call(method: string, payload: unknown) {
      if (!ready) throw Error("verification connected inside the write");
      writes.push({ method, payload });
      return Promise.resolve({ ok: true });
    },
  };
  let credentialId = "device-1";
  const call = (method: string, payload: unknown) => performMobileCall({
    gate,
    barrier,
    method,
    payload,
    transport,
    sameComputer: credentialId === "device-1",
  });
  const view = () => ({ locked: gate.locked, busy: false, offline: false });
  return {
    gate,
    barrier,
    writes,
    verifies,
    call,
    release() { const next = connectWait.shift(); next?.(); },
    buttons() {
      return {
        stop: mobileActionDisabled("stop", view()),
        approval: mobileActionDisabled("approval", view()),
      };
    },
    async press(method: string, payload: unknown) {
      if (mobileActionDisabled(method === "work.stop" ? "stop" : "approval", view()))
        throw new MobileWriteRefused(false);
      return call(method, payload);
    },
    setReady(value: boolean) { ready = value; },
    setCredential(value: string) { credentialId = value; },
  };
}

test("a hot lock after 1006 blocks approval and stop with zero writes, and unlock does not replay the click", async () => {
  const ui = screen();
  await ui.press("approvals.decide", { decision: "allow_once", id: "tool-approval:1" });
  assert.equal(ui.writes.length, 1);
  ui.setReady(false);
  ui.gate.lock();
  assert.equal(ui.buttons().approval, true);
  assert.equal(ui.buttons().stop, true);
  await assert.rejects(ui.call("approvals.decide", { decision: "allow_once" }), MobileWriteRefused);
  await assert.rejects(ui.call("work.stop", { roomId: "room" }), MobileWriteRefused);
  assert.equal(ui.writes.length, 1);
  assert.equal(ui.verifies.length, 0, "a locked click must not open a verification connection");
  ui.gate.unlock();
  assert.equal(ui.writes.length, 1, "verification must not replay the locked click");
  ui.setReady(true);
  await ui.press("approvals.decide", { decision: "allow_once", id: "tool-approval:1" });
  assert.equal(ui.writes.length, 2);
  assert.equal((ui.writes[1] as Write).payload && (ui.writes[1] as Write).method, "approvals.decide");
});

test("a slow verification and a fast second click are dropped when the lock lands before the write", async () => {
  const ui = screen();
  ui.setReady(false);
  const first = ui.press("approvals.decide", { decision: "allow_once" });
  const second = ui.press("work.stop", { roomId: "room" });
  assert.equal(ui.verifies.length, 2);
  assert.equal(ui.writes.length, 0);
  ui.gate.lock();
  ui.release();
  ui.release();
  await assert.rejects(first, MobileWriteRefused);
  await assert.rejects(second, MobileWriteRefused);
  assert.equal(ui.writes.length, 0);
  ui.gate.unlock();
  ui.setReady(true);
  await ui.call("approvals.decide", { decision: "deny" });
  assert.deepEqual(ui.writes.map((item) => item.method), ["approvals.decide"]);
  assert.equal((ui.writes[0] as Write).payload && (ui.writes[0] as { payload: { decision: string } }).payload.decision, "deny");
});

test("re-render with the same credential still sees the lock, and a tripped barrier rejects the returned result", async () => {
  const ui = screen();
  const stable = ui.call;
  ui.setCredential("device-1");
  ui.gate.lock();
  await assert.rejects(stable("work.stop", { roomId: "room" }), MobileWriteRefused);
  assert.equal(ui.writes.length, 0);
  ui.gate.unlock();
  const late = performMobileCall({
    gate: ui.gate,
    barrier: ui.barrier,
    method: "approvals.decide",
    payload: { decision: "allow_once" },
    sameComputer: true,
    transport: {
      isReady: true,
      connect() { throw Error("must not verify"); },
      async call() {
        ui.barrier.trip();
        return { ok: true };
      },
    },
  });
  await assert.rejects(late, /会话已锁定/);
});
