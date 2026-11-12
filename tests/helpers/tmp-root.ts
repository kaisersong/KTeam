import {tmpdir} from 'node:os';
/** Temp root for tests: unchanged /tmp on macOS/Linux (short unix socket paths), the user temp dir on Windows. */
export const tmpRoot=process.platform==='win32'?tmpdir():'/tmp';
