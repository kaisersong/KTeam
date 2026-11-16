import http from "node:http";
import Bonjour from "bonjour-service";
import { MobileRelayClient } from "./relay.js";
import { WebSocketServer, WebSocket } from "ws";
import { MobileHandshake, MobileFrames } from "../protocol/mobile-wire.js";
import { MobileDevices, type MobilePrincipal } from "./devices.js";
import { KTeamError } from "../errors.js";
export class MobileGateway {
  private discovery?: Bonjour;
  private relay?: MobileRelayClient;
  private relayConfig = "";
  private server?: http.Server;
  private wss?: WebSocketServer;
  private sockets = new Map<WebSocket, MobilePrincipal | undefined>();
  private actualPort = 0;
  private stopping = false;
  constructor(
    readonly devices: MobileDevices,
    private call: (
      p: MobilePrincipal,
      method: string,
      input: unknown,
    ) => Promise<unknown>,
  ) {}
  get relayStatus() {
    return this.relay?.status ?? "disabled";
  }
  syncRelay() {
    const config = this.devices.enabled
      ? JSON.stringify(this.devices.relay)
      : "";
    if (config === this.relayConfig) return;
    this.relay?.close();
    this.relay = undefined;
    this.relayConfig = config;
    if (this.devices.enabled && this.devices.relay) {
      const r = this.devices.relay;
      this.relay = new MobileRelayClient(
        r.url,
        r.token,
        this.devices.installationId,
        (ws) => this.accept(ws),
      );
      this.relay.start();
    }
  }
  get port() {
    return this.actualPort;
  }
  async start() {
    if (this.server || !this.devices.enabled) return;
    this.stopping = false;
    const s = http.createServer((_req, res) => {
      res.writeHead(404, { "cache-control": "no-store" });
      res.end();
    });
    const wss = new WebSocketServer({
      noServer: true,
      maxPayload: 100000,
      perMessageDeflate: false,
    });
    s.on("upgrade", (req, socket, head) => {
      if (
        req.url !== "/mobile/connect" ||
        (req.headers.origin !== undefined &&
          req.headers.origin !== "kteam://mobile") ||
        this.sockets.size >= 32
      ) {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => this.accept(ws));
    });
    this.server = s;
    this.wss = wss;
    try {
      await new Promise<void>((resolve, reject) => {
        s.once("error", reject);
        s.listen(this.devices.port, "0.0.0.0", () => resolve());
      });
    } catch (error) {
      wss.close();
      this.server = undefined;
      this.wss = undefined;
      throw error;
    }
    this.actualPort = (s.address() as any).port;
    this.syncRelay();
    try {
      this.discovery = new Bonjour({}, () => {});
      this.discovery.publish({
        name: "KTeam " + this.devices.installationId.slice(0, 8),
        type: "kteam-mobile",
        port: this.actualPort,
        txt: { installationId: this.devices.installationId, v: "1" },
      });
    } catch {
      /* QR endpoints remain available if multicast is unavailable. */
    }
  }
  accept(socket: WebSocket) {
    if (this.stopping || this.sockets.size >= 32) {
      socket.close();
      return;
    }
    this.sockets.set(socket, undefined);
    let principal: MobilePrincipal | undefined,
      noise: MobileHandshake | undefined,
      frames: MobileFrames | undefined,
      queuedBytes = 0;
    let chain = Promise.resolve();
    const timer = setTimeout(
      () => socket.close(4401, "authentication timeout"),
      10000,
    );
    const send = (value: unknown) => {
      if (socket.readyState !== WebSocket.OPEN) return;
      for (const packet of frames!.encode(value))
        socket.send(JSON.stringify({ type: "record", packet }));
    };
    socket.on("close", () => {
      clearTimeout(timer);
      this.sockets.delete(socket);
    });
    socket.on("error", () => {});
    socket.on("message", (data) => {
      const size = Buffer.byteLength(data.toString());
      queuedBytes += size;
      if (queuedBytes > 20 * 1024 * 1024) {
        socket.terminate();
        return;
      }
      chain = chain
        .then(async () => {
          try {
            const message = JSON.parse(data.toString());
            if (!noise) {
              if (message.type !== "hello" || message.v !== 1)
                throw Error("mobile_protocol_mismatch");
              const auth = this.devices.authenticate(message.credentialId);
              principal = auth.principal;
              this.sockets.set(socket, principal);
              noise = new MobileHandshake(
                false,
                this.devices.keypair,
                auth.psk,
              );
              noise.receive(message.packet);
              socket.send(
                JSON.stringify({
                  type: "handshake",
                  v: 1,
                  packet: noise.send(),
                }),
              );
              return;
            }
            if (!frames) {
              if (message.type !== "handshake")
                throw Error("mobile_handshake_invalid");
              noise.receive(message.packet);
              if (
                !noise.complete ||
                (principal!.peerKey && principal!.peerKey !== noise.remoteKey)
              )
                throw Error("mobile_peer_changed");
              this.devices.assert(principal!);
              frames = new MobileFrames(noise);
              clearTimeout(timer);
              send({
                type: "ready",
                v: 1,
                installationId: this.devices.installationId,
              });
              return;
            }
            this.devices.assert(principal!);
            if (message.type !== "record") throw Error("mobile_frame_invalid");
            const request = frames.receive(message.packet);
            if (!request) return;
            if (
              typeof request.id !== "string" ||
              !/^[a-zA-Z0-9_-]{1,128}$/.test(request.id) ||
              typeof request.method !== "string" ||
              request.method.length > 64
            )
              throw Error("mobile_request_invalid");
            try {
              if (principal!.kind === "invite" && request.method !== "pair")
                throw new KTeamError("mobile_pair_required", 403);
              const value =
                principal!.kind === "invite" && request.method === "pair"
                  ? this.devices.pair(
                      principal!,
                      noise.remoteKey,
                      request.input,
                    )
                  : await this.call(principal!, request.method, request.input);
              if (principal!.kind === "device") this.devices.assert(principal!);
              send({ id: request.id, ok: true, value });
            } catch (error) {
              send({
                id: request.id,
                ok: false,
                code:
                  error instanceof KTeamError
                    ? error.code
                    : error instanceof Error
                      ? error.message
                      : "mobile_operation_failed",
              });
            }
          } catch {
            socket.close(4401, "connection refused");
          }
        })
        .finally(() => {
          queuedBytes -= size;
        })
        .catch(() => socket.close());
    });
  }
  reconcile() {
    this.syncRelay();
    for (const [s, p] of this.sockets) {
      try {
        if (p) this.devices.assert(p);
      } catch {
        s.close(4403, "device revoked");
      }
    }
  }
  async close() {
    this.stopping = true;
    this.discovery?.destroy();
    this.discovery = undefined;
    this.relay?.close();
    this.relay = undefined;
    this.relayConfig = "";
    for (const s of this.sockets.keys()) s.terminate();
    this.sockets.clear();
    this.wss?.close();
    if (this.server) {
      this.server.closeAllConnections();
      await new Promise<void>((r) => this.server!.close(() => r()));
    }
    this.server = undefined;
    this.wss = undefined;
    this.actualPort = 0;
  }
}
