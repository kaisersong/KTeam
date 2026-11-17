import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { once } from "node:events";
import { build } from "esbuild";
import WebSocket from "ws";
import http from "node:http";
import { TeamStore } from "../src/service/team-store.js";
import { MobileDevices } from "../src/mobile/devices.js";
import { MobileGateway } from "../src/mobile/gateway.js";

test("the actual phone transport retains idle revocation across reconnects and never tries another route with rejected credentials", async () => {
  const root = mkdtempSync(join(tmpdir(), "kt-phone-revoke-")),
    store = new TeamStore(root),
    devices = new MobileDevices(store);
  devices.configure({ action: "enable" });
  let releaseRead: (() => void) | undefined;
  let reading: (() => void) | undefined;
  const readStarted = new Promise<void>(resolve => { reading = resolve; });
  const gateway = new MobileGateway(devices, async (_principal, method) => {
    if (method === "blocked.read") {
      reading?.();
      await new Promise<void>(resolve => { releaseRead = resolve; });
    }
    return { ok: true };
  });
  (globalThis as any).__mobileTestInstallation = devices.installationId;
  const previous = globalThis.WebSocket,
    opened: string[] = [],
    sockets: WebSocket[] = [];
  let pair: any, phone: any, rejected: any;
  try {
    // Only the native discovery/crypto bindings are adapted; source transport,
    // WebSockets, Noise, device registry and gateway all execute unchanged.
    const compiled = await build({
      entryPoints: [resolve("mobile/src/transport.ts")],
      bundle: true,
      platform: "node",
      format: "cjs",
      write: false,
      alias: {
        "sodium-universal": "sodium-javascript",
        "sodium-native": "sodium-javascript",
      },
      plugins: [
        {
          name: "native-bindings",
          setup(b) {
            b.onResolve(
              { filter: /^(react-native-zeroconf|expo-crypto)$/ },
              (a) => ({ path: a.path, namespace: "native-binding" }),
            );
            b.onLoad({ filter: /.*/, namespace: "native-binding" }, (a) => ({
              contents:
                a.path === "react-native-zeroconf"
                  ? 'export default class {on(n,f){if(n==="resolved")this.resolved=f} scan(){this.resolved?.({txt:{installationId:globalThis.__mobileTestInstallation},port:1,addresses:Array.from({length:12},(_,i)=>"127.0.0."+(i+2))})} stop(){} removeAllListeners(){}}'
                  : 'import{createHash,randomUUID}from"node:crypto";export{randomUUID};export const CryptoDigestAlgorithm={SHA256:"sha256"};export async function digestStringAsync(algorithm,value){return createHash(algorithm).update(value).digest("hex")}',
            }));
          },
        },
      ],
    });
    const file = join(root, "phone.cjs");
    writeFileSync(file, compiled.outputFiles[0]!.contents);
    const { MobileConnection, pairingComputer } = createRequire(
      import.meta.url,
    )(file);
    globalThis.WebSocket = class extends WebSocket {
      constructor(url: any, protocols: any, options: any) {
        super(url, protocols, options);
        opened.push(String(url));
        sockets.push(this);
      }
    } as any;
    await gateway.start();
    const { payload } = devices.invite(gateway.port),
      url = "ws://127.0.0.1:" + gateway.port + "/mobile/connect";
    const candidate = pairingComputer({
      ...payload,
      relay: url,
      endpoints: [url, "ws://127.0.0.1:1/mobile/connect"],
    });
    const stalled = http.createServer();
    let stalledSocket: any;
    const stalledSockets = new Set<any>();
    const arrived = new Promise<void>((resolve) =>
      stalled.on("upgrade", (_req, socket) => {
        stalledSockets.add(socket);
        stalledSocket = socket;
        resolve();
      }),
    );
    await new Promise<void>((resolve) =>
      stalled.listen(0, "127.0.0.1", resolve),
    );
    const port = (stalled.address() as any).port;
    const cancelled = new MobileConnection({
      ...candidate,
      relay: "ws://127.0.0.1:" + port + "/mobile/connect",
      endpoints: ["ws://127.0.0.1:" + port + "/mobile/connect", url],
    });
    const beforeCancel = opened.length;
    try {
      const connecting = cancelled.connect();
      const failure = assert.rejects(
        connecting,
        /连接已断开|连接中断|网络连接失败/,
      );
      await arrived;
      cancelled.close();
      await failure;
      assert.equal(
        opened.length,
        beforeCancel + 1,
        "cancelling an in-flight scan must not try another address",
      );
      await assert.rejects(cancelled.connect(), /连接已断开/);
      let remembered: string | undefined;
      const recovering = new MobileConnection({ ...candidate,
        lastEndpoint: "ws://127.0.0.1:" + port + "/mobile/connect", relay: url },
        (c: any) => { remembered = c.lastEndpoint; });
      try {
        const started = Date.now();
        await recovering.connect();
        assert.ok(Date.now() - started < 2500, "stale last route must not incur a six-second LAN wait");
        assert.equal(remembered, url, "successful route must replace stale remembered route");
      } finally { recovering.close(); }
    } finally {
      cancelled.close();
      for (const socket of stalledSockets) socket.destroy();
      await new Promise<void>((resolve) => stalled.close(() => resolve()));
    }
    pair = new MobileConnection(candidate);
    await pair.connect();
    assert.equal(
      (await pair.call("pair", { name: "transport-test" })).pending,
      true,
    );
    devices.configure({ action: "approve", id: payload.inviteId });
    const credential = await pair.call("pair", { name: "transport-test" });
    await pair.call("pair", { action: "finish" });
    pair.close();
    const saved = {
      ...candidate,
      credentialId: credential.deviceId,
      secret: credential.secret,
    };
    phone = new MobileConnection({ ...saved, relay: url });
    await phone.connect();
    assert.equal((await phone.call("hello")).ok, true);
    const connectedCount = opened.length;
    await phone.connect();
    assert.equal(opened.length, connectedCount, "an authenticated ready connection must be reused");
    assert.equal(opened.some(url => /127\.0\.0\.(?:[2-9]|1[0-3]):1\//.test(url)), false,
      "reachable relay must precede stale discovery addresses");
    const blocked = phone.call("blocked.read");
    const stopped = assert.rejects(blocked, /连接已断开/);
    await readStarted;
    const closeStart = Date.now();
    phone.close();
    await stopped;
    assert.ok(Date.now() - closeStart < 500, "cancelled requests must not wait for the 30-second RPC timeout");
    releaseRead?.();
    phone = new MobileConnection({ ...saved, relay: url });
    await phone.connect();
    assert.equal((await phone.call("hello")).ok, true);
    const closed = once(sockets.at(-1)!, "close");
    devices.configure({ action: "revoke", id: credential.deviceId });
    gateway.reconcile();
    await closed;
    const before = opened.length;
    await assert.rejects(phone.call("hello"), /mobile_device_revoked/);
    await assert.rejects(phone.connect(), /mobile_device_revoked/);
    assert.equal(
      opened.length,
      before,
      "idle revocation must not start a new socket or fall through to offline",
    );
    rejected = new MobileConnection({ ...saved, relay: url });
    await assert.rejects(rejected.connect(), /mobile_auth_required/);
    assert.equal(
      opened.length,
      before + 1,
      "a rejected identity must not try a second route",
    );
  } finally {
    releaseRead?.();
    delete (globalThis as any).__mobileTestInstallation;
    pair?.close();
    phone?.close();
    rejected?.close();
    globalThis.WebSocket = previous;
    await gateway.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
