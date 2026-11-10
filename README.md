<p align="center">
  <img src="desktop/assets/icon.svg" alt="KTeam" width="120" height="120" />
</p>

# KTeam

**组建你的 AI 团队，让工作主动向前。**

KTeam 是独立的多 Bot 协作桌面应用，按[产品设计](docs/design/product-design-v5.md)分阶段实现。

当前 **0.1.0-preview.15** 可验证：按名字创建长期成员、独立配置模型（也可显式导入小K配置）、建立群聊并持续更新共享共识、自然语言自动选择相关成员（包括不回应）、后台完成多成员讨论、会话内答复、组队方案卡片和单成员私聊、用户验收、暂停/继续、历史分页与崩溃核对。窗口关闭后后台工作继续，未安装开机启动项。

内置 xiaok 使用原平台注册工厂、连续 Session、分层记忆、MCP/插件/Hooks、子 Agent 与 Worktree，并保留文件、终端（含 SSH）、网络和 Skill 工具。工具记录随回复展示；会话详情还可打开“活动”和“检查器”，分别查看最近工作、易读步骤、Events 和 Raw 记录，并查看原消息与答复。记录可能经过脱敏或截断，提交答复不等于用户验收；精确审批转到对应 Bot 私聊。小 K 可读取所有可访问团队的真实消息、共享纪要和工作状态，按重要变化主动提醒；群成员可私聊本人澄清，也可调用另一名群成员实际协作。消息内支持原 A2UI 表格和图表卡片。

**完整 v5 与全部 harness 等量迁移尚未交付**。 OpenMausBot 借鉴的完整范围、逐特性 PR 和证据边界见[实施清单](docs/design/desktop/openmausbot-delivery-plan-20261110.md)。完整 PTY/安全终端、通用循环提醒、严格 Skill fork/验收工作流、完整观察资格协议等差异列在 [迁移清单](docs/design/desktop/harness-parity.md)。密码不通过聊天收集，原生 CLI 使用其自己的本机权限与登录。未宣称完整 AIMP Core-L2 认证，也不把讨论答复或投递回执说成业务已执行。

收件箱中的“小K关注”可以查看原关注记录、原因、下一步、来源和更新时间，并筛选分页。未知发送会回到原会话核对；读取失败或来源失效会明确提示，查看不会启动模型或重发消息。详见[关注工作台](docs/design/desktop/assistant-attention-workbench-20261111.md)。

系统通知可在通用设置中开启，并按答复、阻塞和问题/工具批准分类，支持暂停与安静时段。点击定位真实事项，不替你回答、批准或清空其它未读。默认关闭；原生展示、系统勿扰及冷启动点击仍待正式安装验收。见[工作通知](docs/design/desktop/work-notifications-20261111.md)。

## 下载

