/** Persist only after the person confirms and the host binds this exact claim. */
export function acceptPairing(input: {
  confirmed: boolean;
  paired?: boolean;
  localFingerprint: string;
  remoteFingerprint?: string;
  deviceId?: string;
  secret?: string;
  epoch?: number;
}) {
  if (!input.confirmed || input.paired !== true) return { persist: false as const };
  if (!input.remoteFingerprint || input.remoteFingerprint !== input.localFingerprint)
    return { persist: false as const, reason: "fingerprint" as const };
  if (!input.deviceId || !input.secret || !Number.isInteger(input.epoch))
    return { persist: false as const, reason: "incomplete" as const };
  return {
    persist: true as const,
    deviceId: input.deviceId,
    secret: input.secret,
    epoch: input.epoch as number,
  };
}
