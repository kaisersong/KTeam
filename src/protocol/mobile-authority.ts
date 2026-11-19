export type PhoneCredential = {
  installationId: string;
  credentialId: string;
  epoch?: number;
  appliedRevokeSeq?: number;
};

export type PhoneSession<T extends PhoneCredential = PhoneCredential> = {
  computer?: T;
  locked: boolean;
};

export type AuthorityEvent =
  | { type: "close" }
  | { type: "ready"; installationId: string; deviceId?: string; epoch?: number }
  | { type: "revoke"; installationId: string; deviceId: string; epoch: number; seq: number };

/** Close codes never wipe. A ready frame unlocks only when this credential generation is still current. */
export function reducePhoneSession<T extends PhoneCredential>(
  state: PhoneSession<T>,
  event: AuthorityEvent,
): { state: PhoneSession<T>; effect: "lock" | "unlock" | "wipe" | "ignore"; epoch?: number } {
  const computer = state.computer;
  if (!computer) return { state, effect: "ignore" };
  if (event.type === "close") {
    if (state.locked) return { state, effect: "ignore" };
    return { state: { ...state, locked: true }, effect: "lock" };
  }
  if (event.type === "ready") {
    const generationKnown = Number.isInteger(computer.epoch);
    const proven =
      event.installationId === computer.installationId &&
      event.deviceId === computer.credentialId &&
      Number.isInteger(event.epoch) &&
      (!generationKnown || event.epoch === computer.epoch);
    if (!proven) return state.locked ? { state, effect: "ignore" } : { state: { ...state, locked: true }, effect: "lock" };
    const adopted = generationKnown ? computer : { ...computer, epoch: event.epoch };
    const next = { ...state, computer: adopted, locked: false };
    return state.locked || !generationKnown
      ? { state: next, effect: "unlock", epoch: event.epoch }
      : { state: next, effect: "ignore", epoch: event.epoch };
  }
  const current = matchesCurrentGeneration(computer, event) && event.seq > (computer.appliedRevokeSeq ?? 0);
  if (!current) return { state, effect: "ignore" };
  return { state: { locked: false }, effect: "wipe" };
}

/** Trip the write barrier before any local deletion. Close codes never reach this wipe path. */
export function applyPhoneAuthority<T extends PhoneCredential>(
  state: PhoneSession<T>,
  event: AuthorityEvent,
  barrier: ResponseBarrier,
  deleteSensitive: () => void,
) {
  const reduced = reducePhoneSession(state, event);
  if (reduced.effect === "wipe") {
    barrier.trip();
    deleteSensitive();
  }
  return reduced;
}

function matchesCurrentGeneration(computer: PhoneCredential, event: Extract<AuthorityEvent, { type: "revoke" }>) {
  return (
    event.installationId === computer.installationId &&
    event.deviceId === computer.credentialId &&
    Number.isInteger(computer.epoch) &&
    event.epoch === computer.epoch &&
    Number.isInteger(event.seq) &&
    event.seq > 0
  );
}

/** Late responses must not write after a revoke barrier trips. */
export class ResponseBarrier {
  private generation = 0;
  token() {
    return this.generation;
  }
  trip() {
    this.generation += 1;
  }
  accepts(token: number) {
    return token === this.generation;
  }
}
