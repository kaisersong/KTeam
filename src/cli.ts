#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { dataRoot, initConfig, loadConfig, upstreamOptions } from './service/config.js';
import { startHost } from './service/server.js';
import { hostRequest } from './service/client.js';
import { LOCAL_HUMAN } from './service/collaboration.js';
import { KTeamError } from './errors.js';
import { discoveredServiceUrls } from './service/service-endpoints.js';

const help = `KTeam 0.1 开发版 — 组建你的 AI 团队，让工作主动向前。

kteam init                          初始化专用目录与两个客户端凭据
kteam start                         前台启动共享 host（关闭客户端不影响 host）
kteam status | doctor                版本握手、owner 与上游健康
kteam bots | runtimes | teams        读取现有 Agent、运行时与团队
kteam team-create --title 名称 --goal 目标 --members agent1,agent2 --id 请求ID
kteam send --room 房间ID --text 正文 [--id msg_加32位hex] [--thread 线程ID]
kteam history --room 房间ID [--after 0] [--limit 50]

KTEAM_DATA_DIR 指定专用目录（默认 ~/.kteam）。init 可读取以下配置引用：
KTEAM_BROKER_URL / KTEAM_KSWARM_URL（仅允许 loopback；未设置时读取桌面端写入的 service-endpoints.json）；
KTEAM_BROKER_TOKEN_FILE / KTEAM_KSWARM_TOKEN_FILE（凭据文件，不是明文 key）。
当前为 P0a 协议基础切片，尚无桌面 UI、自动 Bot 回复或任务执行。`;

function args(values: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < values.length; i += 2) {
    const key = values[i], value = values[i + 1];
    if (!key?.startsWith('--') || value === undefined || Object.hasOwn(result, key.slice(2))) throw new KTeamError('invalid_arguments');
    result[key.slice(2)] = value;
  }
  return result;
}
function required(input: Record<string, string>, key: string): string {
  if (!input[key]) throw new KTeamError('missing_' + key);
  return input[key]!;
}
async function main() {
  const [command = 'help', ...rest] = process.argv.slice(2);
  const root = dataRoot();
  const print = (value: unknown) => process.stdout.write(JSON.stringify(value, null, 2) + '\n');
  if (['help','--help','-h'].includes(command)) { process.stdout.write(help + '\n'); return; }
  const input = args(rest);
  if (command === 'init') {
    // No fixed default port: use KTEAM_*_URL, else the ports KTeam's desktop recorded in its discovery file.
    initConfig(root, { version: 1, ...discoveredServiceUrls(root),
      ...(process.env.KTEAM_BROKER_TOKEN_FILE ? { brokerTokenFile: process.env.KTEAM_BROKER_TOKEN_FILE } : {}),
      ...(process.env.KTEAM_KSWARM_TOKEN_FILE ? { kswarmTokenFile: process.env.KTEAM_KSWARM_TOKEN_FILE } : {}) });
    print({ ok: true, dataRoot: root, next: 'kteam start', backgroundAutostartInstalled: false }); return;
  }
  if (command === 'start') {
    const host = await startHost({ root, upstream: upstreamOptions(loadConfig(root)) });
    print({ ok: true, product: 'KTeam', socket: host.path, ownerEpoch: host.epoch, pid: process.pid });
    let closing = false;
    const close = () => {
      if (closing) return; closing = true;
      void host.close().catch(() => { process.exitCode = 1; });
    };
    process.once('SIGINT', close); process.once('SIGTERM', close); return;
  }
  const request = (route: string, value?: unknown) => hostRequest(root, 'kteam-main', route, value);
  if (command === 'doctor') {
    const handshake = await request('/v1/handshake');
    const status = await request('/v1/status');
    print({ handshake, status }); return;
  }
  if (['status','bots','runtimes','teams'].includes(command)) { print(await request('/v1/' + command)); return; }
  if (command === 'team-create') {
    print(await request('/v1/teams', { title: required(input, 'title'), goal: required(input, 'goal'),
      memberAgentIds: required(input, 'members').split(','), requestId: required(input, 'id') })); return;
  }
  if (command === 'send') {
    const id = input.id || 'msg_' + randomBytes(16).toString('hex');
    const room = required(input, 'room');
    try {
      print(await request('/v1/messages', { aimp: '1.0', id, room_id: room,
        thread_id: input.thread || 'thread-' + room, from: LOCAL_HUMAN, to: [], mentions: [],
        ts: new Date().toISOString(), act: 'chat', source_level: 'principal', classification: 'internal', body: required(input, 'text') }));
    } catch (error) {
      process.stderr.write(JSON.stringify({ messageId: id, instruction: '结果不确定时，请复用此 --id 和原正文查询/重试；不要生成新 ID。' }) + '\n');
      throw error;
    }
    return;
  }
  if (command === 'history') {
    print(await request(`/v1/teams/${encodeURIComponent(required(input, 'room'))}/messages?after=${encodeURIComponent(input.after || '0')}&limit=${encodeURIComponent(input.limit || '50')}`)); return;
  }
  throw new KTeamError('unknown_command');
}
main().catch(error => {
  const code = error instanceof KTeamError ? error.code : (error as NodeJS.ErrnoException).code || 'unexpected_error';
  process.stderr.write(JSON.stringify({ ok: false, code }) + '\n');
  process.exitCode = 1;
});
