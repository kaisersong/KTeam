# OpenDuet 主动性与多 Bot 协作：本地源码证据

审阅日期：2026-11-09（Asia/Shanghai）。参考根目录位于 kai-mbp `/Users/kai/projects/refre-proj/OpenDuet`。

- Git HEAD：`60fd4c71d9d82e13739dce00827278154d13c947`。
- 初始 `git status --short` 空，工作树干净；未修改该参考仓库。
- 未发现仓库根 `.codegraph/`；`git ls-files` 未列出 AGENTS.md。适用的上级 `/Users/kai/projects/AGENTS.md` 已读。远端 rg 不在 PATH，且 `/opt/homebrew/bin/rg` 不存在，改用 `git ls-files` / `git grep` / `nl -ba`。
- 本文为源码/文档审阅，未运行服务、模型、例程、评测或 GUI；未读 .env、配置凭据或真实连接账户。所有数值为代码常量或已提交文档宣称，不是本轮实测结果。
- 以下行号均相对上述参考根目录，绑定该 HEAD，不应当作当前远端上游最新版。

## 1. 最重要的结论

1. OpenDuet 的“主动”有至少四条真实链路：打开 Chat 触发晨报；默认四小时的后台研究；Bot 自己注册单次 follow-up；群消息/@Bot 接力。四者的触发、权限和投递方式不同，不能统称常驻自主思考。
2. 晨报是“每天首次打开 Chat 后主动打招呼”，不是固定08:30无人打开也执行。后台研究确实由 server sweep 驱动，不依赖浏览器持续打开。
3. 已有多 Bot 群和 durable handoff，但缺省群发言路由是“未点名就所有 Bot 按群成员顺序依次回答”；不是根据目标自动判断相关成员。Bot 回复中的 @Peer 会唤起下一跳，有权限、深度和扇出限制。
4. OpenDuet 的用户配置可以很少，但内部包含强约束的统一系统提示、只读/执行隔离与持久队列。不能从“用户只填名字”推导底层无协作协议。
5. 很多能力 xiaok 已有等价 owner；优先补用户感知和缺失触发，而不是整体引入另一套数据库、Intelligence、Docker电脑和调度器。

## 2. 晨报：有源码支持，但触发语义需要准确

| 事实 | 文件与行号 | 对新设计的意义 |
|---|---|---|
| 后首日的每日首次打开 Chat，触发 server claim；用户正在输入/执行则让路 | `openbot/app/src/components/shell/morning-brief.tsx:15-45`、`:49-63` | 这是打开时的主动展示，应与真正后台到点运行分开定义 |
| HTTP接口接 agentId/local date，server 构造固定晨报请求，不采用客户端传入正文 | `openbot/server/src/channels/routes.ts:1445-1474` | 人工触发口不能成为任意后台提示/权限写入接口 |
| 按 person+Bot 的 direct conversation Claim 日期，`morningBriefOn < date` 防不同设备日期交替重复；claim与work item插入同事务 | `openbot/server/src/channels/routes.ts:609-677` | 可借鉴跨窗口/重启幂等键；xiaok 应沿已有timed run做幂等，不加第二晨报owner |
| 每个 claim 使用独立 token，生成稳定 work key，事务发 pg_notify；浏览器离开后可继续 | 同上 `:650-675`；`openbot/server/src/channels/morning-brief.ts:3-7` | 排队不等于已发给用户；消息送达/可见/已读须分开 |
| 每日日期值必须真实YYYY-MM-DD且距server UTC日期≤1天 | `openbot/server/src/channels/morning-brief.ts:11-25` | 多端时钟不直接信任；新产品选择用户明确时区的schedule owner |
| 晨报工具返回needsYou/canWait/calendar/couldNotCheck/checked，未知来源不会当作“没有事项” | `openbot/server/src/openduet/brief.ts:12-22`、`:48-58` | 直接复用诚实来源覆盖状态，不让模型顺滑掩盖断连 |
| 邮件读取上限50并说明遗漏 | `openbot/server/src/openduet/brief.ts:87-95` | 同样要求xiaok近期消息采样说明，不能称完整全量周报 |

README `Features and Capabilities` 与上述“首次打开Chat后晨报”一致；总览“starts your day”不能扩张成已实现固定时间推送。

## 3. 后台研究：同队列、只读、增量、有事才说

