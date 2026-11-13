import { lstatSync, readFileSync } from 'node:fs';
import { dirname, join, sep, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
// Only the hash-checked bundled, argument-free read-only helper below may use this path.
import { spawnSync } from 'node:child_process';
import { machine } from 'node:os';
type WindowsInstallationObservation = 'ordinary' | 'installed' | 'unavailable';
export interface WindowsAbsenceDeps { platform: NodeJS.Platform; arch: string; machine: string; root: string;
    lstat: (path: string) => { isFile(): boolean; isSymbolicLink(): boolean; nlink: number; size: number };
    readFile: (path: string) => Buffer;
    run: (helper: string) => { error?: Error | undefined; status: number | null; signal?: NodeJS.Signals | null; stdout: Buffer };
    warn: (message: string) => void }
/** The missing-helper warning is emitted once per process (it is checked on every profile read). */
let absenceWarned = false;
const defaultAbsenceDeps = (): WindowsAbsenceDeps => {
    const moduleDirectory = dirname(fileURLToPath(import.meta.url));
    // electron-builder explicitly unpacks this fixed native subtree. CLI and
    // Desktop development builds use the same relative tsc output location.
    const root = moduleDirectory.split(sep).map(part => part === 'app.asar' ? 'app.asar.unpacked' : part).join(sep);
    return { platform: process.platform, arch: process.arch, machine: machine(), root, lstat: lstatSync, readFile: path => readFileSync(path),
        run: helper => spawnSync(win32.toNamespacedPath(helper), [], { cwd: win32.toNamespacedPath(dirname(helper)), env: {}, shell: false, windowsHide: true, timeout: 5000, maxBuffer: 4096 }) as any,
        warn: message => { if (absenceWarned) return; absenceWarned = true; process.emitWarning(message, { code: 'windows_absence_helper_not_bundled' }); } };
};
const missingFile = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT';
/** Fixed client-bundled read-only helper. This is not a protected Windows
 * controller or a qualification receipt.
 *
 * KTeam now builds and bundles the original diagnostic source. Absence is therefore
 * an incomplete installation, never evidence that ordinary-mode writes are safe.
 * Anything that is absent or wrong denies fallback ('unavailable'):
 * only one of the two files present, a non-regular/linked/oversized file, a bad manifest, a hash mismatch, a
 * failed or non-zero helper run, or an unexpected answer. */
export function readWindowsInstallationAbsence(): WindowsInstallationObservation {
    if (arguments.length || process.platform !== 'win32')
        return 'unavailable';
    try { return observeWindowsInstallationAbsence(defaultAbsenceDeps()); }
    catch { return 'unavailable'; }
}
export function observeWindowsInstallationAbsence(deps: WindowsAbsenceDeps): WindowsInstallationObservation {
    if (deps.platform !== 'win32' || !['x64', 'arm64'].includes(deps.arch))
        return 'unavailable';
    try {
        const system = deps.machine.toLowerCase();
        const nativeArch = ['amd64', 'x86_64'].includes(system) ? 'x64' : ['arm64', 'aarch64'].includes(system) ? 'arm64' : undefined;
        if (nativeArch !== deps.arch) return 'unavailable';
        const helper = join(deps.root, 'native', 'win32-' + deps.arch, 'windows-installation-absence.exe'), manifestPath = join(deps.root, 'native', 'win32-' + deps.arch, 'windows-installation-absence.json');
        const present = (path: string) => { try { deps.lstat(path); return true; } catch (error) { if (missingFile(error)) return false; throw error; } };
        const helperPresent = present(helper), manifestPresent = present(manifestPath);
        if (!helperPresent && !manifestPresent) {
            deps.warn('windows_absence_helper_not_bundled: windows-installation-absence helper is not bundled (' + helper + '); writes remain unavailable (see https://github.com/kaisersong/KTeam/issues/74)');
            return 'unavailable';
        }
        function read(path: string, limit: number): Buffer { const s = deps.lstat(path); if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || s.size > limit)
            throw Error('windows_absence_file'); const b = deps.readFile(path); if (b.length > limit)
            throw Error('windows_absence_file'); return b; }
        const manifestBytes = read(manifestPath, 4096), manifest = JSON.parse(manifestBytes.toString('utf8'));
        if (!manifest || Object.keys(manifest).sort().join(',') !== 'coreSha256,sha256,sourceSha256,target,version' || manifest.version !== 1 || manifest.target !== 'win32-' + deps.arch || !['sourceSha256', 'coreSha256'].every(key => typeof manifest[key] === 'string' && /^[a-f0-9]{64}$/.test(manifest[key])) || typeof manifest.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(manifest.sha256))
            return 'unavailable';
        function helperCurrent(): void { if (!read(manifestPath, 4096).equals(manifestBytes) || createHash('sha256').update(read(helper, 2 * 1024 ** 2)).digest('hex') !== manifest.sha256)
            throw Error('windows_absence_changed'); }
        helperCurrent();
        const result = deps.run(helper);
        if (result.error || result.status !== 0 || result.signal)
            return 'unavailable';
        helperCurrent();
        const answer = JSON.parse(result.stdout.toString('utf8'));
        if (!answer || Object.keys(answer).sort().join(',') !== 'kind,version' || answer.version !== 1 || !['ordinary', 'installed', 'unavailable'].includes(answer.kind))
            return 'unavailable';
        return answer.kind;
    }
    catch {
        return 'unavailable';
    }
}
