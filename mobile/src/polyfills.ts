import { Buffer } from "buffer";
import * as Crypto from "expo-crypto";
(globalThis as any).Buffer = Buffer;
if (!(globalThis as any).crypto?.getRandomValues)
  (globalThis as any).crypto = {
    ...((globalThis as any).crypto ?? {}),
    getRandomValues: Crypto.getRandomValues,
  };
