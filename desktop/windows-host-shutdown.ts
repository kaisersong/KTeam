/**
 * Windows-only stop of the detached desktop host tree before quit or NSIS
 * quitAndInstall. macOS must never call these helpers for quit or update;
 * the host stays detached there so work can continue in the background
 * (including the 0.3.1 → 0.4 Mac update path).
 *
 * Uses the PR2 process layer (PowerShell CIM census, processBirth-style
 * CreationDate, taskkill) but never taskkill /T: each verified member is
 * stopped with /F /PID. A child's CreationDate must be >= its parent's
 * (FILETIME 100ns ticks). If the leader's birth does not match the
 * recorded value, the pid was reused and is not killed.
 */
import {powershellPath,taskkillPath,type PlatformDeps} from '../src/runtime/platform-process.js';

export const HOST_STOP_TIMEOUT_MS = 4_000;
export const WINDOWS_HOST_PROCESS_TABLE = "Get-CimInstance -ClassName Win32_Process -Property ProcessId,ParentProcessId,CreationDate,Name | Where-Object { $_.ProcessId -ne $PID -and $_.Name -ne 'conhost.exe' } | ForEach-Object { [string]$_.ProcessId + ' ' + [string]$_.ParentProcessId + ' ' + $(if ($_.CreationDate) { [string]$_.CreationDate.ToFileTimeUtc() } else { '0' }) }";

export interface WindowsHostIdentity { pid: number; birth: string }
export interface WindowsHostProcessLayer {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  exec: PlatformDeps['exec'];
  spawnSync: PlatformDeps['spawnSync'];
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
  log?: (event: string, diagnostic?: string) => void;
}
export interface VerifiedMember { pid: number; birth: string }
export interface SkippedMember { pid: number; reason: string }
export interface HostStopResult { ok: boolean; killed: number[]; skipped: SkippedMember[]; error?: string }

const windowsCensus = {encoding:'utf8' as const,timeout:20000,maxBuffer:16*1024*1024,windowsHide:true,stdio:['ignore','pipe','pipe']};

export function filetimeTicks(value: string | undefined): bigint | undefined {
  if (!value || !/^\d+$/.test(value) || value === '0') return undefined;
  return BigInt(value);
}

/** Record the host's CreationDate as UTC FILETIME ticks. Empty when the process is already gone. */
export function captureWindowsHostIdentity(pid: number, layer: WindowsHostProcessLayer): WindowsHostIdentity | undefined {
  if (layer.platform !== 'win32') return undefined;
  if (!Number.isSafeInteger(pid) || pid <= 0) return undefined;
  const birth = windowsBirth(pid, layer);
  if (!birth) return undefined;
  return { pid, birth };
}

export function parseVerifiedHostTree(text: string, identity: WindowsHostIdentity, onMismatch?: (message: string) => void): { verified: VerifiedMember[]; skipped: SkippedMember[] } {
  const children = new Map<number, number[]>();
  const birthOf = new Map<number, string>();
  const alive = new Set<number>();
  for (const line of text.split(/\r?\n/)) {
    const [a, b, c] = line.trim().split(/\s+/);
    const pid = Number(a), ppid = Number(b);
    if (!Number.isInteger(pid) || !Number.isInteger(ppid) || !a || !b) continue;
    alive.add(pid);
    if (c && /^\d+$/.test(c)) birthOf.set(pid, c);
    if (pid === ppid) continue;
    children.set(ppid, [...(children.get(ppid) ?? []), pid]);
  }
  const recorded = filetimeTicks(identity.birth);
  const rootNow = filetimeTicks(birthOf.get(identity.pid));
  const rootAlive = alive.has(identity.pid);
  const reused = rootAlive && recorded !== undefined && rootNow !== recorded;
  const skipped: SkippedMember[] = [];
  if (reused) {
    const message = `process ${identity.pid} was started at ${birthOf.get(identity.pid) ?? 'unknown'}, not at the recorded ${identity.birth}; it is not KTeam's and will not be stopped`;
    onMismatch?.(message);
    skipped.push({ pid: identity.pid, reason: 'pid_reused' });
  }
  const verified: VerifiedMember[] = [];
  if (rootAlive && !reused && birthOf.has(identity.pid)) verified.push({ pid: identity.pid, birth: birthOf.get(identity.pid)! });
  const from = recorded ?? (rootAlive ? rootNow : undefined);
  const until = reused ? rootNow : undefined;
  const queue = [identity.pid];
  const seen = new Set<number>([identity.pid]);
  while (queue.length) {
    const parent = queue.shift()!;
    // For a reused leader, orphans are dated against the recorded birth, not the stranger now living at that pid.
    const parentBirth = parent === identity.pid ? from : filetimeTicks(birthOf.get(parent));
    for (const pid of children.get(parent) ?? []) {
      if (seen.has(pid)) continue;
      seen.add(pid);
      const childBirth = filetimeTicks(birthOf.get(pid));
      if (childBirth === undefined) {
        skipped.push({ pid, reason: 'birth_missing' });
        continue;
      }
      if (parentBirth !== undefined && childBirth < parentBirth) {
        skipped.push({ pid, reason: 'birth_before_parent' });
        continue;
      }
      if (from !== undefined && childBirth < from) {
        skipped.push({ pid, reason: 'birth_before_root' });
        continue;
      }
      if (until !== undefined && childBirth >= until) {
        skipped.push({ pid, reason: 'belongs_to_reused_pid' });
        continue;
      }
      verified.push({ pid, birth: birthOf.get(pid)! });
      queue.push(pid);
    }
  }
  return { verified, skipped };
}

