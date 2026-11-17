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
  const gateway = new MobileGateway(devices, async () => ({ ok: true }));
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
                  ? "export default class {on(){} scan(){} stop(){} removeAllListeners(){}}"
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
    const arrived = new Promise<void>((resolve) =>
      stalled.once("upgrade", (_req, socket) => {
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
    } finally {
      cancelled.close();
      stalledSocket?.destroy();
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
    phone = new MobileConnection(saved);
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
    pair?.close();
    phone?.close();
    rejected?.close();
    globalThis.WebSocket = previous;
    await gateway.close();
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});
