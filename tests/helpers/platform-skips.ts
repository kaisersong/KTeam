/**
 * Windows-only skips, each naming the exact dependency that is missing on Windows so it can be traced to the
 * Windows CI log. macOS/Linux never skip.
 *
 * KSwarm (pinned in sources.lock.json, 5c64da7) resolves an external Agent CLI in src/core/agent-store.js
 * `_which()`: it runs `/usr/bin/which <path> 2>/dev/null` and accepts only a result that starts with '/'. On
 * Windows both fail silently (the error is swallowed), so POST /agents with runtimeType 'codex' answers
 * 400 `runtime_unavailable:codex`, which KTeam's coordinator records as `operation_result_unknown` at
 * coordination.js stage `member:N`. The canary test in agent-links.integration.test.ts asserts exactly this, so
 * the skip is removed as soon as the pinned KSwarm can detect Windows CLIs.
 */
export const KSWARM_WHICH_ON_WINDOWS=process.platform==='win32'?'KSwarm 上游已知限制（5c64da7 src/core/agent-store.js _which: /usr/bin/which + startsWith("/")），Windows 上无法识别外部 Agent CLI；见同文件 canary 用例':false;
