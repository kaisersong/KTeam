# Xiaok 本地 Agent 与协作空间：源码证据

日期：2026-11-09（Asia/Shanghai）。研究者：GPT-6 Astra，独立于主设计/实现 Codex GPT-6。只读研究；未调用模型、真实任务、GUI、凭据或私人消息。下文“已有”指已读源码实现，不是本机安装包执行验证。

## 版本与研究范围

| 仓库 | 实际根目录 | 完整 HEAD |
|---|---|---|
| xiaok | `/Users/kk/projects/.worktrees/assistant-kim-skill` | `5e77c08372ec7c1fd190d1e554153acdce02fae6` |
| kswarm | `/Users/kk/projects/kswarm` | `16c3ed14c5493a82d000d69d34e4b1c933187433` |
| intent-broker | `/Users/kk/projects/intent-broker` | `2dd1f40dc5e0fc5438a2086d13963cc67489db45` |

三个根均无 `.codegraph`，按规则精准 rg/read，未创建索引。kswarm/intent-broker `git status --short` 为空；xiaok `desktop`/非 build-info 的 src 源无本任务修改。遵照 AGENTS 运行 `npm run hygiene:check`，exit 0；它执行 fetch，提示该 feature branch 无 upstream、落后 origin/master 11 commits，不改变本文绑定 HEAD。未执行产品测试或实际 Agent 调用。

引用 `X:`、`K:`、`B:` 分别是上述 xiaok、kswarm、intent-broker 根。行号来自这些实际工作树源码。报告只判断下面追到的链路，不把全文检索未命中当作全产品不存在。

## 结论：协作空间已有真实执行，但不同执行身份能力不等价

**不能写“协作空间目前仅聊天”。** 它已具备 Main owner、绑定工作区、broker claim、受限工具执行、子执行、真实文件观察、manifest/ticket、物理释放及重启恢复链。当前缺口更具体：外部 CLI self-running 身份进入 Room 的路由只提供经隔离证明的讨论能力；托管小K身份可以使用 workspace worker。项目里的 CLI 能力不能直接复制成 Room CLI 文件执行权。

**“取个名字便跟随群目标工作”可以隐藏默认模型和运行方式的配置，但不能省略内部稳定身份、成员授权、主机绑定、工作区授权与完成证据。** 应复用持久逻辑 Agent/Room，而不是把临时 `spawn_agent` 的子执行叫成永久 Bot。

## 1. 持久 Agent 与项目本地调用现状

- K:`src/core/agent-store.js:32` 定义逻辑 Agent 的 id/name/instructions/roles/runtimeId 等；`:55` 默认配置、`:207` 默认种子、`:227` 明确 desktop-managed 小K不依赖单独 CLI，`:249` 使用 `{mode:'hosted',hostParticipantId:'xiaok-desktop'}`。`:285` 持久化，`:295` create 分配稳定 ID、名称唯一、归档与创建幂等 provenance；`:333` 按名称查找。可复用为 Bot 的稳定目录身份，不能用进程 pid 替代。
- K:`src/server/index.js:3631` 的 Agent 创建入口验证 Desktop mutation context，拒禁止 payload，然后以真实探测结果选择 runtime（`:3637`）。K:`src/core/agent-runtime-selection.js:14` 要求 registry 支持且 detected.path 存在，不接受任意可执行路径作为用户身份。X:`desktop/electron/kswarm-project-agent-typed-ipc.ts:29` 禁止 API key/baseUrl/provider/model/customEnv/runtimePath/execution/credential/secret 等字段由此 UI payload 注入。
- K:`src/core/agent-execution.js:5` 解析 execution；`:13` 明确只有显式 participantId 才是 self_running，裸 agent id/显示名不是传输地址。`:32` hosted participant 冲突拒绝，`:46` self_running 路由到明确 participant，`:52` 无路由 fail closed。`:58` 只有明确 `fallbackToDesktopModel=true` 且运行退化时才走 Desktop fallback。Bot 产品需显示实际执行器/降级，不能换模型仍称原 Bot 完成。
- K:`src/server/index.js:347` 项目 request_task 分发先经过 workspace admission（`:358`），然后选择 assignedRuntimeInstance 或逻辑 agent route（`:363`），创建 handoff 并投递（`:373`、`:400`）。这证明存在项目执行路由，不证明该任务已执行或验收。
- K:`src/server/index.js:3735` start 需要 Desktop mutation 身份、状态和 execution boundary；`:3749` 启动真实 auto-worker。K:`src/core/runtime-execution-boundary.js:5` 将 Desktop hosted 与本地 CLI 分开；`:16` 禁止把托管小K当普通 autoworker再次启动。
- K:`src/core/runtime-capabilities.js:22` 是显式 registry：包括 xiaok-cli、claude、codex、opencode、gemini、qoder、kimi、pi；`:42` 起还有显式 unsupported。`:83` 特别区分 supported/detected 与真实 callability。**zcode 不在这份显式 registry；不能将本次评审工具可调用推断成产品运行时已接线。**
- K:`scripts/auto-worker.js:331` 起是真实 CLI harness；`:829` 的 runXiaok 用 `spawn(binPath,['chat',prompt,'-p','--auto'],{cwd,...})`，注册 active child，消费 stdout，`:871` 退出处理。`:2545` 优先 CLI，`:2559` 可转 LLM；这是旧项目执行机制，不可直接作为“指定 Bot 一定执行”的证明。尤其有 stdout 的非零退出仍可被 runXiaok resolve，产品完成判定必须走真实任务/产物验收，不能只看字符串或 exit wrapper。

