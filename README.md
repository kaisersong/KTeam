# KTeam

**组建你的 AI 团队，让工作主动向前。**

KTeam 是独立的多 Bot 协作桌面应用，按[产品设计](docs/design/product-design-v5.md)分阶段实现。

当前 **0.1.0-preview.3** 可验证：按名字创建长期成员、复用小K模型、建立目标群组、自然语言自动选择相关成员（包括不回应）、后台完成多成员讨论、会话内答复、组队方案卡片和单成员私聊、用户验收、暂停/继续、历史分页与崩溃核对。窗口关闭后后台工作继续，未安装开机启动项。

这仍是讨论型预览版，**完整 v5 尚未交付**。全量原生 Agent 执行审批准入、全源定时主动巡检、跨 Bot 执行接力、完整 AIMP Core-L2 认证尚未开放。Codex 的权限初探不能代替完整能力资格；界面明确当前工作范围。不将讨论答复说成已执行实际业务操作。

## 桌面验证

macOS arm64，应用包为 `release/mac-arm64/KTeam.app`。先在小K中配置可用模型与共享服务，再打开 KTeam：

1. 首次打开按引导创建 Bot 或接入已有 Agent。进入助理会话后，例如“帮我组一个经营复盘团队，CEO 和 CTO 一起列出本周资料缺口”。
2. 检查方案里的目标和成员，点击“创建团队”，进入真实群聊；确认目标后再开始讨论。
3. 左上“＋”也可只填名字创建成员并直接开聊，或邀请已有成员建群；模型选择折叠在更多设置里。
4. 点击会话标题查看成员、目标、运行记录与验收；左侧收件箱保留待确认方案、创建恢复和工作问题。
5. 暂停会停止当前工作并保留未开工消息；继续只释放未开工消息。停止或结果未知的回合不自动重放。

预览版复用本机 `~/.xiaok/desktop/activity-owner.config.json` 的私有凭据引用与服务 owner，由原 owner 启动共享服务，不另开一套名册/群转录。配套 broker 版本见 [sources.lock.json](sources.lock.json)，旧服务需要配套升级。模型身份变化会使原绑定失效；不静默换模型。共享服务暂不可用时会显示连接错误。

## 来源与状态所有权

- `vendor/xiaok-runtime` 是锁定源码的最小依赖闭包，原样保留 AgentRuntime、模型适配器、ToolRegistry、兼容凭据加载链及活动 owner 客户端。303 个文件各有来源路径与 SHA-256；构建不依赖开发机临时 worktree。见 [NOTICE](NOTICE)。
- KSwarm 是 Agent/项目唯一 owner；intent-broker 是 Room/成员/群消息唯一 owner。KTeam 保存执行绑定、设置、工作队列、预算、稀疏已读、发送 outbox，以及冻结提案/创建阶段和收据；不复制原服务名册或群消息。
- broker 持有实验性讨论任务链、签名定序、准入 epoch/lease、交付字节验证；自然语言不能授予权限。人工验收在独立字节核验之后。
- host 使用私有 Unix socket、独立客户端 token、API/schema 握手与 SQLite OS 锁。未知 POST 只核对事实，不自动重发或重新调用模型。每条消息最多 6 次模型请求，全局每天最多 20 次，路由及 SDK 重试都计入。
- renderer 只使用白名单语义 IPC，不能读取凭据或调用任意文件/命令/HTTP。Markdown 不执行 HTML，也不把文件路径或图片变成权限。

## 构建和检查

需要 Node >=22.22.0，桌面打包当前验证 macOS arm64。同级放置 `kswarm`、`intent-broker` 和 `mydocs`，版本由 sources.lock 锁定。

```sh
npm ci --ignore-scripts
npm run check
npm run pack:desktop
```

集成测试使用真实隔离服务、专属临时数据库与随机 loopback 端口，并回收记录的 PID；控制器异常测试明确使用推理 fixture，另有真实模型与正式安装包验证。不会用 mock 代替本地 Agent 资格探针。Electron 下载由校验和验证后解压，本地包不签名、不发布。

文档实体位于同级 `mydocs/kteam/`，项目 `docs -> ../mydocs/kteam`，不建立第二份实体目录。

## CLI

```sh
node dist/src/cli.js --help
node dist/src/cli.js doctor
node dist/src/cli.js bots
node dist/src/cli.js teams
```

也可显式设置 `KTEAM_DATA_DIR`、`KTEAM_BROKER_TOKEN_FILE`、`KTEAM_KSWARM_TOKEN_FILE` 后 `init` / `start`；不要把凭据放入命令参数或 Git。

## AIMP

[规范 3.1](docs/reference/aimp-design-spec-v3.1.md)的信封仍为 `aimp: "1.0"`。已验证官方四域签名向量、安全整数 JCS 子集、重复键/非法 Unicode 拒绝，并接通 broker 实验性讨论生命周期。

**不声明完整 AIMP/Core-L2 兼容**。生产身份根、收据激活、完整规范状态迁移、执行副作用等首发门槛仍需完成。见[实施计划](docs/design/implementation-plan.md)。

## Bot 创建与原 Agent 接入

首次打开会引导创建具名 Bot 或接入正在使用的 xiaok / Codex / Kimi / ZCode 会话。Bot 设置分为“属性与主动性”和“Agent”：可配置职责、背景、相关时参与或仅点名、授权资料目录、一次性跟进，以及系统模型或原会话来源。接入先复制指令，再核对确认码；仅凭邀请编号不能收发消息。原会话按随包 `kteam-collaboration` Skill 持续 listen / reply，退出原会话后不声称后台在线。

建群与开始工作分开：先建群，再由用户明确确认目标。系统 Agent 复用 xiaok 运行器和只读资料工具，文件修改和命令执行沿用原 Agent 会话工具/批准方式。允许跟进后可对未完成事项安排一次有界检查；没有新发现不发言，暂停或来源/目标变化会停止旧计划。详情及验证见 [首次引导设计](docs/design/desktop/onboarding-agent-link.md) 和 [界面 QA](design-qa.md)。
