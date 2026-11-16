import { Buffer } from "buffer";
import Noise from "noise-handshake";
import Cipher from "noise-handshake/cipher.js";
import dh from "noise-handshake/dh.js";
export const MOBILE_PROTOCOL = 1;
export const MOBILE_MAX_BYTES = 8 * 1024 * 1024;
export type MobileKeypair = { publicKey: Uint8Array; secretKey: Uint8Array };
export function newMobileKeypair(): MobileKeypair {
  return dh.generateKeyPair();
}
export const mobileB64 = (bytes: Uint8Array) =>
  Buffer.from(bytes).toString("base64");
export function mobileBytes(value: unknown, max = 65535) {
  if (
    typeof value !== "string" ||
    value.length > Math.ceil(max / 3) * 4 ||
    !value.length ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  )
    throw Error("mobile_frame_invalid");
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value || bytes.length > max)
    throw Error("mobile_frame_invalid");
  return bytes;
}
/** The package implements Noise_XXpsk0_25519_ChaChaPoly_BLAKE2b. The QR pins the responder static key. */
export class MobileHandshake {
  private state: any;
  private pinned?: string;
  constructor(
    initiator: boolean,
    keypair: MobileKeypair,
    psk: Uint8Array,
    pinned?: Uint8Array,
  ) {
    if (
      psk.length !== 32 ||
      keypair.publicKey.length !== 32 ||
      keypair.secretKey.length !== 32 ||
      (pinned && pinned.length !== 32)
    )
      throw Error("mobile_key_invalid");
    this.state = new Noise(
      "XXpsk0",
      initiator,
      {
        publicKey: Buffer.from(keypair.publicKey),
        secretKey: Buffer.from(keypair.secretKey),
      },
      { psk: Buffer.from(psk) },
    );
    this.state.initialise(Buffer.from("KTeam mobile v1"));
    this.pinned = pinned ? mobileB64(pinned) : undefined;
  }
  send() {
    return mobileB64(this.state.send());
  }
  receive(value: string) {
    this.state.recv(mobileBytes(value));
    if (
      this.pinned &&
      this.state.rs &&
      mobileB64(this.state.rs) !== this.pinned
    )
      throw Error("mobile_host_key_changed");
  }
  get complete() {
    return this.state.complete === true;
  }
  get remoteKey() {
    return mobileB64(this.state.rs);
  }
  ciphers() {
    if (!this.complete) throw Error("mobile_handshake_incomplete");
    return { tx: new Cipher(this.state.tx), rx: new Cipher(this.state.rx) };
  }
}
/** Ordered encrypted records with one bounded logical message in flight in each direction. */
export class MobileFrames {
  private tx: any;
  private rx: any;
  private sent = 0;
  private received = 0;
  private outgoing = 0;
  private incoming = 0;
  private chunks: Buffer[] = [];
  private bytes = 0;
  private total = 0;
  private index = 0;
  private started = 0;
  constructor(handshake: MobileHandshake) {
    const c = handshake.ciphers();
    this.tx = c.tx;
    this.rx = c.rx;
  }
  encode(value: unknown) {
    const data = Buffer.from(JSON.stringify(value));
    if (data.length > MOBILE_MAX_BYTES) throw Error("mobile_message_too_large");
    const total = Math.max(1, Math.ceil(data.length / 24000)),
      id = ++this.outgoing,
      out: string[] = [];
    for (let index = 0; index < total; index++) {
      const frame = Buffer.from(
        JSON.stringify({
          id,
          index,
          total,
          data: mobileB64(data.subarray(index * 24000, (index + 1) * 24000)),
        }),
      );
      if (++this.sent > 1000000) throw Error("mobile_rekey_required");
      out.push(mobileB64(this.tx.encrypt(frame)));
    }
    return out;
  }
  receive(ciphertext: string): any | undefined {
    if (++this.received > 1000000) throw Error("mobile_rekey_required");
    const frame = JSON.parse(
      Buffer.from(this.rx.decrypt(mobileBytes(ciphertext))).toString("utf8"),
    );
    if (
      !Number.isSafeInteger(frame.id) ||
      frame.id !== this.incoming + 1 ||
      !Number.isInteger(frame.index) ||
      frame.index !== this.index ||
      !Number.isInteger(frame.total) ||
      frame.total < 1 ||
      frame.total > 350 ||
      (this.index && frame.total !== this.total) ||
      (this.index && Date.now() - this.started > 20000)
    )
      throw Error("mobile_frame_sequence");
    if (!this.index) {
      this.started = Date.now();
      this.total = frame.total;
    }
    const bytes = mobileBytes(frame.data, 24000);
    this.bytes += bytes.length;
    if (this.bytes > MOBILE_MAX_BYTES) throw Error("mobile_message_too_large");
    this.chunks.push(bytes);
    this.index++;
    if (this.index < this.total) return;
    const result = JSON.parse(Buffer.concat(this.chunks).toString("utf8"));
    this.chunks = [];
    this.bytes = 0;
    this.index = 0;
    this.total = 0;
    this.incoming++;
    return result;
  }
}
