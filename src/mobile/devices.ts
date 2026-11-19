import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { hostname, networkInterfaces } from "node:os";
import type { TeamStore } from "../service/team-store.js";
import { KTeamError, record, fields, text } from "../errors.js";
import {
  mobileB64,
  mobileBytes,
  newMobileKeypair,
  type MobileKeypair,
} from "../protocol/mobile-wire.js";

/** Human comparison only. The identity is the full Noise static key, not these 12 hex characters. */
export function mobilePairFingerprint(peerKey: string) {
  return createHash("sha256").update(peerKey).digest("hex").slice(0, 12);
}
export type MobileRevocation = {
  v: 1;
  installationId: string;
  deviceId: string;
  epoch: number;
  seq: number;
};
export type MobilePrincipal = {
  kind: "device" | "invite";
  id: string;
  epoch: number;
  peerKey?: string;
  revoked?: MobileRevocation;
};
export class MobileDevices {
  private state: any;
  private revocations: MobileRevocation[] = [];
  constructor(private store: TeamStore) {
    this.state = store.state<any>("mobile-devices:v1");
    if (!this.state) {
      const key = newMobileKeypair();
      this.state = {
        installationId: randomUUID(),
        key: {
          publicKey: mobileB64(key.publicKey),
          secretKey: mobileB64(key.secretKey),
        },
        enabled: false,
        port: 0,
        epoch: 1,
        devices: [],
        invites: [],
      };
      this.save();
    }
  }
  private save() {
    this.store.setState("mobile-devices:v1", this.state);
  }
  get keypair(): MobileKeypair {
    return {
      publicKey: mobileBytes(this.state.key.publicKey, 32),
      secretKey: mobileBytes(this.state.key.secretKey, 32),
    };
  }
  get installationId() {
    return this.state.installationId as string;
  }
  get enabled() {
    return this.state.enabled === true;
  }
  get relay() {
    return this.state.relay as { url: string; token: string } | undefined;
  }
  get port() {
    return Number(this.state.port) || 0;
  }
  rememberPort(port: number) {
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new KTeamError("mobile_port_invalid");
    if (this.state.port === port) return;
    this.state.port = port;
    this.save();
  }
  view() {
    return {
      ok: true,
      enabled: this.enabled,
      installationId: this.installationId,
      computerName: hostname(),
      publicKey: this.state.key.publicKey,
      relay: this.relay ? { url: this.relay.url, configured: true } : undefined,
      devices: this.state.devices.map(
        ({ id, name, createdAt, revokedAt, allowApprovals }: any) => ({
          id,
          name,
          createdAt,
          revokedAt,
          allowApprovals,
        }),
      ),
      requests: this.state.invites
        .filter(
          (i: any) =>
            i.expiresAt > Date.now() && i.claim && i.status === "pending",
        )
        .map((i: any) => ({
          id: i.id,
          name: i.claim.name,
          expiresAt: i.expiresAt,
        })),
    };
  }
  configure(value: unknown) {
    const i = record(value);
    fields(i, ["action", "id", "port", "url", "token", "allowApprovals", "fingerprint"]);
    const action = text(i.action, "action");
    if (action === "enable") {
      if (
        i.port !== undefined &&
        (!Number.isInteger(i.port) ||
          Number(i.port) < 0 ||
          Number(i.port) > 65535)
      )
        throw new KTeamError("mobile_port_invalid");
      this.state.enabled = true;
      this.state.port = i.port ?? 0;
    } else if (action === "disable") {
      this.state.enabled = false;
      this.state.epoch++;
      this.state.invites = [];
    } else if (action === "approve") {
      const invite = this.state.invites.find((v: any) => v.id === i.id);
      if (
        !invite?.claim ||
        invite.expiresAt <= Date.now() ||
        invite.status !== "pending"
      )
        throw new KTeamError("mobile_invite_expired", 409);
      const typed = text(i.fingerprint, "fingerprint").trim().toLowerCase();
      const bound = invite.claim.peerKey;
      // The person types the 12 characters shown on the phone. The stored identity is the claim's full key.
      if (!/^[0-9a-f]{12}$/.test(typed) || typed !== mobilePairFingerprint(bound))
        throw new KTeamError("mobile_pair_mismatch", 409);
      const previous = this.state.devices.find((d: any) => d.peerKey === bound);
      const secret = randomBytes(32).toString("base64"),
        id = previous?.id ?? "device-" + randomBytes(16).toString("hex");
      const device = {
        id,
        name: invite.claim.name,
        createdAt: previous?.createdAt ?? Date.now(),
        pairedAt: Date.now(),
        epoch: (previous?.epoch ?? 0) + 1,
        psk: mobileB64(createHash("sha256").update(secret).digest()),
        peerKey: bound,
        allowApprovals: i.allowApprovals === true,
      };
      this.state.devices = this.state.devices.filter((d: any) => d.peerKey !== invite.claim.peerKey);
      this.state.devices.push(device);
      invite.status = "approved";
      invite.result = {
        deviceId: id,
        secret,
        installationId: this.installationId,
        publicKey: this.state.key.publicKey,
        epoch: device.epoch,
        fingerprint: mobilePairFingerprint(bound),
      };
    } else if (action === "revoke") {
      const d = this.state.devices.find((d: any) => d.id === i.id);
      if (!d) throw new KTeamError("mobile_device_missing", 404);
      const notice: MobileRevocation = {
        v: 1,
        installationId: this.installationId,
        deviceId: d.id,
        epoch: d.epoch,
        seq: (d.revokeSeq ?? 0) + 1,
      };
      d.revokeSeq = notice.seq;
      d.revokeNotice = notice;
      d.epoch++;
      d.revokedAt = Date.now();
      this.revocations.push(notice);
    } else if (action === "relay") {
      if (i.url === undefined || i.url === "") {
        delete this.state.relay;
      } else {
        const u = new URL(text(i.url, "url"));
        if (
          (u.protocol !== "wss:" &&
            !(
              u.protocol === "ws:" &&
              ["127.0.0.1", "localhost"].includes(u.hostname)
            )) ||
          u.username ||
          u.password ||
          u.search ||
          u.hash
        )
          throw new KTeamError("mobile_relay_invalid");
        this.state.relay = { url: u.origin, token: text(i.token, "token") };
      }
    } else throw new KTeamError("mobile_action_forbidden", 403);
    this.save();
    return this.view();
  }
  invite(port: number) {
    if (!this.enabled) throw new KTeamError("mobile_disabled", 409);
    this.state.invites = this.state.invites.filter(
      (v: any) => v.expiresAt > Date.now() && v.status !== "redeemed",
    );
    if (this.state.invites.length >= 3)
      throw new KTeamError("mobile_invite_limit", 429);
    const secret = randomBytes(32).toString("base64"),
      id = "invite-" + randomBytes(16).toString("hex"),
      expiresAt = Date.now() + 120000;
    this.state.invites.push({
      id,
      psk: mobileB64(createHash("sha256").update(secret).digest()),
      expiresAt,
      status: "pending",
    });
    this.save();
    const endpoints = Object.values(networkInterfaces()).flatMap((rows) =>
      (rows ?? [])
        .filter((r) => r.family === "IPv4" && !r.internal)
        .map((r) => "ws://" + r.address + ":" + port + "/mobile/connect"),
    );
    const payload = {
      v: 1,
      product: "kteam",
      installationId: this.installationId,
      computerName: hostname(),
      publicKey: this.state.key.publicKey,
      inviteId: id,
      secret,
      expiresAt,
      endpoints,
      relay: this.relay
        ? this.relay.url +
          "/mobile/connect?installationId=" +
          encodeURIComponent(this.installationId)
        : undefined,
    };
    return {
      ok: true,
      payload,
      link:
        "kteam://pair?data=" +
        encodeURIComponent(
          Buffer.from(JSON.stringify(payload)).toString("base64url"),
        ),
    };
  }
  authenticate(id: unknown) {
    if (!this.enabled || typeof id !== "string")
      throw new KTeamError("mobile_auth_required", 401);
    const d = this.state.devices.find((d: any) => d.id === id && !d.revokedAt);
    if (d)
      return {
        principal: {
          kind: "device",
          id: d.id,
          epoch: d.epoch,
          peerKey: d.peerKey,
        } as MobilePrincipal,
        psk: mobileBytes(d.psk, 32),
      };
    const i = this.state.invites.find(
      (i: any) =>
        i.id === id && i.expiresAt > Date.now() && i.status !== "redeemed",
    );
    if (i)
      return {
        principal: {
          kind: "invite",
          id: i.id,
          epoch: this.state.epoch,
          peerKey: i.claim?.peerKey,
        } as MobilePrincipal,
        psk: mobileBytes(i.psk, 32),
      };
    throw new KTeamError("mobile_auth_required", 401);
  }
  /** Revoked devices can still finish Noise so the phone can receive one encrypted notice. They cannot call methods. */
  delivery(id: unknown) {
    if (typeof id === "string") {
      const revoked = this.state.devices.find(
        (d: any) => d.id === id && d.revokedAt && d.revokeNotice,
      );
      if (revoked)
        return {
          principal: {
            kind: "device",
            id: revoked.id,
            epoch: revoked.epoch,
            peerKey: revoked.peerKey,
            revoked: revoked.revokeNotice,
          } as MobilePrincipal,
          psk: mobileBytes(revoked.psk, 32),
        };
    }
    return this.authenticate(id);
  }
  activeRevocation(id: string) {
    const d = this.state.devices.find((d: any) => d.id === id && d.revokedAt && d.revokeNotice);
    return d?.revokeNotice as MobileRevocation | undefined;
  }
  takeRevocations() {
    const notices = this.revocations;
    this.revocations = [];
    return notices;
  }
  assert(p: MobilePrincipal, approve = false) {
    if (p.kind === "device" && this.state.devices.find((d: any) => d.id === p.id)?.revokedAt)
      throw new KTeamError("mobile_device_revoked", 403);
    const current = this.authenticate(p.id).principal;
    if (
      current.kind !== p.kind ||
      current.epoch !== p.epoch ||
      (approve &&
        !this.state.devices.find((d: any) => d.id === p.id)?.allowApprovals)
    )
      throw new KTeamError("mobile_device_revoked", 403);
  }
  pair(p: MobilePrincipal, peerKey: string, value: unknown) {
    this.assert(p);
    if (p.kind !== "invite") throw new KTeamError("mobile_pair_forbidden", 403);
    const input = record(value);
    fields(input, ["name", "action"]);
    const i = this.state.invites.find((v: any) => v.id === p.id);
    if (i.claim && i.claim.peerKey !== peerKey)
      throw new KTeamError("mobile_pair_conflict", 409);
    if (!i.claim) {
      const name = text(input.name, "name");
      if (name.length > 80) throw new KTeamError("mobile_name_invalid");
      i.claim = { name, peerKey };
      this.save();
    }
    const fingerprint = mobilePairFingerprint(peerKey);
    if (input.action === "finish") {
      if (i.status !== "approved")
        throw new KTeamError("mobile_pair_pending", 409);
      i.status = "redeemed";
      delete i.result;
      this.save();
      return { ok: true };
    }
    return i.status === "approved"
      ? { ok: true, paired: true, fingerprint, ...i.result }
      : { ok: true, pending: true, fingerprint };
  }
}
