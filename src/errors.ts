export class KTeamError extends Error {
  constructor(public code: string, public status = 400, public details?: unknown) {
    super(code);
  }
}

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new KTeamError('object_required');
  return value as Record<string, unknown>;
}

export function fields(input: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(input).some(key => !allowed.includes(key))) throw new KTeamError('unknown_field');
}

export function text(value: unknown, field: string, max = 256): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new KTeamError('invalid_' + field);
  return value;
}