- `openbot/server/src/proactive/engine.ts:2-21` 声明并通过真实代码实现“研究→建议→check-in→用户Start后task”。使用既有统一 WorkQueue/AG-UI headless turn runner；不是另建orchestrator。
- `openbot/server/src/index.ts:2162-2195` 建立research专用runner，3分钟turnTimeout；`:2212-2270` 接store、queue、scope、task、checkIn；`:2272-2284` 用repeatAfterEach每60秒sweep。
- `openbot/server/src/proactive/types.ts:6-29` 设置间隔15–1440分钟，默认240分钟；每次最多5建议、10记忆（`:13-15`）；研究focus最多1000字。
- `openbot/server/src/proactive/store.ts:372-405` 用条件UPDATE推进nextRunAt来claim due，多个sweep不能同时claim同一设置；`engine.ts:1220-1244` 随后offer work、并行drain research/task/first-day/morning。
- `engine.ts:255-316` 增量window从上次成功run开始，首次或失败后回看24小时；提示只读新增邮件/今明日历，并明确大多数轮次应无事、不记录、不打扰。
- `engine.ts:319-327` sameTitle只做大小写/空白/尾标点归一，不是语义去重。`:414-441` 拒绝仍open或14天内dismissed的相同标题；提示词另禁止同义重提。新设计不应声称能从此代码获得完备语义去重。
- `engine.ts:443-500` 生成建议可带实际成功read provenance；form_memory强制匹配本轮audit成功读取工具并记录observedAt。不把模型“我查过”当证据。
- `restriction.ts:97-145` 每次从当前tool catalogue计算只读allowlist，执行时再校验。`:66-73` check-in只允许offer_task；不读连接器、不跑电脑、不执行建议。
- `engine.ts:507-519` 先notify稳定id，再markDelivered；`:528-558` 只有本轮新建议才发check-in，私聊忙或不可达可跳过check-in但保留建议卡片；`:561-617` scope/setting校验、研究结束与错误状态记录、失败前已形成建议仍可投递。
- `index.ts:2235-2258` check-in在person当前Chat中作为Bot真实回复记录activity；不伪造用户说了那句话，输入frame是内部turn引导，Bot输出才作为可见消息。

可靠性边界：这些证据显示持久队列、稳定key、claim等约束，不能据此保证外部副作用exactly-once。新文档应分别定义queued、running、completed、message persisted、notification accepted、read；恢复未知状态不能盲重放发送。

## 4. 默认启用和用户控制

- `openbot/server/src/memory/defaults.ts:1-28`：用户与自己单一Bot私聊后，默认建立四小时research；已经连接且Bot有read授权的app可成为memory source。第一轮延后一个interval，不与当前聊天争执行。
- `defaults.ts:238-278` 在每person/Bot advisory lock下检查opt-out并insert，已存在enabled=false也不会重建；删除写default_opt_outs，同锁避免删除与adoption竞态。
- `defaults.ts:293-308` 明确只在channel里恰好一个Bot时adoptResearch；group不会默认研究。`index.ts:1373-1378` 更排除task conversation和OpenDuet named workstream channel作为研究默认投递口。
- `defaults.ts:15-18` 默认source按person+Bot隔离，导入事实未review前不镜像Intelligence。`:27-28` 两个部署开关只阻止新增默认，不取消已有rows。
- `proactive/types.ts:17-34` 用户可设置focus/interval/enabled；engine `runNow:1015-1034` 有10分钟gap和时间桶key。删除语义与关停语义区分（store.ts:355-370）。
- 在本轮查看的proactive设置schema、claimDue和engine run admission中没有quiet-hours字段或时段gate；针对proactive/delivery/agents/db-schema的关键词查询未找到业务勿扰实现。不据此断言全仓没有任何系统级免打扰。新产品必须独立定义“静默通知”与“停止执行/排队”的区别，并与xiaok现有quiet规则接合。

## 5. Bot自己“稍后回来”：比晨报更值得借鉴

- `openbot/server/src/agents/wake-up.ts:1-15` follow-up用于“我一小时后再查构建”：同一持久work_items队列、普通headless runner，带暂停/工具审批治理；actor/Bot identity来自建立工具的run而非模型参数。
- `wake-up.ts:32-38` 单次1分钟至7天；每person/Bot同时pending最多5，每天可schedule最多20。
- `wake-up.ts:150-199` serialized事务与cap；`:334-347` 暴露schedule_follow_up并要求reason、in_minutes/at二选一，另有list/cancel；reason可展示给用户。
- `wake-up.ts:400-405` 明确执行失败不自动重试，以免已经有副作用的turn重复；`:467-500` 到点选指定channel或direct，run后将Bot回复记录回conversation并单独notify。

这能支持新App的承诺/依赖跟进。产品上应把“Bot记得回来”与“让用户手工创建routine”分开；实现仍复用一个scheduler/queue，具备可见原因、取消、预算和恢复状态。

## 6. 群与Bot互调：确实有，但路由较朴素

- `openbot/server/src/channels/group.ts:1-19`：Intelligence每thread单agent，因此每Bot独立group_bot_threads，用户看group_messages共同转录。成员权限每次请求/turn重验。
- `group.ts:1187-1216`：用户点chip agentId优先，其次正文@Name；没有点名则所有成员按群顺序依次回答。`:1230-1232` 明确one after another，后者看前者发言。**不要描述成按目标/相关性自动选择发言人。**
- `group.ts:460-497` 解析@完整名称、忽略自己、同起点最长名称优先、避免邮箱/词前缀误匹配。
- `group.ts:650-722` Bot回复@Peer→下一跳GROUP_TURN_KIND入共享queue；沿同一depth/fanout/mayAddress grant与audit拒绝/接受路径，key来自replyId+peerId；不是无限广播。
- `openbot/server/src/agents/handoff.ts:32-75` 私有Bot交接使用task/constraints/expecting结构化信封，而非一段自由文本；from/run/thread authority来自已签发run。Handoff提供可读refusal而不直接throw沉默失败（`:8-16`）。

