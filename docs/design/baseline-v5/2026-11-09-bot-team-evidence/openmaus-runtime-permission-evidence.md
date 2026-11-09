# OpenMausBot：执行、审批、恢复与 Computer 边界证据

研究者：GPT-6 Astra；2026-11-09。远端只读路径 `/Users/kai/projects/refre-proj/OpenMausBot`，固定完整 SHA **717343f2869d6179e21a301c3b5920953937e231**。全部读取用 `git show/git grep` 指向该提交，最后 HEAD 再核对一致；无拉更新、切分支、安装依赖、执行产品/模型、读取 .env/凭据/用户数据。根 AGENTS 已读；目录清单只有根及 apps/docs 的 AGENTS，本次读 server/shared/electron/docs，不涉及 apps/docs。根要求 server/conversation 行为须隔离 fixture 验证；本次未运行，所有“已有”为源码事实，不代表真实平台、安全或安装包通过。对照 xiaok 产品设计 v4（2026-11-09）。下列路径均相对 OpenMausBot 根。

## 1. 真实 driver 与单 harness 的含义

**不是只有 README 提到的几种引擎，也不是一套权限策略覆盖所有 CLI。** `server/drivers/builtIn.ts:30` 的实际注册包含 Claude、Codex、Kimi、Gemini、Grok、OpenCode、Pi及其它 ACP/API driver。Kimi import在`:8`、注册在`:34`，真实实现 `server/drivers/acp/kimi.ts:546` 声明 kimiAgent，`:570` 以 `[-m model, acp]`启动，`:593`交给共同 ACP driver。这里只证明接线，未验证本机 Kimi 登录/版本/推理。

`server/index.ts:812`创建 ProviderRegistry；`server/harness/registry.ts:106`维护 instanceId→live/shadow 条目，`:132`以 driverKind选实现，`:135`加载配置。`server/contracts.ts:244`统一 ProviderAdapter 的 sendTurn/interruptTurn/respondToRequest（`:297`），但 capability逐项声明：模型切换、MCP、图片、steer、strictResume、guest confinement、engineAdmission，不能用“支持CLI”一个布尔值替代。

`SendTurnInput`在`server/contracts.ts:123`携带threadId和botId（同thread名不能跨Bot共用资源）、approvalMode、当前权限读取函数、toolScope、resumeCursor/sessionReset、engineAdmission、recoveryText及persona。`:130`要求每次续接重申权限；`:132`明确原生引擎可能保持本轮起始权限到下一轮，接口本身不保证热撤销。

因此可借鉴的是**一个会话生命周期和归一事件合同，多个协议适配器**。并非强迫所有Bot共享进程/会话，也不是用统一工具描述代替真实权限。v4已有共享核心/单owner/能力矩阵，重造 registry/harness **skip**；只补下面的合同细度。

## 2. 审批：可学的确认机制与不能复制的策略

- `server/contracts.ts:119`区分 allowed-once/rejected/answered/unavailable；`:299`消失的请求返回unavailable，不能伪造允许。`:279`只有真实人类审批通道可达才声明localComputerMcp，bypass实例不能靠挂了MCP就说“支持本机审批”。
- `server/drivers/acp/core.ts:740`只接已知permission request；`:747`映射供应商给出的allow_once/reject_once等optionId，`:753`缺选项发runtime.error而不猜。该代码优先once但也可能选同前缀其它种类，所以仅能借鉴“确认实际语义”，不能照搬成严格单次授权证明。
- `server/drivers/codex.ts:192`读取Codex实际返回sandbox policy；缺字段或类型与请求不符在`:196`/`:199`拒开始。**这比只把 --sandbox 参数写进argv更有证据价值。**
- `server/host/live-approval.ts:12`每次审批读取保存的conversation权限，保留正在运行的modelSelection。v4已有授权revision/跨await校验与撤销，原则 **skip**，新增各driver“生效时点”的探针即可。

**不采纳：** `shared/approval-mode.ts:71`默认full；`:24`–`:34`允许Full跨engine静默携带，custom才强制回Ask。`server/runtime/level.ts:30`可把person/routine来源Chief的更宽权限传给子工作。`server/drivers/codex.ts:161`full实际映射never审批+danger-full-access。它们是该项目的产品选择，和v4“角色不授权限、换绑定重新验证、权限交集、有界外发授权”不一致；不能作为v4安全依据。

## 3. 中断、恢复与团队终态

`server/runtime/runtime.ts:498`先保存本轮结果，再检查awaited children、尚未携带的新结果（`:500`），有未完成/未消费结果就进waiting（`:504`），否则才settle。**模型stream结束不等于委派树完成**。可借鉴“父turn结束但children未完/晚到结果→等待→一次汇总”的合同测试；v4已有执行/交付/验收分层及子运行owner，不再造第二套团队终态writer。

恢复分两层：

