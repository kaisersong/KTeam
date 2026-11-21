import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import * as SQLite from "expo-sqlite";
import type { Computer } from "./transport";
import { mobileB64, mobileBytes, newMobileKeypair, type MobileKeypair } from "../../src/protocol/mobile-wire";
let identityTask: Promise<MobileKeypair> | undefined;
export function deviceIdentity(): Promise<MobileKeypair> {
  return identityTask ??= (async () => {
    const name = "kteam-mobile-device-key-v1";
    const saved = await SecureStore.getItemAsync(name);
    // Adopt an existing pairing identity on upgrade, so it is not another phone.
    const previous = saved ? JSON.parse(saved) : (await computers())[0]?.key;
    const key = previous ? { publicKey: mobileBytes(previous.publicKey, 32), secretKey: mobileBytes(previous.secretKey, 32) } : newMobileKeypair();
    if (!saved) await SecureStore.setItemAsync(name, JSON.stringify({ publicKey: mobileB64(key.publicKey), secretKey: mobileB64(key.secretKey) }), { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
    return key;
  })().catch(e => { identityTask = undefined; throw e; });
}
const INDEX = "kteam-computers-v1";
export async function computers(): Promise<Computer[]> {
  const ids: string[] = JSON.parse(
    (await SecureStore.getItemAsync(INDEX)) ?? "[]",
  );
  const rows = await Promise.all(
    ids.map((id) => SecureStore.getItemAsync("kteam-pc-" + id)),
  );
  return rows.filter(Boolean).map((v) => JSON.parse(v!));
}
export async function saveComputer(c: Computer) {
  const all = await computers();
  const ids = [
    ...new Set([c.installationId, ...all.map((v) => v.installationId)]),
  ];
  if (ids.length > 8) throw Error("最多连接 8 台电脑");
  await SecureStore.setItemAsync(
    "kteam-pc-" + c.installationId,
    JSON.stringify(c),
    { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
  );
  await SecureStore.setItemAsync(INDEX, JSON.stringify(ids));
}
export async function forgetComputer(c: Computer) {
  await SecureStore.deleteItemAsync("kteam-pc-" + c.installationId);
  const all = await computers();
  await SecureStore.setItemAsync(
    INDEX,
    JSON.stringify(
      all
        .filter((v) => v.installationId !== c.installationId)
        .map((v) => v.installationId),
    ),
  );
  const scope = c.installationId + "-" + c.credentialId;
  const open = databases.get(scope);
  if (open) {
    await (await open).closeAsync();
    databases.delete(scope);
  }
  await SQLite.deleteDatabaseAsync("kteam-" + scope + ".db");
  await SecureStore.deleteItemAsync("kteam-cache-key-" + c.installationId);
}
const databases = new Map<string, Promise<SQLite.SQLiteDatabase>>();
export async function cache(c: Computer) {
  const scope = c.installationId + "-" + c.credentialId;
  let task = databases.get(scope);
  if (!task) {
    task = (async () => {
      let key = await SecureStore.getItemAsync(
        "kteam-cache-key-" + c.installationId,
      );
      if (!key) {
        key = Array.from(Crypto.getRandomBytes(32), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join("");
        await SecureStore.setItemAsync(
          "kteam-cache-key-" + c.installationId,
          key,
          { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
        );
      }
      const d = await SQLite.openDatabaseAsync("kteam-" + scope + ".db");
      await d.execAsync(`PRAGMA key = "x'${key}'";`);
      const cipher = await d.getFirstAsync("PRAGMA cipher_version");
      if (!cipher) {
        await d.closeAsync();
        throw Error("加密缓存不可用");
      }
      await d.execAsync(
        "CREATE TABLE IF NOT EXISTS cache(k TEXT PRIMARY KEY,v TEXT NOT NULL,at INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS messages(room TEXT NOT NULL,id TEXT NOT NULL,seq INTEGER NOT NULL,value TEXT NOT NULL,PRIMARY KEY(room,id)); CREATE INDEX IF NOT EXISTS messages_room_sequence ON messages(room,seq)",
      );
      return d;
    })();
    databases.set(scope, task);
    task.catch(() => databases.delete(scope));
  }
  return task;
}
export async function readCache(c: Computer, k: string) {
  const d = await cache(c),
    row = await d.getFirstAsync<{ v: string; at: number }>(
      "SELECT v,at FROM cache WHERE k=?",
      k,
    );
  return row && Date.now() - row.at < 86400000 ? JSON.parse(row.v) : undefined;
}
export async function writeCache(c: Computer, k: string, v: any) {
  const d = await cache(c);
  await d.runAsync(
    "INSERT INTO cache(k,v,at) VALUES(?,?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v,at=excluded.at",
    k,
    JSON.stringify(v),
    Date.now(),
  );
}
export async function clearCacheEntry(c:Computer,key:string){
  await (await cache(c)).runAsync("DELETE FROM cache WHERE k=?",key);
}
export async function savePending(c: Computer, id: string, value: any) {
  const d = await cache(c);
  await d.runAsync(
    "INSERT OR REPLACE INTO cache(k,v,at) VALUES(?,?,?)",
    "pending:" + id,
    JSON.stringify(value),
    Date.now(),
  );
}
export async function pending(c: Computer) {
  const d = await cache(c);
  return (
    await d.getAllAsync<{ k: string; v: string }>(
      "SELECT k,v FROM cache WHERE k LIKE 'pending:%' ORDER BY at",
    )
  ).map((v) => ({ key: v.k, ...JSON.parse(v.v) }));
}
export async function clearPending(c: Computer, id: string) {
  await (
    await cache(c)
  ).runAsync("DELETE FROM cache WHERE k=?", "pending:" + id);
}

export async function clearReadCache(c: Computer) {
  await (
    await cache(c)
  ).execAsync(
    "DELETE FROM cache WHERE k NOT LIKE 'pending:%'; DELETE FROM messages;",
  );
}

export async function selectComputer(c: Computer) {
  const all = await computers();
  await SecureStore.setItemAsync(
    INDEX,
    JSON.stringify([
      c.installationId,
      ...all
        .filter((v) => v.installationId !== c.installationId)
        .map((v) => v.installationId),
    ]),
  );
}

export async function cachedMessages(
  c: Computer,
  room: string,
  before = Number.MAX_SAFE_INTEGER,
) {
  const rows = await (
    await cache(c)
  ).getAllAsync<{ value: string }>(
    "SELECT value FROM messages WHERE room=? AND seq<? ORDER BY seq DESC LIMIT 100",
    room,
    before,
  );
  return rows.map((row) => JSON.parse(row.value)).reverse();
}
export async function cacheMessages(
  c: Computer,
  room: string,
  messages: any[],
) {
  if (!messages.length) return;
  const db = await cache(c);
  // SQLCipher keys belong to this configured connection. An exclusive transaction
  // opens another connection without its key; keep atomic row upserts on this one.
  const statement = await db.prepareAsync(
    "INSERT INTO messages(room,id,seq,value) VALUES(?,?,?,?) ON CONFLICT(room,id) DO UPDATE SET seq=excluded.seq,value=excluded.value WHERE value<>excluded.value",
  );
  try {
    for (const message of messages)
      await statement.executeAsync(
        room,
        message.messageId,
        message.roomSequence,
        JSON.stringify(message),
      );
  } finally {
    await statement.finalizeAsync();
  }
}
