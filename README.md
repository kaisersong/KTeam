<p align="center">
  <img src="desktop/assets/icon.svg" alt="KTeam" width="120" height="120" />
</p>

# KTeam

> Build your AI team and keep work moving. KTeam is a local multi-Bot collaboration desktop app: several AI members discuss, split up and deliver work in a group chat, while you make the calls and accept the results.

KTeam's collaboration is built on **AIMP (Agent Intent Messaging Protocol)**. This is KTeam's main technical difference from other multi-agent tools: chat text is not authorization, and a discussion reply is not proof that the work was done.

[English](README.md) | [简体中文](README.zh-CN.md)

KTeam 内置 Agent 使用原平台注册工厂、连续 Session、分层记忆、MCP/插件/Hooks、子 Agent 与 Worktree，并保留文件、终端（含 SSH）、网络和 Skill 工具。工具记录随回复展示；会话详情还可打开“活动”和“检查器”，分别查看最近工作、易读步骤、Events 和 Raw 记录，并查看原消息与答复。记录可能经过脱敏或截断，提交答复不等于用户验收；精确审批转到对应 Bot 私聊。小 K 可读取所有可访问团队的真实消息、共享纪要和工作状态，按重要变化主动提醒；群成员可私聊本人澄清，也可调用另一名群成员实际协作。消息内支持原 A2UI 表格和图表卡片。

**完整 v5 与全部 harness 等量迁移尚未交付**。 OpenMausBot 借鉴的完整范围、逐特性 PR 和证据边界见[实施清单](docs/design/desktop/openmausbot-delivery-plan-20261110.md)。完整 PTY/安全终端、通用循环提醒、严格 Skill fork/验收工作流、完整观察资格协议等差异列在 [迁移清单](docs/design/desktop/harness-parity.md)。密码不通过聊天收集，原生 CLI 使用其自己的本机权限与登录。未宣称完整 AIMP Core-L2 认证，也不把讨论答复或投递回执说成业务已执行。

收件箱中的“小K关注”可以查看原关注记录、原因、下一步、来源和更新时间，并筛选分页。未知发送会回到原会话核对；读取失败或来源失效会明确提示，查看不会启动模型或重发消息。详见[关注工作台](docs/design/desktop/assistant-attention-workbench-20261111.md)。

系统通知可在通用设置中开启，并按答复、阻塞和问题/工具批准分类，支持暂停与安静时段。点击定位真实事项，不替你回答、批准或清空其它未读。默认关闭；原生展示、系统勿扰及冷启动点击仍待正式安装验收。见[工作通知](docs/design/desktop/work-notifications-20261111.md)。

工作进行中，可在发送前选择追加本轮要求，或等当前工作结束后处理。内置成员在完整工具批次后的模型边界接收补充，沿用同一任务、会话和工具批准；不支持的阶段会明确排队。回执可查看补充来源和修订答复，结果不明时不会自动重做。见[本轮补充要求](docs/design/desktop/running-work-inputs-20261111.md)；视觉与安装验收仍待完成。

对话输入框支持选择、拖入和粘贴附件，发送前可移除或重试。每条最多 4 份，每份最多 4 MiB；发送后绑定原消息和会话资料。结果未知只核对原回执，不重发。见[输入附件](docs/design/desktop/composer-attachments-20261111.md)；真实界面与安装验收待完成。

成员设置的“记忆”可查看当前会话的原记忆、来源和证据，预览影响范围后纠正或忘记，并撤销尚未被后续变化覆盖的修改。清理原记忆的同源链和检索索引，不删除原聊天。见[记忆审阅](docs/design/desktop/bot-memory-review-20261111.md)；视觉与已安装验收仍待完成。

点击私聊标题或成员行可打开[统一成员面板](docs/design/desktop/member-profile-workspace-20261111.md)，在“详情 / 资料库 / 电脑”中查看实际角色、记忆、技能、文件回执和工作目录，并回到原对话的活动、检查器与例行任务。负责人徽章来自原团队角色，名字不授予身份或权限。