## 2. Room 支持哪些 Agent，缺口在哪里

- X:`desktop/electron/room-execution-router.ts:49`：xiaok-worker/xiaok-po 返回内部 workspace route；`:53` hosted 只承认 host `xiaok-desktop`，冲突 participant 拒；`:57` desktop-agent-runtime 的非 self-running 也走内部 route。
- 同文件`:58` self_running identity 冲突拒；`:60` 只接受有 participantId 且 runtimeType 为 `qoder` 或 `xiaok`；`:31` 从 KSwarm `/runtimes` 查安装、canonical realpath 校验、JS入口用本机 Node；`:63` runtimePath不一致拒。`:73` 对外 capability 分为 workspace_worker/discussion_only/discussion_unavailable，明确不是同一权限。
- **实际类型兼容缺口：** K:`src/core/runtime-capabilities.js:23` 和 `src/core/agent-store.js:79` 将小K CLI命名 `xiaok-cli`；X router`:38` 精确同名查 runtime，`:60` 只接 `xiaok`。K:`src/core/agent-store.js:559` normalize 未把一般 xiaok-cli 改名为 xiaok。因此新产品须给出生产 catalog→Room resolver 的兼容测试，不能笼统说本地小K CLI已可用。托管小K不受此同名问题影响。
- Kimi 已有项目 harness registry（K:`runtime-capabilities.js:29`），但 X router`:60` 不接 Kimi。扩展 Room 必须新增对应协议能力与身份绑定，不是仅把名字加列表。zcode 同理，先定真正 executable/protocol/认证来源。
- X:`desktop/electron/room-external-discussion-adapter.ts:41` probe：Windows fail closed，kiro隔离未验证拒；xiaok要求 `--room-discussion-v1 --probe` 返回 freshSession/toolsDisabled/mcpDisabled/hooksDisabled 全 true；qoder核实隔离 flags和disableAllHooks（`:50`–`:60`）。`:70` 临时中性目录；`:95` 执行参数再次限制讨论。外部 CLI讨论禁工具、MCP、hooks与历史会话，不是带项目权限的本地 Agent。
- X:`desktop/electron/collaboration-room-service.ts:310` 将@显示名解析成活动成员 logicalAgentId，未知提及拒；无明确@可补默认小K worker（`:314`）。`:330` 按真实 capability 过滤；`:340` 先持久消息，再`:362`异步 dispatch。**sendRoomMessage/wake返回仅表明接收/排队，不能显示“工作完成”。** 可复用名称入口，但稳定 ID与成员身份不能由模型文本覆盖。

