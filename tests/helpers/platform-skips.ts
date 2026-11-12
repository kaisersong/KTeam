/** Windows-only deferrals, each with the reason shown in the test report. macOS/Linux never skip. */
export const LOCAL_AGENTS_DEFERRED_ON_WINDOWS=process.platform==='win32'?'0.5: 本机 Agent CLI 的发现与运行在 Windows 推迟（KSwarm 上游只用 /usr/bin/which 检测，测试 CLI 是 sh 脚本）':false;
