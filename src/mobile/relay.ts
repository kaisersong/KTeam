import http from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
/** Blind rendezvous: all application authentication and content remain inside Noise. */
export async function startMobileRelay(
  token: string,
  port = 0,
  hostname = "127.0.0.1",
) {
  if (token.length < 32) throw Error("mobile_relay_token_invalid");
  const server = http.createServer((q, r) => {
    if (q.url === "/health") {
      r.writeHead(200, { "content-type": "application/json" });
      r.end('{"ok":true}');
      return;
    }
    r.writeHead(404);
    r.end();
  });
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 100000,
    perMessageDeflate: false,
  });
  const hosts = new Map<string, WebSocket>(),
    waiting = new Map<
      string,
      { phone: WebSocket; host: WebSocket; timer: NodeJS.Timeout }
    >();
  const sockets = new Set<WebSocket>();
  // Keep NAT mappings alive; peers that disappear without a close frame must
  // not prevent the same installation from reconnecting indefinitely.
  const alive = new WeakSet<WebSocket>();
  const heartbeat = setInterval(() => {
    for (const socket of sockets) {
      if (!alive.has(socket)) socket.terminate();
      else {
        alive.delete(socket);
        socket.ping();
      }
    }
  }, 25000);
  heartbeat.unref();
  server.on("upgrade", (req, sock, head) => {
    let url: URL;
    try {
      url = new URL(req.url ?? "", "http://relay");
    } catch {
      sock.destroy();
      return;
    }
    const role = url.pathname,
      id = url.searchParams.get("installationId") ?? "";
    if (
      (req.headers.origin &&
        !(
          role === "/mobile/connect" && req.headers.origin === "kteam://mobile"
        )) ||
      sockets.size >= 128 ||
      !["/mobile/host", "/mobile/connect", "/mobile/bridge"].includes(role) ||
      !/^[a-f0-9-]{36}$/.test(id)
    ) {
      sock.destroy();
      return;
    }
    const supplied = Buffer.from(String(req.headers.authorization ?? "")),
      expected = Buffer.from("Bearer " + token);
    if (
      role !== "/mobile/connect" &&
      (supplied.length !== expected.length ||
        !timingSafeEqual(supplied, expected))
    ) {
      sock.destroy();
      return;
    }
    if (
      (role === "/mobile/host" && hosts.has(id)) ||
      (role === "/mobile/connect" &&
        (!hosts.has(id) ||
          [...waiting.values()].filter((v) => v.host === hosts.get(id))
            .length >= 8))
    ) {
      sock.destroy();
      return;
    }
    wss.handleUpgrade(req, sock, head, (ws) => {
      sockets.add(ws);
      alive.add(ws);
      ws.on("pong", () => alive.add(ws));
      ws.on("error", () => {});
      ws.on("close", () => {
        sockets.delete(ws);
        if (hosts.get(id) === ws) hosts.delete(id);
        for (const [k, v] of waiting)
          if (v.phone === ws || v.host === ws) {
            clearTimeout(v.timer);
            v.phone.terminate();
            waiting.delete(k);
          }
      });
      if (role === "/mobile/host") {
        hosts.set(id, ws);
        ws.on("message", () => ws.terminate());
        return;
      }
      if (role === "/mobile/connect") {
        const host = hosts.get(id)!;
        const channel = randomBytes(24).toString("hex");
        let queue: Buffer[] = [];
        let bytes = 0;
        const hold = (data: any) => {
          bytes += data.length;
          if (bytes > 256000) ws.terminate();
          else queue.push(Buffer.from(data));
        };
        ws.on("message", hold);
        const timer = setTimeout(() => {
          waiting.delete(channel);
          ws.terminate();
        }, 10000);
        waiting.set(channel, { phone: ws, host, timer });
        (ws as any).take = () => {
          ws.off("message", hold);
          const result = queue;
          queue = [];
          return result;
        };
        host.send(JSON.stringify({ type: "connect", channel }));
        return;
      }
      const channel = url.searchParams.get("channel") ?? "",
        pending = waiting.get(channel);
      if (!pending || pending.host !== hosts.get(id)) {
        ws.terminate();
        return;
      }
      waiting.delete(channel);
      clearTimeout(pending.timer);
      const phone = pending.phone;
      const forward = (to: WebSocket, data: any) => {
        if (
          to.readyState !== WebSocket.OPEN ||
          to.bufferedAmount > 2 * 1024 * 1024
        ) {
          ws.terminate();
          phone.terminate();
          return;
        }
        to.send(data, { binary: false });
      };
      for (const data of (phone as any).take()) forward(ws, data);
      phone.on("message", (data) => forward(ws, data));
      ws.on("message", (data) => forward(phone, data));
      phone.on("close", () => ws.terminate());
      ws.on("close", () => phone.terminate());
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, hostname, resolve);
  });
  return {
    port: (server.address() as any).port,
    async close() {
      clearInterval(heartbeat);
      for (const s of sockets) s.terminate();
      for (const v of waiting.values()) clearTimeout(v.timer);
      waiting.clear();
      wss.close();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
/** PC-initiated connection: relay never needs an inbound PC port or desktop credentials. */
export class MobileRelayClient {
  private control?: WebSocket;
  private data = new Set<WebSocket>();
  private timer?: NodeJS.Timeout;
  private stopped = false;
  status = "disconnected";
  constructor(
    private url: string,
    private token: string,
    private installationId: string,
    private accept: (ws: WebSocket) => void,
  ) {}
  start() {
    if (this.control || this.stopped) return;
    const control = new WebSocket(
      this.url +
        "/mobile/host?installationId=" +
        encodeURIComponent(this.installationId),
      {
        headers: { authorization: "Bearer " + this.token },
        maxPayload: 4096,
        perMessageDeflate: false,
        handshakeTimeout: 10000,
      },
    );
    this.control = control;
    this.status = "connecting";
    control.on("open", () => {
      this.status = "connected";
    });
    control.on("error", () => {});
    control.on("message", (data) => {
      try {
        const v = JSON.parse(data.toString());
        if (
          v.type !== "connect" ||
          !/^[a-f0-9]{48}$/.test(v.channel) ||
          this.data.size >= 32
        )
          throw Error();
        const ws = new WebSocket(
          this.url +
            "/mobile/bridge?installationId=" +
            encodeURIComponent(this.installationId) +
            "&channel=" +
            v.channel,
          {
            headers: { authorization: "Bearer " + this.token },
            maxPayload: 100000,
            perMessageDeflate: false,
            handshakeTimeout: 10000,
          },
        );
        this.data.add(ws);
        ws.on("error", () => {});
        ws.on("close", () => this.data.delete(ws));
        ws.on("open", () => this.accept(ws));
      } catch {
        control.terminate();
      }
    });
    control.on("close", () => {
      this.control = undefined;
      this.status = "disconnected";
      for (const ws of this.data) ws.terminate();
      if (!this.stopped) this.timer = setTimeout(() => this.start(), 5000);
    });
  }
  close() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.control?.terminate();
    for (const ws of this.data) ws.terminate();
    this.data.clear();
  }
}
