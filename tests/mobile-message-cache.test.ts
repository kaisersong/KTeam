import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeMessages, visibleRooms } from "../src/protocol/mobile-message-cache.js";
test("unchanged polling preserves message and array identity, older pages and updates merge without losing history", () => {
  const rows = Array.from({ length: 400 }, (_, i) => ({
    messageId: String(i),
    roomSequence: i + 1,
    text: "message " + i,
  }));
  assert.equal(mergeMessages(rows, []), rows);
  assert.equal(
    mergeMessages(
      rows,
      rows.slice(-100).map((m) => ({ ...m })),
    ),
    rows,
  );
  const result = mergeMessages(rows, [
    { ...rows[399], text: "edited" },
    { messageId: "400", roomSequence: 401, text: "new" },
  ]);
  assert.equal(result.length, 401);
  assert.equal(result[0], rows[0]);
  assert.notEqual(result[399], rows[399]);
  assert.equal(rows[399]!.text, "message 399");
  const older = mergeMessages(result, [
    { messageId: "older", roomSequence: 0, text: "old" },
  ]);
  assert.equal(older[0].messageId, "older");
  assert.equal(older[1], rows[0]);
});
test("cached peer conversations are excluded while user direct, assistant and group conversations remain", () => {
  const rooms = [
    { kind: "peer", roomId: "private" },
    { kind: "direct", roomId: "human" },
    { kind: "assistant", roomId: "assistant" },
    { kind: "group", roomId: "group" },
  ];
  assert.deepEqual(
    visibleRooms(rooms).map((r) => r.roomId),
    ["human", "assistant", "group"],
  );
  assert.equal(rooms.length, 4);
});
