# OpenMausBot：路由、协作、主动性和控制面证据

研究日期2026-11-09；只读参考 kai-mbp `/Users/kai/projects/refre-proj/OpenMausBot`，冻结 HEAD `717343f2869d6179e21a301c3b5920953937e231`。根AGENTS已读；所涉server/shared/src/electron/scripts目录无更具体AGENTS（tree仅列根及apps/docs/AGENTS，未涉后者）。未发现.codegraph；远端用git show HEAD读固定源码，不切分支、不改稀疏checkout。

初始/结束git status --short空。遵循根AGENTS与docs/verification/README：本轮没有启动隔离fixture，因此下列仅为源码证据，不能称“实际可用/运行通过”。未启动服务/模型/浏览器、未安装依赖、未读取.env/凭据/真实数据，无后台进程。

设计对照：`/Users/kk/projects/.worktrees/bot-team-product-docs/xiaok-cli/design/2026-11-09-bot-team-product-design.md` v4（只读，未修改）。行号均相对参考仓库HEAD。

## 1. Auto 路由是真实现，但不是已训练K-IM路由，也不包含noop

- `server/decider/room-routing.ts:4-18,67-100`：生产timeout1500ms、pTop阈值0.6；输入room/humans/成员name+title+description/最近消息/新消息；最近消息总预算6000字符、单行500，新消息8000。输出只含member/everyone/fallback。`__everyone__`只在明确需要多人回答时选择。
- `server/host/room-routing-input.ts:19-37`：只取text消息，剥离attachment markup并redactSecrets，成员身份来自store，不让模型任意指定成员。
- `server/index.ts:10775-10795,10873-10875`：Auto仅用于非DM、chat模式、deciderReady且未明确@的群；goal另走协调者。真实host不是UI里“auto先显示候选全员”的推测。
- `server/store.ts:237-267`：明确@优先；auto fallback使用fallbackBotId或第一个active member。`server/index.ts:10919-10959`：只有有效路由结果才替换原fallback round，异常/低置信保留lead；最后逐个member dispatch。成功路由附provider/probability。
- `server/decider/jev.ts:8-27,49-64,119-146`：调用Typesafe `/v1/systemone`、`jev-latest`，严格校验选择与概率；429为rate_limited、401/403 rejected等。它是可选决策backend，不是Songkai/K-IM-Deiction的训练或部署证据。
- **没有silent/noop答案。** `room-routing.ts:35-38`的联合类型可证；`server/decider/room-routing.eval.test.ts:1-4,61-69`明确nobody只报告不评分，且eval用10秒而非生产1.5秒。阈值注释所称92–99%不能当本轮实测，更不能替代v4§18.1包含noop/依赖/歧义的固定集。

对v4：§7相关成员路由、§10决策模型分工、§18.1探针已有等价。可补“显式mentions→owner/依赖→模型→有界lead诊断”的可见路由来源与原因；lead接到的是澄清/判断职责，不自动取得项目执行或外发授权。保留noop，模型不确定不得让全员执行。名字/头衔是语义线索，不是凭名字授予能力。

## 2. 目标驱动协作：协调者控制信封+有限回合，完成仍需证据门槛

- `server/group-goal-run.ts:6-15`：默认13回合，等待上限30分钟，状态continue/completed/needs-input/blocked；`:57-84`解析最后完整`<openmaus-goal>` JSON，剥离可见控制片段。
- `:87-108`协调者限本群active成员，优先configured lead，其次Chief/首成员；同名需唯一匹配。`:127-158`系统统一给goal/roster/剩余回合与具体assignment，要求做具体工作、不要纯讨论、交付物在会话中才声称完成。说明低配置体验依靠共享系统契约，而非模型完全无规则。
- `:229-278`执行协调回合后解析decision，非continue便finish同状态；该完成分支未检查文件hash/构建结果/用户验收证据，不能把private JSON“completed”当成已验证交付。
- `:282-337`拒绝非active成员；同assignment第三次重复则blocked；忙/parked可向协调者重新分配，三次等待耗尽blocked；空结果/provider失败不当成功。`:342-343`上限是limit-reached，而非completed。
- `server/coordinator.ts:7-26,31-71`：coordinate_bots有standing/new/指定工作thread、reply resume/none、consult、doneWhen、inMyFolder、projectId及answers等；handoff视图有root/parent/group/thread、result、reported、executions、restarts、mode与outcome。
- `server/host/teammate-prompts.ts:31-37,57-68`：resume模式要求发完结束自己turn，结果回来自动resume；outstanding列表阻止重发和轮询丢单。`:40-50,71-78`按acting person区分真人驱动与外部事件驱动，后台不能冒充用户回答私人问题。
- `server/host/handoff-sent.ts:8-38`：明确room/lane/direct路径，交接显示接收者、原因、doneWhen；`server/coordinator.ts:133-153`host在每次dispatch重查地址和权限，且声明已外发的cut turn不可直接重跑。

