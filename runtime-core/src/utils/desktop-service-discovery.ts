import { createServer } from 'node:net';
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export interface DesktopServicePorts { broker: number; kswarm: number }

/** KTeam's own service discovery file (0600, under KTeam's data dir). The desktop writes the ports it
 * actually bound; CLI and clients read them. Never a fixed port shared with another product. */
export function desktopServiceDiscoveryFile(): string {
  return process.env.KTEAM_DESKTOP_DISCOVERY_FILE ?? join(process.env.KTEAM_DATA_DIR ?? join(homedir(), '.kteam'), 'service-endpoints.json');
}
function configuredPort(value: string | undefined, name: string): number {
  if (value === undefined) return 0;
  const port = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error(`${name} must be a port between 1 and 65535`);
  return port;
}
/** Explicit KTeam overrides only; 0 means "let the OS pick a free loopback port". */
export function configuredDesktopServicePorts(env: NodeJS.ProcessEnv = process.env): DesktopServicePorts {
  return { broker: configuredPort(env.KTEAM_DESKTOP_PORT, 'KTEAM_DESKTOP_PORT'),
    kswarm: configuredPort(env.KTEAM_KSWARM_PORT, 'KTEAM_KSWARM_PORT') };
}
async function bindPort(port: number) {
  const server = createServer();
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen({ port, host: '127.0.0.1', exclusive: true }, resolve); });
    return server;
  } catch (error) {
    server.close();
    throw error;
  }
}
/** Hold both probes until selected, so the two endpoints cannot select the same port.
 * Sidecars accept port numbers rather than inherited sockets; a later bind race is
 * reported by startup health/identity checks or timeout, never by killing an unknown listener. */
export async function prepareDesktopServicePorts(file = desktopServiceDiscoveryFile(), env: NodeJS.ProcessEnv = process.env): Promise<DesktopServicePorts> {
  const requested = configuredDesktopServicePorts(env);
  const held: Awaited<ReturnType<typeof bindPort>>[] = [];
  try {
    const selected = {} as DesktopServicePorts;
    for (const name of ['broker', 'kswarm'] as const) {
      let server;
      if (!requested[name]) server = await bindPort(0);
      else try { server = await bindPort(requested[name]); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
        server = await bindPort(0);
      }
      held.push(server);
      selected[name] = (server.address() as { port: number }).port;
    }
    writeDesktopServicePorts(file, selected);
    return selected;
  } catch (error) {
    throw new Error(`Desktop service port setup failed: ${(error as Error).message}`);
  } finally {
    await Promise.all(held.map(server => new Promise<void>(resolve => server.close(() => resolve()))));
  }
}
export function writeDesktopServicePorts(file: string, ports: DesktopServicePorts): void {
  validPorts(ports, 'ports');
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify({ broker: ports.broker, kswarm: ports.kswarm }), { mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, file);
}
function validPorts(value: DesktopServicePorts, label: string): DesktopServicePorts {
  for (const name of ['broker', 'kswarm'] as const) {
    if (typeof value?.[name] !== 'number') throw new Error(`${label}.${name} must be a number`);
    if (!configuredPort(String(value[name]), `${label}.${name}`)) throw new Error(`${label}.${name} must be a port between 1 and 65535`);
  }
  if (value.broker === value.kswarm) throw new Error(`${label} ports must be distinct`);
  return { broker: Number(value.broker), kswarm: Number(value.kswarm) };
}
export function readDesktopServicePorts(file = desktopServiceDiscoveryFile()): DesktopServicePorts {
  const fact = lstatSync(file);
  if (!fact.isFile() || fact.isSymbolicLink() || (process.platform !== 'win32' && (fact.mode & 0o077) !== 0)) throw new Error('discovery file must be a private regular file');
  return validPorts(JSON.parse(readFileSync(file, 'utf8')) as DesktopServicePorts, 'discovery');
}
export function desktopServiceUrl(name: keyof DesktopServicePorts, file = desktopServiceDiscoveryFile()): string {
  // Explicit KTeam overrides win; otherwise only the ports KTeam's desktop actually bound.
  const override = name === 'broker' ? process.env.KTEAM_BROKER_URL : process.env.KTEAM_KSWARM_URL;
  if (override) return override.replace(/\/$/, '');
  const configured = configuredDesktopServicePorts()[name];
  if (configured) return `http://127.0.0.1:${configured}`;
  if (!existsSync(file)) throw new Error('desktop_service_discovery_missing');
  return `http://127.0.0.1:${readDesktopServicePorts(file)[name]}`;
}
