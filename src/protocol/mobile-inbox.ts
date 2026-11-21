export interface MobileInboxCursor {
  epoch: number;
  sequence: number;
}

interface InboxSnapshot {
  attentionCursor?: MobileInboxCursor;
}

function validCursor(cursor: MobileInboxCursor | undefined): cursor is MobileInboxCursor {
  return !!cursor && Number.isSafeInteger(cursor.epoch) && cursor.epoch > 0
    && Number.isSafeInteger(cursor.sequence) && cursor.sequence > 0;
}

/** Replace the entire projection. Absence in a newer snapshot withdraws the old card. */
export function latestMobileInbox<T extends InboxSnapshot>(current: T | undefined, next: T): T {
  const prior = current?.attentionCursor;
  const incoming = next.attentionCursor;
  if (!current || !validCursor(prior)) return next;
  if (!validCursor(incoming)) return current;
  return incoming.epoch > prior.epoch ||
    incoming.epoch === prior.epoch && incoming.sequence > prior.sequence ? next : current;
}