内置成员必须向本人澄清时，可将原工作保存并挂起，在私聊显示带来源的问题。重启保留问题，回答后核验原消息并接续同一任务；等待期间不调用模型，未知投递不重复发送，答案不替代工具批准。原会话和问题卡可互相定位。见[持久问题](docs/design/desktop/durable-work-questions-20261111.md)；执行批准的重启恢复、视觉与安装验收仍待完成。

群详情可导出团队配方，在新建交流中选择配方文件、重新选择本机模型并审阅后，创建全新成员与团队。职责和负责人相对关系可保留，例行任务默认暂停；旧凭据、历史、私有记忆、工作目录设置和批准不迁移。重复点击复用原创建回执，未完成的导入可以审阅后核对继续。见[团队配方](docs/design/desktop/portable-team-recipes-20261111.md)；视觉与安装验收仍待完成。

资料库中的“生成的文件”保留原文件工具及报告/演示文稿渲染器已确认的文件回执；工作中断或尚未交付，也可核对已生成的文件和来源工作。每次打开重新检查会话权限、实际文件和摘要。支持常见文档、图片和 HTML，单份最多 20 MiB；外部工具未上报的文件不补造回执。见[中断文件回执](docs/design/desktop/interrupted-artifact-receipts-20261111.md)；视觉与安装验收仍待完成。

## Why AIMP

Most multi-agent tools treat collaboration as a chain of function calls or as free-form chat. The first is too rigid for people to follow; the second leaves it unclear whether anything said actually counts. AIMP takes a different approach:

- **IM conversations at the top.** Contacts, group chats, threads, @mentions, quoted replies and approval cards map directly onto the protocol's rooms, threads and event chain, so people and agents negotiate, delegate, deliver and accept work in the same conversation.
- **Human-readable first, structure added progressively.** With the structured parts removed, a person can still read what happened. Casual chat can be plain language; the riskier and less reversible an action, the more structure it requires.
- **State comes only from the structured event chain.** Collaboration state is derived from ordered, signed structured events. Natural-language text is evidence only and never takes protocol effect by itself.
- **Commitments are explicit, and humans have the final say.** Accepting, delivering and approving work need explicit events. Human messages outrank agents for priority, interruption and veto. Execution rights come only from capability tokens that can expire and be revoked.
- **No new transport.** AIMP is a collaboration layer that complements MCP (tools) and A2A (calls) and runs on existing messaging channels.

Full specification: **[AIMP Design Specification v3.1](spec/aimp/aimp-design-spec-v3.1.en.md)** (English translation; the [Chinese original](spec/aimp/aimp-design-spec-v3.1.md) is authoritative), with its [JSON Schemas](spec/aimp/aimp-v3.1-schemas.json) and [signature test vectors](spec/aimp/aimp-v3.1-test-vectors.json).

## 生成报告和演示文稿

源码构建已内置 `kai-xiaok-plugins` 的报告生成器和幻灯片生成器，供 KTeam 内置模型成员使用。在会话中直接说“把这些资料整理成一份周报”或“基于这份报告生成面向评审的 8 页演示文稿”即可。也可指定报告主题或幻灯片风格；成员读取规划技能、校验内容，再调用渲染工具生成文件，交付最终 HTML 文件链接，并在工具记录上方提供“打开”按钮。HTML 演示文稿可在浏览器中播放和编辑，不等同于 `.pptx` 文件。

插件随构建打包，不要求安装小K或手动配置 MCP。报告支持 9 套主题，演示文稿支持 22 种预设。工具审批继续使用 KTeam 的私聊确认；取消审批不会生成文件。技能可在设置中关闭。外接原生 CLI Agent 仍使用其自己的工具和插件环境。

