export function attentionDeadline(value?: string): number {
  const deadline = value ? Date.parse(value) : NaN;
  return Number.isFinite(deadline) ? deadline : Infinity;
}
