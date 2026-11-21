import {readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {parse} from 'smol-toml';
import {KTeamError} from '../errors.js';

const profile = 'kteam-scoped';
const override = (key: string, value: string) => ['-c', `${key}=${value}`];
const literal = (value: string) => JSON.stringify(value);

export function codexPolicy(cwd: string, writeRoot?: string) {
 const filesystem = writeRoot
  ? `":minimal"="read",${literal(writeRoot)}="write"`
  : `":minimal"="read",${literal(cwd)}="read"`;
 return [
  ...override('default_permissions', literal(profile)),
  // Codex otherwise adds both temp roots as writable on this platform.
  ...override(`permissions.${profile}.filesystem`, `{${filesystem},":slash_tmp"="none",":tmpdir"="none"}`),
  ...override(`permissions.${profile}.network.enabled`, 'false'),
  ...override('approval_policy', '"never"'),
  ...override('web_search', '"disabled"'),
  ...override('mcp_servers', '{}'),
  ...override('projects', '{}'),
  ...override('shell_environment_policy.inherit', '"none"'),
  ...override('shell_environment_policy.set', `{PATH=${literal(process.platform === 'win32' ? (process.env.SystemRoot ?? 'C:\\Windows') + '\\System32' : '/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin')}}`),
  ...['hooks','apps','plugins','remote_plugin','plugin_discovery_prefetch','shell_snapshot','image_generation'].flatMap(feature => override(`features.${feature}`, 'false')),
 ];
}

export function codexConnection(env: NodeJS.ProcessEnv) {
 const file = join(env.CODEX_HOME ?? join(homedir(), '.codex'), 'config.toml');
 let config: any = {};
 try { config = parse(readFileSync(file, 'utf8')); }
 catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new KTeamError('native_codex_config_unavailable', 409); }
 const args: string[] = [];
 for (const key of ['model','cli_auth_credentials_store']) {
  if (typeof config[key] === 'string') args.push(...override(key, literal(config[key])));
 }
 const provider = config.model_provider;
 if (provider && provider !== 'openai') {
  const model = config.model_providers?.[provider];
  if (!/^[A-Za-z0-9_-]+$/.test(provider) || !model || Object.keys(model).some(key => !['name','base_url','wire_api','env_key','requires_openai_auth','supports_websockets','request_max_retries','stream_max_retries','stream_idle_timeout_ms'].includes(key))) {
   throw new KTeamError('native_codex_provider_unsupported', 409);
  }
  args.push(...override('model_provider', literal(provider)));
  for (const [key,value] of Object.entries(model)) {
   if (key === 'supports_websockets' ? typeof value !== 'boolean' : !['string','boolean','number'].includes(typeof value)) throw new KTeamError('native_codex_provider_unsupported', 409);
   if (key === 'base_url') {
    let url: URL;
    try {url=new URL(String(value));} catch {throw new KTeamError('native_codex_provider_unsupported',409);}
    if (url.username || url.password || url.search || url.hash || !['http:','https:'].includes(url.protocol)) throw new KTeamError('native_codex_provider_unsupported', 409);
   }
   if (key === 'env_key' && typeof value === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value) && process.env[value]) env[value] = process.env[value];
   args.push(...override(`model_providers.${provider}.${key}`, JSON.stringify(value)));
  }
 }
 if (process.env.OPENAI_API_KEY) env.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
 return args;
}

export function codexTaskArgs(cwd: string, prompt: string, env: NodeJS.ProcessEnv, writeRoot?: string) {
 if (writeRoot && process.platform !== 'darwin') throw new KTeamError('native_codex_write_sandbox_unavailable',409);
 return ['exec','--strict-config','--ignore-user-config','--ignore-rules','--ephemeral','--json','--skip-git-repo-check',...codexConnection(env),...codexPolicy(cwd,writeRoot),'--',prompt];
}

const filesystemDenial = /\b(?:operation not permitted|permission denied|read-only file system)\b/i;

export function codexWriteDenied(tools: unknown[] = [], report = '') {
 return filesystemDenial.test(report) || tools.some(tool => {
  const item = tool as {type?: string; exit_code?: number; aggregated_output?: string; status?: string};
  return item.type === 'command_execution' && item.exit_code !== 0 && filesystemDenial.test(item.aggregated_output ?? '');
 });
}