**[下载 macOS Apple Silicon 安装包（v0.1.0-preview.15）](https://github.com/kaisersong/KTeam/releases/download/v0.1.0-preview.15/KTeam-0.1.0-preview.15-mac-arm64.zip)** · [版本说明与 SHA-256 校验文件](https://github.com/kaisersong/KTeam/releases/tag/v0.1.0-preview.15)

下载 ZIP、解压后将 `KTeam.app` 拖入“应用程序”。当前为 macOS arm64 预览版，使用本机 ad-hoc 签名，尚未做 Apple 公证；首次打开若被系统阻止，请在“系统设置 → 隐私与安全性”核对来源后允许打开。Intel Mac、Windows 和 Linux 安装包尚未提供。

本版将收件箱缩为左上“＋”左侧的图标。群聊和单聊均可通过右键或“…”置顶到顶部，未置顶会话保留在普通列表；群头像包含本人和最多三位 Bot。角色头像有不同朝向，工作时眨眼、点头和转头，后台、离屏与减少动态效果时停止动画。小K助理日常保持正面，只在工作时轻微转头。Bot 间协作默认显示消息条数与成员名，点击任一成员查看原始往来，关闭后回到原滚动位置。无需安装 xiaok。模型在 KTeam 设置中配置，默认使用本机私有文件存储；只有主动选择 Mac 钥匙串才使用 KTeam 自己的钥匙串。已有用户可显式导入小K模型；导入不改写原配置。

## 桌面验证

macOS arm64，应用包为 `release/mac-arm64/KTeam.app`。直接打开 KTeam，内置固定版本的 KSwarm 与 intent-broker，无需先安装小K：

1. 首次打开配置模型并创建 Bot，或接入本机已有 Agent。进入助理会话后，例如“帮我组一个经营复盘团队，CEO 和 CTO 一起列出本周资料缺口”。
2. 检查方案里的讨论起点和成员，点击“创建团队”，进入真实群聊，直接交流；共识随讨论更新到共享纪要。
3. 左上“＋”也可只填名字创建成员并直接开聊，或邀请已有成员建群；模型选择折叠在更多设置里。
4. 点击会话标题查看成员、共享、资料、电脑、运行记录与验收；左上“＋”左侧的收件箱图标保留待确认方案、创建恢复和工作问题。
5. 暂停会停止当前工作并保留未开工消息；继续只释放未开工消息。停止或结果未知的回合不自动重放。

新安装由 KTeam 启动内置服务，数据与模型保存在自己的 `~/.kteam/` 目录。旧安装保留原共享服务的连接凭据、数据库和成员目录；需要恢复服务时使用内置固定版本源码，不另建空历史库，也不依赖小K程序。已有模型通过设置中的显式导入复制到 KTeam，未导入时仍能查看原历史。配套 broker 版本见 [sources.lock.json](sources.lock.json)，旧服务需要配套升级。模型身份变化会使原绑定失效；不静默换模型。共享服务暂不可用时会显示连接错误。

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

内置群成员可以异步交接独立子工作：负责人保存当前工作并释放执行槽，结果返回后接续原任务。等待卡片显示成员状态及私聊确认入口；暂停、来源变化或超时会停止旧交接，失败及未知结果保留待核对，不自动重做。实现和验收边界见[异步成员交接](docs/design/desktop/async-member-handoffs-20261111.md)。

内置群成员也可保存工作并等待文件到位、内容变化或同会话已有工作返回结果。没有变化时不调用模型；期限、当前读取权限和原工作范围仍生效。条件满足后接续同一任务，失败或结果不明不自动重做。见[条件等待](docs/design/desktop/condition-work-waits-20261111.md)。

群名直接使用团队名称，方向和目标在群里讨论，并随共识变化记录到共享纪要。内置 xiaok 复用完整平台工具与权限规则，本机 Agent 使用原生会话与批准方式。会话详情中的“例行任务”支持具名的单次、每周指定日与固定间隔执行，指定内置成员、时区、结束时间及最多触发次数。任务进入同一工作队列，结果交回原会话，原工具批准仍生效；错过超过 5 分钟不补跑，上次未结束跳过本次，失败或结果不明会停止后续触发等待核对。可以暂停、编辑、移除并查看运行历史；外接 Agent 的无人值守周期执行暂未验证。允许跟进后可对未完成事项安排一次有界检查；没有新发现不发言，暂停或来源/目标变化会停止旧计划。详情及验证见 [首次引导设计](docs/design/desktop/onboarding-agent-link.md) 和 [界面 QA](design-qa.md)。
## OpenMausBot 对照与本轮改进

已按固定源码快照对照持续职责、条件等待、异步交接、成员技能/工具、通知、材料交付、记忆与团队模板等 15 个领域，见[源码差距与实施顺序](docs/design/desktop/openmausbot-source-audit-20261110.md)。逐项交付状态以实施清单及后续独立设计记录为准。

本轮源码为内置 Bot 增加独立技能选择，沿用全局限制和原工具权限；外接 Agent 继续在自己的环境管理。Bot 设置的“跟进”页可查看已安排的一次性检查、时间/来源会话、执行或失效状态，取消尚未入队的检查并回到来源会话。取消与原调度器入队共用事务核对，防止旧快照重新执行已取消的计划。未新增定时器、名册或任务状态库，也不将一次跟进宣传为循环职责。

成员的技能页可审阅本会话私有、全局、项目及内置来源的实际内容与关联资源，并固定版本。内容变化或来源缺失会阻止旧工作使用该版本；固定只用于这个成员在指定会话的工作，不扩大工具权限。详见[成员技能库](docs/design/desktop/bot-skill-library-20261111.md)。成员提出的学习候选可在原答复交回后查看来源、编辑审阅并保存为本会话私有技能，也可忽略或撤销未改动的保存文件；过程不自动授权，见[学习候选闭环](docs/design/desktop/reviewed-skill-learning-20261111.md)。
