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
    const timeout = setTimeout(
      () => reject(Error("mobile_client_timeout")),
      10000,
    );
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
    socket.on("error", reject);
    socket.on("close", () => {
      clearTimeout(timeout);
      reject(Error("mobile_connection_closed"));
      for (const p of pending.values())
        p.reject(Error("mobile_connection_closed"));
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
        if (value.type === "ready") {
          clearTimeout(timeout);
          resolve();
          return;
        }
        const p = pending.get(value.id);
        if (p) {
          pending.delete(value.id);
          value.ok ? p.resolve(value.value) : p.reject(Error(value.code));
        }
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
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