## 3. Room 工作区不是概念接口，Main 已实际接线

- X:`desktop/electron/main.ts:1468` 获取 workspace mutation owner，`:1472` SQLite本地事实，`:1477` project scope guard；`:1493` 创建 router；`:1497` runtime 的 execute 直连 `services.runCollaborationRoomAgentTask`；`:1506` project execution 也直连生产 service；`:1521` recovery owner启动，`:1533` 先停恢复、shutdown执行，再关store/owner。
- X:`desktop/electron/room-workspace-runtime.ts:112` 先读 Room当前事实和外部能力。`:122` 外部必须有协议隔离 proof；`:167` 没workspace只讨论；`:182` project scope的普通聊天无task reference，**明确仅讨论**；`:197` 只有active workspace的room_only聊天才 acquire并执行。项目工作需要`:292`起prepareProjectTask/`:327`起executeProjectHandoff，不能用“关联了项目”的聊天消息自动偷渡文件执行。
- X:`desktop/electron/desktop-services.ts:2331` 对真实 envelope/contextWindow校验，不接受伪完整历史；`:2341` workspace 与 room/logicalAgent/scope一致；`:2351` 构造空间上下文；`:2384` workspace分支实际调用 `runRoomWorkspaceExecutor`，`:2385` 模型绑定来自已配置当前模型，`:2390` 真 registry和Desktop model runner接线。缺workspace走`:2323`受限discussion registry。**当前托管Room worker并非按任意Bot名字自动拥有各自模型/长期会话**：这个执行链每次解析当前模型，实际输入以Room快照、已发布instructions为事实。
- X:`desktop/electron/room-workspace-executor.ts:85` 定义 discussion/workspace allowlist，注册后仍过滤（`:114`）；`:105` bash仅显式localCommandsAllowed且非Windows；外部MCP/native coding bridge/未跟踪后台进程默认不支持。`:130`每工具授权，`:134`–`:165`目录根真实身份+路径+读前后hash+写入CAS，写前再次授权。
- 同文件`:247` turn实际创建runner，`:295`执行input，`:306` await runner，`:309` drain，`:310`等子执行，`:312`交manifest；finally`:315`保证真实资源清理后release。不是只写“已完成”文本。
- 同文件`:252` 临时子Agent属于本次MultiAgentCoordinator；`:253`拒child模型/模型能力/worktree覆盖；`:263`为每个child turn单独acquire，`:266`强制继承room/主机/binding/generation/成员/权限等，`:326`root从空history启动。**这些是执行子任务，不应被产品层冒充跨重启/跨群的持久Bot身份。**

## 4. 主机、权限、取消、恢复和交付边界

