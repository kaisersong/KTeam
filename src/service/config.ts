import {assertWindowsPrivate,assertWindowsPrivateMany} from './windows-security.js';
import { mkdirSync, readFileSync, writeFileSync, lstatSync, realpathSync,existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { KTeamError, fields, record } from '../errors.js';
import { parseJson } from '../protocol/json.js';
import { loopbackUrl, type UpstreamOptions } from '../adapters/upstream.js';

export const CLIENTS = ['kteam-main','kteam-companion'] as const;
export type ClientId = typeof CLIENTS[number];
export interface Config {
  version: 1; brokerUrl: string; kswarmUrl: string;
  brokerTokenFile?: string; kswarmTokenFile?: string;
  managedServiceConfig?:string;
}
export function dataRoot(): string { return resolve(process.env.KTEAM_DATA_DIR || join(homedir(), '.kteam')); }
export function ensurePrivateRoot(root: string): void {
  if(process.platform==='win32')assertWindowsPrivate(root,true,true);
  else mkdirSync(root, { recursive: true, mode: 0o700 });
  const stat = lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(root) !== root) throw new KTeamError('private_directory_required');
  if (process.platform !== 'win32' && (stat.mode & 0o077 || stat.uid !== process.getuid?.())) throw new KTeamError('private_directory_required');
}
export function privateRead(file: string): string {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024) throw new KTeamError('private_file_required');
  if (process.platform !== 'win32' && (stat.mode & 0o077 || stat.uid !== process.getuid?.())) throw new KTeamError('private_file_required');
  if(process.platform==='win32')assertWindowsPrivate(file,false);
  return readFileSync(file, 'utf8').trim();
}
export function initConfig(root: string, config: Config): void {
  ensurePrivateRoot(root);
  validateConfig(config);
  // Never replace a previous installation/configuration or client credential.
  writeFileSync(join(root, 'config.json'), JSON.stringify(config, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  for (const client of CLIENTS) {
    if(existsSync(join(root,client+'.token'))){clientToken(root,client);continue;}
    writeFileSync(join(root, client + '.token'), randomBytes(32).toString('base64url') + '\n', { flag: 'wx', mode: 0o600 });
  }
}
const CONFIG_KEYS=['version','brokerUrl','kswarmUrl','brokerTokenFile','kswarmTokenFile','managedServiceConfig'];
export function validateConfig(value: unknown): Config {
  const config = record(value);
  fields(config, CONFIG_KEYS);
  if (config.version !== 1 || typeof config.brokerUrl !== 'string' || typeof config.kswarmUrl !== 'string') throw new KTeamError('config_version_unsupported');
  loopbackUrl(config.brokerUrl); loopbackUrl(config.kswarmUrl);
  for (const key of ['brokerTokenFile','kswarmTokenFile','managedServiceConfig']) if (config[key] !== undefined && (typeof config[key] !== 'string' || !config[key])) throw new KTeamError('invalid_token_reference');
  return config as unknown as Config;
}
let legacyWarned=false;
/** Keys an older KTeam wrote but this version no longer uses are ignored (never read, never followed),
 * with one warning per process. New configs are still validated strictly by initConfig. */
function dropLegacyKeys(value: unknown): unknown {
  const config = record(value), legacy = Object.keys(config).filter(key => !CONFIG_KEYS.includes(key));
  if (!legacy.length) return config;
  if (!legacyWarned) { legacyWarned = true; process.emitWarning(`KTeam config.json: ignoring ${legacy.length} legacy key(s) no longer used: ${legacy.slice(0, 8).map(key => JSON.stringify(key.slice(0, 64))).join(', ')}`, { code: 'KTEAM_CONFIG_LEGACY_KEYS' }); }
  return Object.fromEntries(Object.entries(config).filter(([key]) => CONFIG_KEYS.includes(key)));
}
const warmedWindowsRoots=new Set<string>();
function warmWindowsRoot(root:string){
 if(process.platform!=='win32')return;
 const files=['config.json',...CLIENTS.map(client=>client+'.token'),'host-endpoint.json'].map(name=>join(root,name)).filter(existsSync);
 // ensurePrivateRoot enforces root ACLs at ownership boundaries. Clients validate their root once;
 // per-file NTFS metadata still invalidates credentials/endpoint checks without treating every SQLite journal as an ACL change.
 assertWindowsPrivateMany([...(warmedWindowsRoots.has(root)?[]:[{path:root,directory:true}]),...files.map(path=>({path,directory:false}))]);
 warmedWindowsRoots.add(root);
}
export function loadConfig(root: string): Config {
 warmWindowsRoot(root);
  return validateConfig(dropLegacyKeys(parseJson(privateRead(join(root, 'config.json')))));
}
export function upstreamOptions(config: Config): UpstreamOptions {
  return { ...config, brokerToken: config.brokerTokenFile ? privateRead(resolve(config.brokerTokenFile)) : undefined,
    kswarmToken: config.kswarmTokenFile ? privateRead(resolve(config.kswarmTokenFile)) : undefined };
}
export function clientToken(root: string, client: ClientId): string {
  warmWindowsRoot(root);
  return privateRead(join(root, client + '.token'));
}
export function socketPath(root: string): string {
  if (process.platform === 'win32') throw new KTeamError('windows_host_not_verified');
  const path = join(root, 'host.sock');
  if (Buffer.byteLength(path) > 100) throw new KTeamError('socket_path_too_long');
  return path;
}
