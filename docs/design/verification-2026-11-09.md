# KTeam 首批基础代码验证

范围：P0a 基础切片；macOS kmm 本机。未安装正式桌面包，未接入 kai-mbp 的用户会话。

| 验证 | 实际结果 |
|---|---|
| `npm ci` | 完成，依赖审计 0 漏洞 |
| `npm run check` / Node 24.16.0 | 源码锁定检查、8 组测试、独立 CLI 冒烟通过 |
| Node 22.22.0 执行 TypeScript 构建 | 通过 |
| Node 22.22.0 执行 `node --preserve-symlinks --test dist/tests/*.test.js` | 8/8 通过，无跳过 |
| Node 22.22.0 执行 `node scripts/smoke-cli.mjs` | 并发 host 拒绝、崩溃接替、doctor、正常退出通过 |
| AIMP 3.1 原始测试向量 | intent / record / system / approval 四组规范化字节、摘要及 Ed25519 签名相符 |
| 真实 KSwarm + intent-broker 联调 | 同名册、同 Room、幂等建群、消息原文、重复回执、异意图冲突、引用回复、重启恢复及上游断连拒写通过 |
| 进程回收 | 联调测试断言真实 KSwarm 子进程已退出；CLI 冒烟记录本次残留 0 |

测试仅使用自有夹具、临时 HOME/数据库/端口与记录的子进程。不连接既有生产服务，不调用模型，不发送真实 IM/日程，也不把固定讨论文本当作 Agent 已执行任务的证据。

本机验证后的 KSwarm / intent-broker 工作树保持干净；xiaok 已存在的 renderer WIP 未改动。源码 revision 与抽取文件完整哈希见 `sources.lock.json`。CI 工作流已经配置，尚无 GitHub CI 运行结果；Linux/Windows、正式安装、完整 AIMP profile、外部 Agent 探针及 P0b/P0c 未验收。