- X:`room-workspace-owner.ts:13` 用OS用户派生loopback exclusive bind确定单本地mutation owner；它不是普通网络执行服务。无owner不得靠第二个timer继续写。
- B:`src/room/trusted-context.js:15` 验证经认证transport构造的session/actor/requestSource，`:40` agent必须在allowedLogicalAgentIds；注释`:4`明确不从payload拿身份。形状校验不等于认证本身，复用时仍须保留transport owner。
- B:`src/room/workspace-service.js:40`要求active membership，owner操作限user；`:50`hostPrincipal+hostIncarnation fence，`:56` originHost约束；`:79` ownClaim同时核对host/agent/成员revision/authorization。Bot取名或加入群，不会自动获得目录读写。
- B同文件`:341` acquire：协议必须支持cwd、children tracking、release；project还需active mapping（`:346`）；claim绑定run/executor/logicagent/host/incarnation/binding/generation/instructions/membership（`:354`–`:363`），`:365` ack要实际cwd验证。`:370`取消先记录cancel_requested，不能把取消请求当物理停止。
- X:`room-workspace-runtime.ts:57`将admission与physical-claim先durable登记；`:80`绑定本机active根，`:83`验证已发布instructions revision+digest；`:97`cwd ack。工具授权再查binding/claim（`:205`），避免长任务跨await吃旧权。
- X同文件`:222`提交前授权，逐产物observeWorkspaceFile，manifest记录producer claim/run与实际文件事实；`:233` handoff完成状态特意是 **unverified**；`:237`prepareSubmission，`:238`broker agent-ticket，`:239`commit并flush。**manifest已交≠用户目标已验收；Bot UI要分别显示执行结束、产物提交、验收通过。**
- X同文件`:268`取消abort当前room执行并向broker cancel；`:447`shutdown先fence新执行、abort、await所有tracked执行。executor`:315`真实drain+子任务完成才release。不要把Map为空或心跳过期当cleanup成功。
- X:`room-workspace-recovery.ts:13`恢复只重放本地事实不自动授新执行；`:31`只接受明确进程不存在证据，`:43`只识别自有in-process跟踪/精确proof，未知活PID保持pending；`:56`同源host，`:61`incarnation takeover CAS+evidence。`:88`起恢复submission ticket而非盲目重跑LLM。Bot长期在线产品不能把这个“恢复事实”宣传成“断线后自动续跑原CLI会话”。
- 外部讨论也有专用operation journal/claim token/hostidentity（X runtime`:128`–`:150`）；adapter`:79`supervisor进程组，`:90`记录pid+start identity，`:100`durable onStarted完成前不发启动指令；`:105`非零退出拒，`:109`等整个进程组退出才报告release。runtime`:159`校验resourcesReleased后才completeWake，`:403`专门恢复unknown/pending。不能退回广泛pkill或仅凭CLI父进程退出。
- B:`adapters/xiaok-code/adapter.js:91`通用inbox handler后ack；`:110`handler缺失/异常也不构成任务完成证据。它是传输插件接口，不能单独当新Bot执行引擎。

## 5. 产品设计最小复用建议（建议，不是已实现声明）

1. 保留一份稳定 Bot identity（可复用logical Agent目录）+群成员记录，运行实例/claim/session另记。用户只填名字时，由群目标+默认托管runtime形成可撤销配置，名称只是显示；提示词不拥有授权权。
2. 复用 Room消息/mention/context、workspace owner/binding/claims、artifact manifest和项目mapping。不要再造一套群、task状态、后台timer或“已完成”消息事实。
3. 首版默认托管小K可自然覆盖Room工作区；产品必须清楚显示只讨论/可在工作区工作/运行时不可用。若用户要求kimi/zcode本地Bot，必须实现真正local runtime binding和协议，不能悄悄替换成默认Desktop模型。
4. 群目标可以驱动计划和建议，但“自动持续工作”要有可见工作项/停止条件/资源预算/外部动作授权。现有Room消息触发执行和project task路由不是无限自主队列授权。
5. 持久Bot记忆应按Bot+群/项目scope定义；现有Room snapshot和临时child history不等于跨群个人记忆。新记忆层不得把私人会话、其它群history或本机凭据默认装进Bot。
6. local CLI工作区能力扩展需证明目录、工具、外部动作、子进程、取消、恢复、权限撤销都能受约束；否则维持discussion_only并解释原因。不能只把runtime白名单扩大就称接好。

## 6. 后续必须验证的生产入口（本研究未执行）

- 用正式catalog创建/发现→Room resolver→真实runner证明托管xiaok、xiaok-cli、kimi、zcode各自能力；detected/supported/可调用分开，额度错误停止并标skip，不能把skip记pass。
- 名称碰撞、重命名、Bot离群/归档、participant冲突、host换代、workspace重绑定、跨group/project身份与权限撤销，真实Main/Broker负例。
- 真任务从message accepted→claim running→实际文件→manifest/ticket→验收；单独测空文本、非零退出带stdout、fallback、重复投递、lost reply，拒把ack或工具名当成功。
- 长任务取消后所有child与进程组退出/仍pending；重启unknown只恢复已有事实不重复执行；仅清理自己登记PID。
- 真安装包同SHA，通过正式UI创建具名Bot、加入群、围绕群目标完成小合成工作，重启身份保留；与mock/jsdom/源码证据明确分层。

以上证据支持把“协作空间也应支持”纳入设计主链，而不是另起一个与现有Room无关的临时subagent面板。本文不是实现或上线批准。
