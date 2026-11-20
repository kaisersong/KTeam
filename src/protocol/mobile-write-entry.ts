import { ResponseBarrier } from "./mobile-authority.js";

const WRITE_METHODS = new Set([
  "messages.send",
  "attachments.stage",
  "attachments.cancel",
  "attachments.send",
  "questions.answer",
  "approvals.decide",
  "inbox.change",
  "work.stop",
]);

export function isMobileWrite(method: string) {
  return WRITE_METHODS.has(method);
}

/** Stop and approval buttons follow the latest lock, not a previous render. */
export function mobileActionDisabled(
  kind: "stop" | "approval",
  state: { locked: boolean; busy?: boolean; offline?: boolean },
) {
  if (kind === "stop") return state.locked || state.offline === true;
  return state.locked || state.busy === true || state.offline === true;
}

export class MobileWriteRefused extends Error {
  constructor(readonly sent: boolean) {
    super("撤销状态未核实，暂不能发送或确认");
  }
}

/** Lock generation advances when a lock begins. An older click cannot send after unlock. */
export class MobileWriteGate {
  locked = false;
  private arm = 0;
  lock() {
    if (this.locked) return;
    this.locked = true;
    this.arm += 1;
  }
  unlock() {
    this.locked = false;
  }
  stamp() {
    if (this.locked) throw new MobileWriteRefused(false);
    return this.arm;
  }
  ensure(stamp: number, sent: boolean) {
    if (this.locked || stamp !== this.arm) throw new MobileWriteRefused(sent);
  }
}

export type MobileWriteTransport = {
  isReady: boolean;
  connect(): Promise<void>;
  call(method: string, input: unknown): Promise<unknown>;
};

/** Reads the gate at send time. A verification connect never receives the write input. */
export async function performMobileCall(input: {
  gate: MobileWriteGate;
  barrier: ResponseBarrier;
  method: string;
  payload: unknown;
  transport: MobileWriteTransport;
  sameComputer: boolean;
}) {
  if (!input.sameComputer) throw Error("电脑已切换，请重试");
  const write = isMobileWrite(input.method);
  const stamp = write ? input.gate.stamp() : 0;
  const token = input.barrier.token();
  if (write && !input.transport.isReady) {
    await input.transport.connect();
    input.gate.ensure(stamp, false);
  }
  if (write) input.gate.ensure(stamp, false);
  const result = await input.transport.call(input.method, input.payload);
  if (!input.barrier.accepts(token)) throw Error("会话已锁定");
  if (write) input.gate.ensure(stamp, true);
  return result;
}