1. 原生会话：`server/contracts.ts:283` strictResume承诺精确原session、拒绝，或明确标rebuilt的recoveryText重建，不能静默空会话。ACP `core.ts:1269`读取cursor，`:1283`用session/load或resume，`:1327`才new。这些是driver实现合同，不能仅据静态`runtime/capabilities.ts:27`的resume:true就说真恢复通过。
2. 工作树：`runtime/runtime.ts:79`启动reconcile，needs_input重挂卡片；`:97`已派子工作者等待；`:103`有已记录outward action则interrupted；`:106`第二次被切断不再重跑；其余`:110`可排一次rerun。**不复制“一次rerun安全”推论**：未观察到外部动作不证明没有动作，v4应保留unknown不盲重放。

取消也分层：ACP `core.ts:1191`先session/cancel，5秒后尝试endUncancelled，并区分cancelled/stop_failed；这有可借鉴的失败表达。反之 runtime`:656`先持久terminal，`:670`才abort并移除live handle，**该terminal不是全部物理子进程已退出的证据**。v4已有stopping/unknown和精确PID回收，应保留，不照搬“cancelled即清理完”。`server/host/person-stop.ts:62`只认可人类来源纯停止命令，Bot/app文字不直接当停止授权，可作为兄弟输入路径负例。

## 4. Host / Local VM / Cloud：至少三种不同事实

**模型引擎在哪运行、操作哪个Computer、CLI是否被OS隔离，是三条轴。** 不能选择Local VM后就声称本机CLI、凭据和其它工具都在VM内。

- 本机Computer：`server/desktop-computer.ts:21`仅接指定grant类型，并逐次decode connection；真正接线是`server/index.ts:1421`的Electron utility parentPort和`:1490`接收。此入口不等于HTTP传个hostId就授权。`server/local-computer.ts:29`把连接包装为MCP proxy带控制token，scope固定local-computer。v4可复用“可信主机提供能力，不从消息payload取得授权”的概念；不能把这个Electron子进程结构原样套到两App共享后台服务，需要自己的认证握手。
- 本机允许：`server/your-computer-consent.ts:1`描述每turn询问，但Full例外；`:44`pending带thread/generation，`:84`先落卡片再登记等待。可借鉴迟到审批与generation取消测试，**不采纳Full自动代表本机电脑授权**。
- Local VM：`server/container-computer.ts:1`自动化driver在容器内，`:48`枚举Docker/Podman/Apple container；`:330`判断已停容器可恢复，`:651`校验viewer仅loopback。这里只证明Computer容器边界源码，不证明引擎shell也在容器。`server/local-vm-lease.ts:17`的lease会在TTL到期或bot不busy时清空，属于使用席位管理，**不可替代v4执行fence/物理停止证明**。
- 引擎沙箱另有BotBox：`server/bot-box/detect.ts:63`在非Cloud默认off，非Linux也off；Cloud默认尝试bubblewrap，能力不足报告off原因。`server/bot-box/box.ts:248`未启用返回null；`server/procs.ts:185`决定是否wrap，`:215`实际spawn boxed或原始命令。故不能把Linux Cloud的BotBox能力归给macOS本机CLI，或把“使用云电脑”归给全部进程。
- 沙箱到host的桥也不是万能代理：`server/bot-box/harness-gate.ts:26`仅放规范化`/api/internal/`前缀，`:46`其它403，`:74`拒upgrade；它仍依赖内层per-turn认证，路径白名单不等于授权。
- Computer选择`server/computer-selection.ts:13`尊重用户显式pin，`:23`Auto优先保留已选/当前Computer。可借鉴“不悄悄换电脑”的产品表达；v4已有不静默换host/binding，因此不扩首发云主机范围。

## 5. 给v4的最小增量

| 处理 | 建议 |
|---|---|
| 新增窄合同 | 将“支持恢复”细分为原生原session续接、授权上下文重建、仅历史可读、不可恢复；重建必须显式标记，原审批/能力不能随cursor自动恢复。 |
| 新增窄探针 | 请求权限→引擎实际确认权限→prompt已接收/工具可执行分阶段记录；缺resolved policy拒启动；审批丢失/unavailable按拒绝；测试降权在原生长turn中的真实生效时点。 |
| 新增窄展示 | 工作详情分别显示执行host、Computer目标及隔离范围/未验证。只在能力启用时显示，不为参考项目提前引入VM/云产品。 |
| 补现有用例 | 父stream结束而child未完；child结果晚到；停止后审批晚到；同bot不同thread/同thread不同bot；resume失败绝不静默开空session；非零退出/stop_failed保持未知。 |
| 已有等价skip | v4单writer、Bot与Run分离、能力矩阵、权限交集、持久消息/审批、预算、子执行取消、产物验收、跨重启unknown；xiaok Room claim/manifest/物理release已有，不迁入另一套runtime.db。 |
| 不采纳 | 默认Full、Chief向下扩权、跨engine静默携带Full、仅凭outward日志空就rerun、TTL释放即接管、逻辑cancelled即物理已停、VM/Cloud标签等于所有本地CLI隔离。 |

建议只修改上述合同/验收细节，不新增大架构或默认权限。源码未验证部分由P0a真实driver/host探针收敛；禁止将OpenMausBot能力表或测试文件存在写成xiaok/KTeam已通过。本文不批准任何运行、部署或权限变更。
