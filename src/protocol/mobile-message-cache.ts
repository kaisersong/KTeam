/** Keep object identity for unchanged messages so polling does not rerender Markdown. */
export function mergeMessages(previous: any[], incoming: any[]) {
  if (!incoming.length) return previous;
  const rows = new Map(previous.map((m) => [m.messageId, m]));
  let changed = false;
  for (const message of incoming) {
    const old = rows.get(message.messageId);
    if (!old || JSON.stringify(old) !== JSON.stringify(message)) {
      rows.set(message.messageId, message);
      changed = true;
    }
  }
  return changed
    ? [...rows.values()].sort((a, b) => a.roomSequence - b.roomSequence)
    : previous;
}
export const visibleRooms = (rooms: any[]) =>
  rooms.filter((r) => r.kind !== "peer");
