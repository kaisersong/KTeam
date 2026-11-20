import { WebSocket } from "ws";
import { createHash, randomUUID } from "node:crypto";
import {
  MobileHandshake,
  MobileFrames,
  mobileBytes,
  newMobileKeypair,
  type MobileKeypair,
} from "../../src/protocol/mobile-wire.js";
export async function mobileClient(
  url: string,
  invite: { credentialId: string; secret: string; publicKey: string },
  key: MobileKeypair = newMobileKeypair(),
  options: { ackRevoke?: boolean; onClose?: (code: number) => void } = {},
) {
  const socket = new WebSocket(url,{headers:{Origin:"kteam://mobile"}}),
    noise = new MobileHandshake(
      true,
      key,
      createHash("sha256").update(invite.secret).digest(),
      mobileBytes(invite.publicKey, 32),
    );
  let frames: MobileFrames | undefined;
  const pending = new Map<
    string,
    { resolve: (r: any) => void; reject: (e: Error) => void }
  >();
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(
      () => finish(Error("mobile_client_timeout")),
      10000,
    );
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve();
    };
    socket.on("open", () =>
      socket.send(
        JSON.stringify({
          type: "hello",
          v: 1,
          credentialId: invite.credentialId,
          packet: noise.send(),
        }),
      ),
    );
    socket.on("error", (error) =>
      finish(error instanceof Error ? error : Error("mobile_connection_closed")),
    );
    socket.on("close", (code: number) => {
      options.onClose?.(code);
      finish(Error("mobile_connection_closed"));
      for (const item of pending.values())
        item.reject(Error("mobile_connection_closed"));
      pending.clear();
    });
    socket.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        if (!frames) {
          noise.receive(message.packet);
          socket.send(
            JSON.stringify({ type: "handshake", packet: noise.send() }),
          );
          frames = new MobileFrames(noise);
          return;
        }
        const value = frames.receive(message.packet);
        if (!value) return;
        if (value.type === "device-revoked") {
          const error = Error("mobile_device_revoked");
          for (const item of pending.values()) item.reject(error);
          pending.clear();
          if (options.ackRevoke !== false) {
            try {
              for (const packet of frames.encode({ id: randomUUID(), method: "revoke.ack", input: {} }))
                socket.send(JSON.stringify({ type: "record", packet }));
            } catch {}
          }
          finish(error);
          return;
        }
        if (value.type === "ready") {
          finish();
          return;
        }
        const p = pending.get(value.id);
        if (p) {
          pending.delete(value.id);
          value.ok ? p.resolve(value.value) : p.reject(Error(value.code));
        }
      } catch (error) {
        finish(error instanceof Error ? error : Error("mobile_connection_closed"));
        socket.terminate();
      }
    });
  });
  return {
    key,
    call: (method: string, input: any = {}) =>
      new Promise<any>((resolve, reject) => {
        const id = randomUUID();
        pending.set(id, { resolve, reject });
        for (const packet of frames!.encode({ id, method, input }))
          socket.send(JSON.stringify({ type: "record", packet }));
      }),
    close: () => socket.terminate(),
  };
}