export async function stopWindowsHostTree(identity: WindowsHostIdentity | undefined, layer: WindowsHostProcessLayer, options: { timeoutMs?: number } = {}): Promise<HostStopResult> {
  if (layer.platform !== 'win32') return { ok: true, killed: [], skipped: [] };
  if (!identity) return { ok: true, killed: [], skipped: [] };
  const log = layer.log ?? (() => {});
  const now = layer.now ?? Date.now;
  const wait = layer.wait ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const timeoutMs = options.timeoutMs ?? HOST_STOP_TIMEOUT_MS;
  try {
    const census = readCensus(layer);
    const listed = parseVerifiedHostTree(census, identity, message => log('host-stop-mismatch', message));
    for (const skipped of listed.skipped) log('host-stop-skipped', `${skipped.pid} ${skipped.reason}`);
    const killed: number[] = [];
    // Descendants first, leader last, each with /F /PID and never /T.
    const ordered = [...listed.verified.filter(m => m.pid !== identity.pid), ...listed.verified.filter(m => m.pid === identity.pid)];
    for (const member of ordered) {
      const result = layer.spawnSync(taskkillPath(layer.env), ['/F', '/PID', String(member.pid)], { stdio: 'ignore', windowsHide: true, timeout: 20000 });
      if (result.error) {
        const error = result.error.message;
        log('host-stop-failed', error);
        return { ok: false, killed, skipped: listed.skipped, error };
      }
      killed.push(member.pid);
    }
    const deadline = now() + timeoutMs;
    while (now() < deadline) {
      const remaining = parseVerifiedHostTree(readCensus(layer), identity).verified;
      if (!remaining.length) return { ok: true, killed, skipped: listed.skipped };
      await wait(Math.min(150, Math.max(0, deadline - now())));
    }
    const leftover = parseVerifiedHostTree(readCensus(layer), identity).verified;
    if (!leftover.length) return { ok: true, killed, skipped: listed.skipped };
    const error = `host still running after ${timeoutMs}ms: ${leftover.map(m => m.pid).join(',')}`;
    log('host-stop-failed', error);
    return { ok: false, killed, skipped: listed.skipped, error };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('host-stop-failed', message);
    return { ok: false, killed: [], skipped: [], error: message };
  }
}

function windowsBirth(pid: number, layer: WindowsHostProcessLayer): string {
  const script = `$p = Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = ${pid}"; if ($p -and $p.CreationDate) { [string]$p.CreationDate.ToFileTimeUtc() }`;
  return layer.exec(powershellPath(layer.env), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], windowsCensus).trim();
}

function readCensus(layer: WindowsHostProcessLayer): string {
  return layer.exec(powershellPath(layer.env), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', WINDOWS_HOST_PROCESS_TABLE], windowsCensus);
}