对v4：原群可见交接、CAS单owner/fence、明确接受/拒绝、步骤验收、unknown/reconcile、预算与重复停止均已有，不需换另一套coordinator。增量可把“任务已移交且系统会自动回来”做成正常消息状态，避免用户继续传话；结果返回绑定原root/工作版本。不能照搬以模型信封直接标完成，也不能拿13回合/30分钟当未经验证的默认值。

## 3. 主动性：先用代码检查新事实，无变化不叫大模型

- `server/host/proactive.ts:1-4,93-135`：主动主Agent复用普通routine引擎、connected reads、read-and-draft和brief；不是第二个watcher。`:35-36`可证明read-and-draft运行时fence的engine集合此处仅claudeAgent，不能把“支持多engine”扩张成任意engine已满足全部限制。
- `server/host/default-watch.ts:3-15`：默认Keep an eye on my day每15分钟；watchAsMade显式区分用户已暂停/改动的routine。
- `server/host/routine-checks.ts:1-4,20-50,54-78`：代码检查Calendar、Gmail、其他routine结果；只保存ids/times/cursors/pending；无AI即可提醒、查冲突、列日程；需要判断才批成模型turn。read失败有15分钟递增至2小时backoff，不把失败当没变化；pending三小时后可交还。
- `docs/proactive-routines.md:14-36,38-62,66-94`为设计说明：单一owner、迁移保留pause/cursors/day count、brief固定chat每日原地更新、有needs-you才通知、暂停routine即关闭。上述文件与部分源码吻合，但本轮未运行相关fixture，不作为运行证明。

对v4：§8观察→判断→推进→找人、§9统一主动引擎与quiet/暂停已有等价；值得明确“生产读取成功+sourceVersion有变化才申请推理预算”，确定性的提醒/依赖解除可免模型。由共享owner执行，不另增小K scheduler。不能默认扫描所有来源，连接、授权、群范围、预算都仍admission；不能把read-and-draft直接推广至未知本地CLI。

## 4. 群上下文与共享指令要分开

- `server/index.ts:10128`群bulletin以“shared instructions for everyone”进入turn；server的room字段12k限制见`:3613-3622,3653-3658`。
- `server/section-context.ts:1-2,12-25,49-78`团队shared context 24k字节，agents不可直接写，因为会成为每个成员之后的指令；stable memory key用于改名不丢身份。
- `server/host/outside-writes.ts:1,34,57-58`把Bot改群bulletin当proposal，确认后才patch。普通原始消息/事实不能因Bot发言升级成共享系统指令。
- `server/room-context-settings.ts:3-18`roomSessions为显式可选/环境覆盖；`server/room-context.ts:6-15,43-58,77-111`逐成员tokens/window计量、默认0.9阈值/显式compact，warm engine/process相关状态不能当durable身份或真实任务完成。

对v4：§12共享事实、记忆、更正与§15权限已有方向。可增“群目标/团队规则与事实账本独立版本、独立写权限”的产品说明：Bot能追加有来源的事实/更正候选，不自行给团队写永久规则或提高权限。上下文compact后仍从canonical事实/承诺重建，不能把raw transcript汇总当唯一状态。

## 5. 团队文件：至少三种不同用途，不能混为导入即执行

- `src/lib/team-import.ts:32-52,87-102`：client只是预览，server仍信任边界；legacy Markdown解析YAML frontmatter，`botmrr:1`包升级为openmaus.package；非任意自然语言md直接执行。
- `shared/package-format.ts:184-193,660-680`：团队模板有成员/群bulletin/defaultResponder，严格校验key引用，默认lead必须在群内；旧auto读入，export按lead写，避免接收者没有decider还误称Auto。
- `src/lib/team-share.ts:19-40,73-89`：可选择skills、starter memory、头像、preset并dryRun，返回redacted/skipped/summary；`:44`模板默认includeMemory=true，这种默认对通用分享有隐私风险，不建议新产品照搬。
- `docs/team-sharing.md:9-67,79-105`文档区分share package：不含聊天/keys/model/computer/ACL/local stdio MCP；routines paused、skills off、MCP空凭据disabled、additive导入失败rollback；starter notes含MEMORY.md而无daily logs。此为文档宣称，不把全部路径视为已实测。
- **本机declarative team YAML是另一种高级管理操作。** `server/headless/team-file.ts:17-35,40-78`可命名engine secret引用、model、approval、computer/cwd/tool scope/skills/team prune；`server/headless/team-apply.ts:40-86`patch模型与approval，`:425-455`export模型/approval/工作目录/skill文件。它比分享模板权力大得多，不能让不可信Markdown导入走同一“自动apply”入口。