适合借鉴的是“单独Bot记忆+共同群事实”“显式交接信封+稳定因果链”“可读失败/停止状态”。对用户“只取名字就按目标工作”的要求，新产品还必须设计统一目标上下文、职责推断、相关成员唤醒、主动认领与分工收敛，不能把OpenDuet未点名全员回答当成完成该需求。

## 7. 不能直接复制的OpenDuet提示与部署取舍

- `openbot/examples/openduet/agents.yaml:43-104` 内置长system_prompt与示例；用户不需要手工配置，不代表无默认规则。
- 其中`:54` 要求“非用户要求不回头纠正早前答案”，`:102` 普通Chat总计35词。这适合其手机个人助理取向，却与本任务群内成员主动质疑、更正旧事实相冲突；不要复制为统一协作规范。应该保留短而有用的发言，但允许有证据的主动更正。
- `agents.yaml:118-133` remote-ag-ui是bring-your-own-agent入口；README约210以后解释任何AG-UI endpoint可接。这不等于可直接绑定任意本地CLI，仍需由xiaok既有可验证的本地agent adapter/host来桥接。
- README Quick start明确需要CopilotKit Intelligence project来保存threads/memory，配Postgres、Docker每Bot电脑，模型/connector另行授权。不能把“开源/self-host”写成全本地、零外部依赖，不能无必要引入这套基础设施替换xiaok现有owner。

## 8. 分诊评测：借鉴生产入口，不能照搬准确率

- `openbot/server/src/openduet/triage.ts:3-15` 两段：规则只判can_wait；剩余给模型；每条记录rule/model decidedBy与reason（`:43-47`）。规则对noreply/列表头不做宽泛降级，避免漏安全通知（`:75-108`）。
- `evals/triage/README.md:3-27` 生产triage代码+62条虚构邮件，27 needs-you/35 can-wait；含钓鱼/提示注入/团队security group/供应商令牌轮转等难例，未使用真实邮件。
- `README:36-42` 已提交报告宣称某些模型较高precision/recall，同时明确小样本、同作者label与prompt、只作回归不能证明真实收件箱准确率。本轮未跑，不作为实测证据。
- 新App的K-IM可先用于已验证的关注/待办分诊；Bot路由/发言决定是不同任务，需要单独数据、停手/误唤醒/遗漏/成本度量。不要把已有K-IM评分直接当成Bot授权或协作完成判据。

## 9. 与xiaok当前实现的等价与增量建议

xiaok参照 `/Users/kk/projects/.worktrees/assistant-kim-skill` HEAD `5e77c08372ec7c1fd190d1e554153acdce02fae6`，本轮另读有限实际源码：

| OpenDuet启发 | xiaok自己读到的等价 | 本设计应处理的增量 |
|---|---|---|
| needs-you/can-wait、source coverage、用户Start task | `desktop/electron/assistant-inbox-service.ts:18-22,35-44`，store`:27-31`已有分诊、brief、隔离工作thread、start幂等与task状态投影 | 复用，不另起Inbox真相源；补事件/跟进触发及群感知 |
| durable morning、quiet/current/去重 | `desktop/electron/assistant-morning-delivery.ts:24-48` 已有scheduler完成投递与持久ledger；service.ts bootstrap已有morning/evening unified scheduled action | 复用schedule owner；新App/小K UI都消费统一消息投影，不叠加on-open第二次推理 |
| 首次打开看到Bot先发消息 | 最新xiaok产品任务已增加晨间message投影和固定test持久消息；此项状态由主代理最终证据确认 | 无需为了OpenDuet再做另一种顶部卡片；主动输出要进入真正私聊/群消息流 |
| 自动研究+单次自唤醒 | 本轮读到的xiaok assistant service未显示通用per-Bot research与自主follow-up工具；不能据有限搜索宣称全xiaok缺失 | 与负责xiaok源码研究者共同核对后决定扩展现有owner，禁止双scheduler |
| Bot群+handoff | OpenDuet有实现；xiaok本地Agent/Room由另一研究者完整核实 | 避免双群转录/多库共写，保持身份/主机/权限/因果ID一致 |

建议设计验收至少覆盖：无新事实保持安静；依赖解除唤醒相关成员；未连来源准确说明；相同事项不刷屏；用户Hide/暂停不被重新启用；睡眠/重启不重复外发；聊天忙时不抢输入；群内更正能覆盖旧基线；单次follow-up可见可取消；模型额度不足后明确降级而非无限重试。

## 10. 审阅边界

没有修改代码、启动模型/服务/后台进程，无自有测试进程需要回收。远端只读SSH命令均结束。未抓取上游新提交，不推断此checkout之外行为。未运行已提交tests/evals；本文中的“有实现”指源码路径成立，不等于真实部署已验证，也不代表其所有恢复/审批/安全路径无缺陷。
