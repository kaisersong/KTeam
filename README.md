<p align="center">
  <img src="desktop/assets/icon.svg" alt="KTeam" width="120" height="120" />
</p>

# KTeam

**组建你的 AI 团队，让工作主动向前。**

KTeam 是独立的多 Bot 协作桌面应用，按[产品设计](docs/design/product-design-v5.md)分阶段实现。

当前 **0.1.0-preview.14** 可验证：按名字创建长期成员、复用小K模型、建立群聊并持续更新共享共识、自然语言自动选择相关成员（包括不回应）、后台完成多成员讨论、会话内答复、组队方案卡片和单成员私聊、用户验收、暂停/继续、历史分页与崩溃核对。窗口关闭后后台工作继续，未安装开机启动项。

内置 xiaok 使用原平台注册工厂、连续 Session、分层记忆、MCP/插件/Hooks、子 Agent 与 Worktree，并保留文件、终端（含 SSH）、网络和 Skill 工具。工具记录随回复展示；精确审批转到对应 Bot 私聊。小 K 可读取所有可访问团队的真实消息、共享纪要和工作状态，按重要变化主动提醒；群成员可私聊本人澄清，也可调用另一名群成员实际协作。消息内支持原 A2UI 表格和图表卡片。

**完整 v5 与全部 harness 等量迁移尚未交付**。完整 PTY/安全终端、通用循环提醒、严格 Skill fork/验收工作流、完整观察资格协议等差异列在 [迁移清单](docs/design/desktop/harness-parity.md)。密码不通过聊天收集，原生 CLI 使用其自己的本机权限与登录。未宣称完整 AIMP Core-L2 认证，也不把讨论答复或投递回执说成业务已执行。

## 下载

**[下载 macOS Apple Silicon 安装包（v0.1.0-preview.14）](https://github.com/kaisersong/KTeam/releases/download/v0.1.0-preview.14/KTeam-0.1.0-preview.14-mac-arm64.zip)** · [版本说明与 SHA-256 校验文件](https://github.com/kaisersong/KTeam/releases/tag/v0.1.0-preview.14)

下载 ZIP、解压后将 `KTeam.app` 拖入“应用程序”。当前为 macOS arm64 预览版，使用本机 ad-hoc 签名，尚未做 Apple 公证；首次打开若被系统阻止，请在“系统设置 → 隐私与安全性”核对来源后允许打开。Intel Mac、Windows 和 Linux 安装包尚未提供。

本版将收件箱缩为左上“＋”左侧的图标。群聊和单聊均可通过右键或“…”置顶到顶部，未置顶会话保留在普通列表；群头像包含本人和最多三位 Bot。角色头像有不同朝向，工作时眨眼、点头和转头，后台、离屏与减少动态效果时停止动画。Bot 间协作默认显示消息条数与成员名，点击任一成员查看原始往来，关闭后回到原滚动位置。使用前需在 xiaok 中配置模型与配套共享服务。

## 桌面验证

macOS arm64，应用包为 `release/mac-arm64/KTeam.app`。先在小K中配置可用模型与共享服务，再打开 KTeam：

1. 首次打开按引导创建 Bot 或接入已有 Agent。进入助理会话后，例如“帮我组一个经营复盘团队，CEO 和 CTO 一起列出本周资料缺口”。
2. 检查方案里的讨论起点和成员，点击“创建团队”，进入真实群聊，直接交流；共识随讨论更新到共享纪要。
3. 左上“＋”也可只填名字创建成员并直接开聊，或邀请已有成员建群；模型选择折叠在更多设置里。
4. 点击会话标题查看成员、共享、资料、电脑、运行记录与验收；左上“＋”左侧的收件箱图标保留待确认方案、创建恢复和工作问题。
5. 暂停会停止当前工作并保留未开工消息；继续只释放未开工消息。停止或结果未知的回合不自动重放。

预览版复用本机 `~/.xiaok/desktop/activity-owner.config.json` 的私有凭据引用与服务 owner，由原 owner 启动共享服务，不另开一套名册/群转录。配套 broker 版本见 [sources.lock.json](sources.lock.json)，旧服务需要配套升级。模型身份变化会使原绑定失效；不静默换模型。共享服务暂不可用时会显示连接错误。

## 来源与状态所有权

- `vendor/xiaok-runtime` 是锁定源码的最小依赖闭包，原样保留 AgentRuntime、模型适配器、ToolRegistry、兼容凭据加载链及活动 owner 客户端。420 个运行时原始文件各有来源路径与 SHA-256；构建不依赖开发机临时 worktree。见 [NOTICE](NOTICE)。
- KSwarm 是 Agent/项目唯一 owner；intent-broker 是 Room/成员/群消息唯一 owner。KTeam 保存执行绑定、设置、工作队列、预算、稀疏已读、发送 outbox，以及冻结提案/创建阶段和收据；不复制原服务名册或群消息。
- broker 持有实验性讨论任务链、签名定序、准入 epoch/lease、交付字节验证；自然语言不能授予权限。人工验收在独立字节核验之后。
- host 使用私有 Unix socket、独立客户端 token、API/schema 握手与 SQLite OS 锁。未知 POST 只核对事实，不自动重发或重新调用模型。调用预算按会话设置执行，路由及 SDK 重试都计入。
- renderer 只使用白名单语义 IPC，不能读取凭据或调用任意文件/命令/HTTP。Markdown 不执行 HTML，也不把文件路径或图片变成权限。

## 构建和检查

需要 Node >=22.22.0，桌面打包当前验证 macOS arm64。同级放置 `kswarm`、`intent-broker` 和 `mydocs`，版本由 sources.lock 锁定。

```sh
npm ci --ignore-scripts
npm run check
npm run pack:desktop
```

集成测试使用真实隔离服务、专属临时数据库与随机 loopback 端口，并回收记录的 PID；控制器异常测试明确使用推理 fixture，另有真实模型与正式安装包验证。不会用 mock 代替本地 Agent 资格探针。Electron 下载由校验和验证后解压，本地包使用 ad-hoc 签名并验证，未做 Apple notarization。

文档实体位于同级 `mydocs/kteam/`，项目 `docs -> ../mydocs/kteam`，不建立第二份实体目录。

发布预览版时，先更新 `package.json` / lockfile 版本并通过本机完整检查，再推送同版本 `v*` 标签。`KTeam desktop release` 工作流会在 macOS arm64 构建、校验签名并发布 ZIP、构建信息与 `SHA256SUMS`；标签、应用版本和源码必须一致。完整协议/文档检查需要已授权的私有 mydocs 访问；桌面发布流程使用仓库内固定运行时源码独立构建。

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

首次打开会引导创建具名 Bot，并自动发现本机 xiaok / Codex / Kimi / ZCode。已支持的 Agent 直接验证调用并沿用自身配置与登录，无需复制指令或邀请码。Bot 设置分为“属性与主动性”和“Agent”：可配置职责、背景、相关时参与或仅点名、授权资料目录、一次性跟进，以及内置模型或本机 Agent。暂不认识的 Agent 才使用手动邀请、核对确认码的降级接入；仅凭邀请编号不能收发消息。

群名直接使用团队名称，方向和目标在群里讨论，并随共识变化记录到共享纪要。内置 xiaok 复用完整平台工具与权限规则，本机 Agent 使用原生会话与批准方式。允许跟进后可对未完成事项安排一次有界检查；没有新发现不发言，暂停或来源/目标变化会停止旧计划。详情及验证见 [首次引导设计](docs/design/desktop/onboarding-agent-link.md) 和 [界面 QA](design-qa.md)。