对v4：目前原始聊天md导出有定义，但完整团队蓝图导入/导出是可借鉴增量，可排P1。建议文档写清用户可读MD+版本化受限manifest、preview差异/secret检查、fresh identity映射、paused routines、无权限继承/无自动install/无本机路径静默绑定；原始聊天导出、团队模板、私人全量备份分别定义，不默认把私聊/个人记忆打包。精确本地Agent绑定需在目标机器重新probe及授权，导入名字不能复活原设备的执行凭据。

## 6. MCP控制面：外部Agent可协作控制，不能替人审批

- `scripts/mcp-server.ts:8-29,32-57,91-117`：stdio桥到明确HTTP origin；拒url内凭据/path/query；带token必须pin origin/port，发现只验证health app；默认request timeout30秒。
- `:156-458`工具包含health、list bots/channels/models、bounded messages/search、send、create/update profile/channel/task、set exact model、interrupt、wait；未列approve/delete/credential/team-import/VM lifecycle工具。`docs/mcp-server.md:14-15,48-78`也说明这些留在人类App，packaged变更需paired session。
- `:905-941`消息读/写先确定taskId并校验属于该channel；inactive task的旧server拒写，防当前选中会话变动误投。
- `:1056-1092`wait显式pin目标task，返回status、真实job state、bounded messages/hasMore；settled并非completed，needs-user/stalled/failed/timed-out另表。正适合新App接本地Agent/外部编排者。
- `:1102-1106`改model要求task属于bot且未busy；外部控制面不是同名模型的静默fallback通道。

对v4：§11本地adapter和§13共享后台服务已有，但统一语义MCP入口是可借鉴增量。它应调用同一canonical owner/API，复用requestSource=agent、principal、scope、预算、sendId幂等和版本；对外只给read/send/wait/cancel等受限语义，不给任意SQL/shell/批准自己的审批。外部MCP调用成功是accepted，不当已完成；控制面必须支持精确工作ID，而非只按Bot当前会话。

## 7. 建议进入设计的增量与保持不变项

| 项 | v4已有 | 建议处理 |
|---|---|---|
| 相关性路由/模型失联/置信/预算 | §7/10/18.1 | 增来源可见、lead诊断fallback；保留noop与本地训练评测，不移植0.6为K-IM承诺 |
| 结构交接/返回原工作/完成核验 | §7/14/18 | 增“已交接会自动返回”的用户状态；完成仍验产物与原目标，不采用模型自报即完成 |
| 主动check/research/单owner | §8/9/13 | 明确无变化不推理、确定性提醒免模型、失败保持cursor；小K仍同owner |
| 群目标/事实/系统规则 | §6/12/15 | 清楚区分source fact与shared instructions、改变规则需用户授权 |
| 团队MD模板 | 仅原始消息导出，不等价团队模板 | 单独P1受限蓝图与导入预览，不增加P0执行底座范围 |
| MCP协作控制面 | 服务/API、local agent adapter | 后续统一语义MCP，精确task ID、agent权限、paired来源、等待真实job终态 |

不可复制：静默自动fallback执行授权、无noop的Auto、拿Jev概率当K-IM训练结果、13回合硬默认、把模型completed当证据、无host重新验证的导入绑定、由分享文件继承Full access/个人记忆、多个服务共同写同库。

本轮结论是产品与源码参考，不是对OpenMausBot运行质量、所有安全路径或本地Agent支持的验收。未按其隔离fixture跑过，不宣称“验证通过”。

### 补充：导入默认和认证已追加查到server源码

- `server/package-import.ts:265-270`连接headers按valueNames生成空串且enabled=false；`:294-303`仅persona profile加目标机器selection创建新Bot；`:327-338`approval只记suggestedApproval，不应用原授权，composio=false/connectorTools={}；`:417-431`routine input明确enabled=false。以上实现与“导入后不自动运行/连接”文档吻合，不只停留在UI预览。具体安装默认approval Full access/hosted Ask仍需追其defaults/真实fixture，本轮不宣称全链运行验证。
- `server/request-auth.ts:571-609`会话凭据优先；cookie要求same-origin、cookieOnly不能借bearer、requiredScope不符403；`:612-614`已撤销/过期session不得降级为loopback owner；`:630-634`packaged loopbackMutationToken存在时public mutation必须来自desktopOwner，否则403；`:636`开始service trust另限允许集。新App共享服务应取这些“已认证principal+能力范围+撤销不fallback”约束，不能因为127.0.0.1就信任任意本地Agent的提权请求。
