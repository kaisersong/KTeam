import { Buffer } from "buffer";
import Zeroconf from "react-native-zeroconf";
import * as Crypto from "expo-crypto";
import {
  MobileHandshake,
  MobileFrames,
  mobileB64,
  mobileBytes,
  newMobileKeypair,
  type MobileKeypair,
} from "../../src/protocol/mobile-wire";
import {
  mobileConnectPlan,
  mobileConnectionFailure,
  mobileRouteLabel,
} from "../../src/protocol/mobile-routes";
export type Computer = {
  installationId: string;
  computerName: string;
  publicKey: string;
  credentialId: string;
  secret: string;
  endpoints: string[];
  relay?: string;
  lastEndpoint?: string;
  key: { publicKey: string; secretKey: string };
};
export type Invitation = {
  v: 1;
  product: "kteam";
  installationId: string;
  computerName: string;
  publicKey: string;
  inviteId: string;
  secret: string;
  expiresAt: number;
  endpoints: string[];
  relay?: string;
};
export function parseInvitation(value: string): Invitation {
  let p: any;
  try {
    const u = new URL(value);
    if (u.protocol !== "kteam:" || u.hostname !== "pair") throw Error();
    const s = u.searchParams.get("data")!;
    if (s.length > 10000) throw Error();
    p = JSON.parse(
      Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(),
    );
  } catch {
    throw Error("配对链接无效");
  }
  if (
    p.v !== 1 ||
    p.product !== "kteam" ||
    typeof p.installationId !== "string" ||
    !Number.isSafeInteger(p.expiresAt) ||
    p.expiresAt < Date.now() ||
    p.expiresAt > Date.now() + 130000 ||
    !p.inviteId?.startsWith("invite-") ||
    !Array.isArray(p.endpoints) ||
    p.endpoints.length > 16
  )
    throw Error("二维码已过期或版本不兼容");
  if (
    mobileBytes(p.publicKey, 32).length !== 32 ||
    mobileBytes(p.secret, 32).length !== 32
  )
    throw Error("配对密钥无效");
  for (const address of [...p.endpoints, ...(p.relay ? [p.relay] : [])]) {
    const u = new URL(address);
    if (
      !["ws:", "wss:"].includes(u.protocol) ||
      u.username ||
      u.password ||
      u.hash
    )
      throw Error("连接地址无效");
  }
  return p;
}
export function pairingComputer(p: Invitation, key: MobileKeypair = newMobileKeypair()): Computer {
  return {
    installationId: p.installationId,
    computerName: p.computerName,
    publicKey: p.publicKey,
    credentialId: p.inviteId,
    secret: p.secret,
    endpoints: p.endpoints,
    relay: p.relay,
    key: {
      publicKey: mobileB64(key.publicKey),
      secretKey: mobileB64(key.secretKey),
    },
  };
}
export class MobileConnection {
  private socket?: WebSocket;
  private frames?: MobileFrames;
  private pending = new Map<
    string,
    {
      resolve: (v: any) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private closed = false;
  private ready = false;
  private cancelOpen?: () => void;
  get isReady() { return this.ready && !this.closed; }
  private authorityError?: Error;
  route = "";
  private connecting?: Promise<void>;
  private discovery?: Zeroconf;
  private discovered: string[] = [];
  constructor(readonly computer: Computer, private onRouteUpdate?: (c: Computer) => void) {
    this.discovery = new Zeroconf();
    this.discovery.on("resolved", (s: any) => {
      if (
        s.txt?.installationId !== computer.installationId ||
        !Number.isInteger(s.port)
      )
        return;
      this.discovered = s.addresses
        .filter((a: string) => /^\d+\.\d+\.\d+\.\d+$/.test(a))
        .map((a: string) => "ws://" + a + ":" + s.port + "/mobile/connect");
    });
    this.discovery.on("error", () => {});
    this.discovery.scan({
      type: "kteam-mobile",
      protocol: "tcp",
      domain: "local.",
    });
  }
  async connect() {
    if (this.closed) throw Error("连接已断开");
    if (this.authorityError) throw this.authorityError;
    if (this.ready) return;
    if (!this.connecting)
      this.connecting = this.connectRoutes().finally(() => {
        this.connecting = undefined;
      });
    return this.connecting;
  }
  private async connectRoutes() {
    let last: unknown;
    const deadline = Date.now() + 15000;
    const plan = mobileConnectPlan(this.computer, this.discovered);
    const triedRelay = plan.addresses.some((address) => address === plan.relay);
    const triedDirect = plan.addresses.some((address) => address !== plan.relay);
    for (const address of plan.addresses) {
      if (this.closed) throw Error("连接已断开");
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      try {
        await this.open(address, Math.min(remaining, address.startsWith("wss:") ? 8000 : 1000));
        this.route = mobileRouteLabel(address, plan.relay);
        if (this.computer.lastEndpoint !== address) {
          this.computer.lastEndpoint = address;
          this.onRouteUpdate?.(this.computer);
        }
        return;
      } catch (e) {
        last = e;
        this.socket?.close();
        this.frames = undefined;
        if (this.authorityError) throw this.authorityError;
        if (e instanceof Error && e.message === "mobile_host_key_changed")
          throw e;
      }
    }
    if (this.authorityError) throw this.authorityError;
    throw last instanceof Error && /连接已断开|电脑身份不一致/.test(last.message)
      ? last
      : Error(mobileConnectionFailure(triedRelay, triedDirect));
  }
  private async open(address: string, timeoutMs: number) {
    const digest = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      this.computer.secret,
    );
    if (this.closed) throw Error("连接已断开");
    const psk = Buffer.from(digest, "hex"),
      key = {
        publicKey: mobileBytes(this.computer.key.publicKey, 32),
        secretKey: mobileBytes(this.computer.key.secretKey, 32),
      };
    const noise = new MobileHandshake(
      true,
      key,
      psk,
      mobileBytes(this.computer.publicKey, 32),
    );
    this.frames = undefined;
    const socket: WebSocket = new (WebSocket as any)(address, [], {
      headers: { Origin: "kteam://mobile" },
    });
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      let ready = false;
      const timer = setTimeout(() => {
        socket.close();
        reject(Error("连接超时"));
      }, timeoutMs);
      this.cancelOpen = () => {
        clearTimeout(timer);
        reject(Error("连接已断开"));
      };
      socket.onopen = () =>
        socket.send(
          JSON.stringify({
            type: "hello",
            v: 1,
            credentialId: this.computer.credentialId,
            packet: noise.send(),
          }),
        );
      socket.onerror = () => {
        clearTimeout(timer);
        if (!ready) reject(Error("网络连接失败"));
      };
      socket.onclose = (event) => {
        clearTimeout(timer);
        const code =
          event.code === 4403
            ? "mobile_device_revoked"
            : event.code === 4401
              ? "mobile_auth_required"
              : "连接中断，操作结果待核对";
        // Revocation is terminal for this identity, even with no request in flight.
        // A later route failure must never hide the authority decision as offline.
        if (event.code === 4401 || event.code === 4403)
          this.authorityError = Error(code);
        if (!ready) reject(Error(code));
        if (this.socket === socket) {
          this.ready = false;
          this.frames = undefined;
          for (const p of this.pending.values()) {
            clearTimeout(p.timer);
            p.reject(Error(code));
          }
          this.pending.clear();
        }
      };
      socket.onmessage = (event) => {
        if (this.socket !== socket || this.closed) return;
        try {
          const message = JSON.parse(String(event.data));
          if (!this.frames) {
            if (message.type !== "handshake") throw Error("协议不兼容");
            noise.receive(message.packet);
            socket.send(
              JSON.stringify({ type: "handshake", packet: noise.send() }),
            );
            this.frames = new MobileFrames(noise);
            return;
          }
          const value = this.frames.receive(message.packet);
          if (!value) return;
          if (value.type === "ready") {
            if (value.installationId !== this.computer.installationId)
              throw Error("电脑身份不一致");
            // Routing changes arrive only inside the authenticated Noise channel.
            // Never learn a remote address from an unauthenticated discovery peer.
            if (value.relay === null || typeof value.relay === "string") {
              const relay = value.relay ? new URL(value.relay) : undefined;
              if (relay && (relay.protocol !== "wss:" || relay.username || relay.password))
                throw Error("远程连接地址无效");
              const next = relay?.toString();
              if (this.computer.relay !== next) {
                this.computer.relay = next;
                this.onRouteUpdate?.(this.computer);
              }
            }
            clearTimeout(timer);
            ready = true;
            this.ready = true;
            this.cancelOpen = undefined;
            resolve();
            return;
          }
          const p = this.pending.get(value.id);
          if (p) {
            clearTimeout(p.timer);
            this.pending.delete(value.id);
            value.ok
              ? p.resolve(value.value)
              : p.reject(Error(value.code ?? "操作失败"));
          }
        } catch (e) {
          clearTimeout(timer);
          socket.close();
          reject(e);
        }
      };
    });
  }
  async call(method: string, input: any = {}) {
    if (this.authorityError) throw this.authorityError;
    if (this.closed) throw Error("连接已断开");
    if (!this.ready) await this.connect();
    const id = Crypto.randomUUID();
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Error("请求超时，操作结果待核对"));
      }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        for (const packet of this.frames!.encode({ id, method, input }))
          this.socket!.send(JSON.stringify({ type: "record", packet }));
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }
  close() {
    this.closed = true;
    this.ready = false;
    this.cancelOpen?.();
    this.cancelOpen = undefined;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(Error("连接已断开，操作结果待核对"));
    }
    this.pending.clear();
    this.discovery?.stop();
    this.discovery?.removeAllListeners();
    this.socket?.close();
    this.frames = undefined;
  }
}