构建时按 `sources.lock.json` 的固定版本提取插件，首次构建需要获取源码与 Python 运行时；运行时无需下载依赖。macOS arm64 随包提供独立 Python。Linux 上游暂未提供固定 Python 闭包，目前仅内置报告生成器；未发布 Windows 安装包。

## 桌面验证

- The envelope wire version is `aimp: "1.0"`, corresponding to spec 3.1 ([`src/protocol/aimp.ts`](src/protocol/aimp.ts)).
- Passes the spec's official test vectors for all four signature domains: canonical bytes, hashes and Ed25519 signatures ([`tests/protocol.test.ts`](tests/protocol.test.ts); vector copy in [`tests/fixtures/aimp-v3.1-test-vectors.json`](tests/fixtures/aimp-v3.1-test-vectors.json)).
- The canonical JSON subset rejects duplicate keys, invalid Unicode, unsafe numbers and excessive nesting.
- The L0 preview never treats text such as "accept", "approve" or a tool call as authorization.
- The experimental discussion lifecycle in intent-broker is wired up.

**KTeam does not yet claim full AIMP v3.1 compliance or Core-L2 certification.** A production identity root, receipt activation, complete state transitions and side-effect registration are still to be done. The verification script `verify_v31_vectors.py` mentioned in the spec is not shipped in this repository. 0.4 will check the implementation against the v3.1 spec item by item.

---

## What's in 0.3

- `runtime-core/` 是 KTeam 自己维护的运行时代码（AgentRuntime、模型适配器、ToolRegistry、凭据加载链及活动 owner 客户端），最初从 xiaok-cli `f8728a34` 一次性复制而来，之后不再同步；原构建期补丁已直接写进源码。构建和测试不读取 xiaok-cli 或 mydocs。来源说明见 [NOTICE](NOTICE)。
- KSwarm 是 Agent/项目唯一 owner；intent-broker 是 Room/成员/群消息唯一 owner。KTeam 保存执行绑定、设置、工作队列、预算、稀疏已读、发送 outbox，以及冻结提案/创建阶段和收据；不复制原服务名册或群消息。
- broker 持有实验性讨论任务链、签名定序、准入 epoch/lease、交付字节验证；自然语言不能授予权限。人工验收在独立字节核验之后。
- host 使用私有 Unix socket、独立客户端 token、API/schema 握手与 SQLite OS 锁。未知 POST 只核对事实，不自动重发或重新调用模型。调用预算按会话设置执行，路由及 SDK 重试都计入。
- renderer 只使用白名单语义 IPC，不能读取凭据或调用任意文件/命令/HTTP。Markdown 不执行 HTML，也不把文件路径或图片变成权限。

## Features

需要 Node >=22.22.0，桌面打包当前验证 macOS arm64。同级放置 `kswarm` 和 `intent-broker`，版本由 sources.lock 锁定；`mydocs` 只用于文档，可不放，构建与测试不依赖它。

```sh
npm ci --ignore-scripts
npm run check
npm run pack:desktop
```

集成测试使用真实隔离服务、专属临时数据库与随机 loopback 端口，并回收记录的 PID；控制器异常测试明确使用推理 fixture，另有真实模型与正式安装包验证。不会用 mock 代替本地 Agent 资格探针。Electron 下载由校验和验证后解压，本地包使用 ad-hoc 签名并验证，未做 Apple notarization。

文档实体位于同级 `mydocs/kteam/`，项目 `docs -> ../mydocs/kteam`，不建立第二份实体目录。链接存在时 `verify:sources` 会核对文档摘要；不存在时跳过，测试所需的 AIMP 向量在 `tests/fixtures/`。

发布预览版时，先更新 `package.json` / lockfile 版本并通过本机完整检查，再推送同版本 `v*` 标签。`KTeam desktop release` 工作流会在 macOS arm64 构建、校验签名并发布 ZIP、构建信息与 `SHA256SUMS`；标签、应用版本和源码必须一致。完整协议/文档检查需要已授权的私有 mydocs 访问；桌面发布流程使用仓库内固定运行时源码独立构建。

