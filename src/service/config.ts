import { mkdirSync, readFileSync, writeFileSync, lstatSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { KTeamError, fields, record } from '../errors.js';
import { parseJson } from '../protocol/json.js';
import { loopbackUrl, type UpstreamOptions } from '../adapters/upstream.js';

export const CLIENTS = ['kteam-main','xiaok-main'] as const;
export type ClientId = typeof CLIENTS[number];
export interface Config {
  version: 1; brokerUrl: string; kswarmUrl: string;
  brokerTokenFile?: string; kswarmTokenFile?: string;
}
export function dataRoot(): string { return resolve(process.env.KTEAM_DATA_DIR || join(homedir(), '.kteam')); }
export function ensurePrivateRoot(root: string): void {
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const stat = lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(root) !== root) throw new KTeamError('private_directory_required');
  if (process.platform !== 'win32' && (stat.mode & 0o077 || stat.uid !== process.getuid?.())) throw new KTeamError('private_directory_required');
}
export function privateRead(file: string): string {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024) throw new KTeamError('private_file_required');
  if (process.platform !== 'win32' && (stat.mode & 0o077 || stat.uid !== process.getuid?.())) throw new KTeamError('private_file_required');
  return readFileSync(file, 'utf8').trim();
}
export function initConfig(root: string, config: Config): void {
  ensurePrivateRoot(root);
  validateConfig(config);
  // Never replace a previous installation/configuration or client credential.
  writeFileSync(join(root, 'config.json'), JSON.stringify(config, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  for (const client of CLIENTS) {
    writeFileSync(join(root, client + '.token'), randomBytes(32).toString('base64url') + '\n', { flag: 'wx', mode: 0o600 });
  }
}
export function validateConfig(value: unknown): Config {
  const config = record(value);
  fields(config, ['version','brokerUrl','kswarmUrl','brokerTokenFile','kswarmTokenFile']);
  if (config.version !== 1 || typeof config.brokerUrl !== 'string' || typeof config.kswarmUrl !== 'string') throw new KTeamError('config_version_unsupported');
  loopbackUrl(config.brokerUrl); loopbackUrl(config.kswarmUrl);
  for (const key of ['brokerTokenFile','kswarmTokenFile']) if (config[key] !== undefined && (typeof config[key] !== 'string' || !config[key])) throw new KTeamError('invalid_token_reference');
  return config as unknown as Config;
}
export function loadConfig(root: string): Config {
  return validateConfig(parseJson(privateRead(join(root, 'config.json'))));
}
export function upstreamOptions(config: Config): UpstreamOptions {
  return { ...config, brokerToken: config.brokerTokenFile ? privateRead(resolve(config.brokerTokenFile)) : undefined,
    kswarmToken: config.kswarmTokenFile ? privateRead(resolve(config.kswarmTokenFile)) : undefined };
}
export function clientToken(root: string, client: ClientId): string {
  return privateRead(join(root, client + '.token'));
}
export function socketPath(root: string): string {
  if (process.platform === 'win32') throw new KTeamError('windows_host_not_verified');
  const path = join(root, 'host.sock');
  if (Buffer.byteLength(path) > 100) throw new KTeamError('socket_path_too_long');
  return path;
}
