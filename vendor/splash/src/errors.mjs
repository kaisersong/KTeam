export class Failure extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
export function requireValue(condition, code, status = 400) {
  if (!condition) throw new Failure(code, status);
}