## CLI

```sh
node dist/src/cli.js --help
node dist/src/cli.js doctor
node dist/src/cli.js bots
node dist/src/cli.js teams
```

Never put credentials in command arguments or commit them to Git.

---

## Version History

### v0.3.0

- Fully decoupled from xiaoK: separate data directory, ports and credentials.
- "Import from xiaoK" kept, reading once and only when the user clicks.
- Mac auto-update from KTeam's own Releases only.
- One-time upgrade notice for 0.2 users of the shared service.
- macOS build signed and notarized by Apple.

### v0.2.0

内置群成员可以异步交接独立子工作：负责人保存当前工作并释放执行槽，结果返回后接续原任务。等待卡片显示成员状态及私聊确认入口；暂停、来源变化或超时会停止旧交接，失败及未知结果保留待核对，不自动重做。实现和验收边界见[异步成员交接](docs/design/desktop/async-member-handoffs-20261111.md)。

内置群成员也可保存工作并等待文件到位、内容变化或同会话已有工作返回结果。没有变化时不调用模型；期限、当前读取权限和原工作范围仍生效。条件满足后接续同一任务，失败或结果不明不自动重做。见[条件等待](docs/design/desktop/condition-work-waits-20261111.md)。

群名直接使用团队名称，方向和目标在群里讨论，并随共识变化记录到共享纪要。KTeam 内置 Agent 复用完整平台工具与权限规则，本机 Agent 使用原生会话与批准方式。会话详情中的“例行任务”支持具名的单次、每周指定日与固定间隔执行，指定内置成员、时区、结束时间及最多触发次数。任务进入同一工作队列，结果交回原会话，原工具批准仍生效；错过超过 5 分钟不补跑，上次未结束跳过本次，失败或结果不明会停止后续触发等待核对。可以暂停、编辑、移除并查看运行历史；外接 Agent 的无人值守周期执行暂未验证。允许跟进后可对未完成事项安排一次有界检查；没有新发现不发言，暂停或来源/目标变化会停止旧计划。详情及验证见 [首次引导设计](docs/design/desktop/onboarding-agent-link.md) 和 [界面 QA](design-qa.md)。
## OpenMausBot 对照与本轮改进

已按固定源码快照对照持续职责、条件等待、异步交接、成员技能/工具、通知、材料交付、记忆与团队模板等 15 个领域，见[源码差距与实施顺序](docs/design/desktop/openmausbot-source-audit-20261110.md)。逐项交付状态以实施清单及后续独立设计记录为准。

本轮源码为内置 Bot 增加独立技能选择，沿用全局限制和原工具权限；外接 Agent 继续在自己的环境管理。Bot 设置的“跟进”页可查看已安排的一次性检查、时间/来源会话、执行或失效状态，取消尚未入队的检查并回到来源会话。取消与原调度器入队共用事务核对，防止旧快照重新执行已取消的计划。未新增定时器、名册或任务状态库，也不将一次跟进宣传为循环职责。

成员的技能页可审阅本会话私有、全局、项目及内置来源的实际内容与关联资源，并固定版本。内容变化或来源缺失会阻止旧工作使用该版本；固定只用于这个成员在指定会话的工作，不扩大工具权限。详见[成员技能库](docs/design/desktop/bot-skill-library-20261111.md)。成员提出的学习候选可在原答复交回后查看来源、编辑审阅并保存为本会话私有技能，也可忽略或撤销未改动的保存文件；过程不自动授权，见[学习候选闭环](docs/design/desktop/reviewed-skill-learning-20261111.md)。

成员设置的“工具范围”可限制文件目录、只读、终端与网络工具，并选择原已配置的 MCP 服务。限制沿用原运行器及批准规则，内部子 Agent 同样受约束；无法兑现范围的不透明执行通道停用，外接 Agent 的逐工具隔离明确未验证。见[成员工具范围](docs/design/desktop/bot-tool-scopes-20261111.md)。
