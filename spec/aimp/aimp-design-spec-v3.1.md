# AIMP 协议设计规范 v3.1

**AIMP — Agent Intent Messaging Protocol（智能体意图消息协议）**

AIMP 是一套面向 Agent 时代的协作通信协议：以即时消息（IM）的会话形态为顶层，在消息信封内嵌渐进结构化的意图内核，使人与 Agent、Agent 与 Agent 能够在同一会话空间中协商、委托、交付与验收。AIMP 定义的是**信任域内**的协作层；信任域之间通过不透明网关衔接。

> 版本说明：v3.1 基于 v3，落实 2026-11-07 的 codex、xiaok、kiro 对抗性评审决议 D01–D39 及最终确认。原稿与评审过程保留，不覆盖 v3。文档修订说明见附录 D，真实签名测试向量见附录 B。
>
> 规范用语：**必须 / 不得**为一致性约束；**应当**为强建议，偏离须声明；**可**为可选。profile 限制优先于事件是否注册：登记不代表可以跨档执行。本文仍为设计规范，配套签名向量不等于完整实现或全套兼容性认证。

---

## 1. 定位与适用范围

### 1.1 定位

- AIMP 是构建在现有消息传输（Matrix、XMPP、自有 IM 系统等）之上的**协作 profile**：它不发明新的传输层，规范的是身份、信封、言语行为、承诺状态机与安全模型。
- AIMP 适用于**信任域内**的多方协作：同一组织、同一产品、同一账单主体，或已通过握手建立信任关系的一组参与者。域内默认过程可见，但可见性是分级的（私聊协商、历史回溯、密级脱敏等限制见 §13.5、§14.4），不承诺无差别全透明。
- **跨信任域**协作不使用透明会话：由域边界网关以不透明模式衔接（见 §16），只交换承重消息与结构化载荷，域内过程不出域。

### 1.2 与现有协议的分工

| 协议 | 层 | 与 AIMP 的关系 |
|---|---|---|
| MCP | 工具层 | 不变：管单个 Agent 与工具/数据的连接；工具侧 / MCP 网关必须验能力令牌（§14.1） |
| A2A | 调用层 | 域内：作为 AIMP 承诺内的一种调用句柄；跨域：作为边界网关的对接方式。**承诺状态的唯一真相源是 AIMP 事件链**，A2A Task 状态经适配契约回写（§17.6），不构成第二状态机 |
| ANP / AGNTCY | 身份与发现 | 其去中心化身份思路可作为跨域身份的远期选项；域内身份用 §5 的简化方案 |
| FIPA ACL | 历史参照 | AIMP 复用其言语行为类型系统，弃其形式本体与心智状态语义（见 §3.3） |
| Matrix / XMPP | 传输层 | 首选承载：房间、联邦、事件模型与 AIMP 的房间/线程/事件链概念直接对应 |
| 各 IM 平台 Bot API | 接入层 | 仅作人类入口与通知通道（见 §17.2、§17.5 入口桥），不作 Agent 间协作主通道 |

### 1.3 非目标

- 不定义新的传输协议、编解码或网络拓扑。
- 不提供跨域仲裁：跨域纠纷回归合同与法律渠道，协议只保证证据（签名链、计量回执、状态链、网关存证包）的完整可验。
- 不规定 Agent 内部实现（模型、记忆、工具），只规定其在会话中的可观察行为。

---

## 2. 设计原则

1. **人可读优先**：任何消息去掉结构化块后，人读正文应能完全理解发生了什么。审计、旁听、复盘都依赖这一条。
2. **结构渐进**：结构化程度与风险、金额、不可逆性挂钩，不搞一刀切的强 schema。闲聊可以只有自然语言，付款必须有完整契约块。
3. **结构化事件链即状态**：协作状态只由已定序的结构化事件确定性派生；自然语言正文与附件永不进入状态折叠，只作证据。摘要可作缓存，但须标注覆盖区间与哈希，冲突时以事件链为准。
4. **承诺必须显形**：闲聊无约束力；一旦进入承诺（接单、报价、交付、付款），必须有显式的注册表事件（§8.2）作为凭据。
5. **人类主权**：人类参与者的消息在优先级、打断权、否决权上高于 Agent；审批是协议消息，不是某个产品的 UI 功能。人类话语转为协议效力的路径受 §13.7 约束。
6. **默认最小授权**：执行权限只来自能力令牌（可过期、可撤销、可衰减），跟随会话与任务授予，不授予"这个 Agent"整体。
7. **传输无关**：信封与状态机独立于传输层定义，可运行于任何能提供房间、线程与可靠投递的通道上。
8. **宽进严效**：宽松地接受任何消息（收得下、读得懂），严格地授予协议效力（条件不足，效果不给）。不满足效力条件的消息"受理但不生效"并给出回执，不走报错；**拒收式硬失败只限于 §15.1 的穷尽清单**。刚性只出现在承诺层。
9. **注意力是稀缺资源**：人类注意力按预算管理（§13.6）。任何新增人类动作点的机制，必须在所在小节写明对冲方案（合并、批量、常设授权、抽检），并纳入 per-task 人类动作指标的报告（§13.6）；**对冲不得以降低审批要求实现**。

---

## 3. 为什么以 IM 为顶层

### 3.1 原语同构

| IM 原语 | 在 AIMP 中的角色 |
|---|---|
| 联系人 / 通讯录 | Agent 的常驻关系与发现（区别于一次性服务发现；发现路径与防枚举的协调见 §5.3） |
| 在线状态（Presence） | 可用性、负载、接单状态（扩展定义见 §6） |
| 单聊 | 人↔Agent、Agent↔Agent 的点对点通道（含私下协商，见 §13.5） |
| 群聊 / 房间 | 多方协作空间；自带发言、旁听、拍板的社会机制 |
| 线程（Thread） | 任务上下文与审计轨迹的展示边界；承诺真相单位是 task_ref（§10.2） |
| @提及 | 显式寻址与责任指派；与"投递到"严格区分 |
| 引用回复 | 消息因果链；结果可回溯到源请求 |
| 表情回应 | 零成本确认，不唤醒完整推理；不得承载安全关键决定。表情回应不进入 AIMP 信封层：由传输层原生 reaction 承载，不产生 AIMP 消息、不占序号、不进状态链，任何需要协议效力的确认必须改用显式消息 |
| 文件 / 图片附件 | 交付物与证据（升级为版本化 Artifact，见 §7） |
| 草稿 / 审批卡 | 人类在环的否决与放行点（协议化见 §13） |

这套原语是为"意图不完整的多方随时间协同"设计的，恰是协作的真实形态；RPC 家族的协议为"参数完整的两方一次性调用"设计，那只是协作的一个瞬间。因此 AIMP 以会话为顶层、以调用为其内的一种消息。

### 3.2 语义理解带来的晚绑定

- **晚绑定**：消息可以先到、结构后补——先用自然语言说清意图，执行方在需要时再追问或自行结构化。
- **容错**：字段缺失、说法含糊时，对方澄清而不是报错退出；失败模式从"抛异常"变成"问一句"。
- **低成本演化**：新的协作模式先在自然语言层跑通，高频稳定后再沉淀为结构化类型，不需要双方同步升级 schema。

晚绑定只作用于**理解**，不作用于**效力**：推断出的结构永远不产生协议效力（§8.2）。

### 3.3 对 FIPA ACL 的取舍

FIPA ACL 的失败源于四点：封闭本体须预先对齐、每条消息强制归类、语义以不可验证的信念/意图定义、无自然语言兜底。AIMP 逐条反之：

- 语义由**可观察效果**定义，且严格限于机器可判定谓词与状态迁移（见 §8.3）；
- 言语行为是软标注：不声明可推断用于展示与提示，归类失败不等于通信失败；
- 自然语言正文永远是兜底通道；
- 刚性只保留在权威事件注册表所列事件上（见 §8.2）。

---

## 4. 架构总览

```
┌──────────────────────────────────────────────────────┐
│ 会话层（AIMP）  身份 · 房间 · 线程 · 消息流 · 人类在场 │
├──────────────────────────────────────────────────────┤
│ 承诺层（AIMP）  提议 → 接受 → 执行 → 验收 → 结算      │
├──────────────────────────────────────────────────────┤
│ 调用层（A2A）   已明确任务的委托与生命周期             │
├──────────────────────────────────────────────────────┤
│ 工具层（MCP）   单个 Agent 连接工具与数据              │
└──────────────────────────────────────────────────────┘
   横切：身份与密钥 · 能力令牌 · 计量与额度账本 · 信誉 · 反垃圾 · 审计链
   域边界：不透明网关（§16）——过程不出域，只过承重消息
```

核心概念：

- **信任域（Trust Domain）**：共享同一身份根、同一审计与同一责任主体的参与者集合。一个用户/团队/组织的全部 Agent 通常构成一个域。
- **房间（Room）**：成员与权限的边界。**线程（Thread）**：成员可见性与展示的边界。
- **承诺实例（task_ref）**：承诺状态的唯一真相单位；一个 task_ref 承载一条承诺状态链（§10.2）。子任务可放子线程（推荐）或同线程。
- **定序权威（Sequencer）**：每个线程唯一的排序与提交点，seq、term、prev_hash、fencing、检查点均以线程为作用域。task_ref 固定绑定创建事件所在的权威线程（§10.2），状态从该线程事件子序列派生。
- **会话契约（Session Profile）**：握手锁定、可版本化变更的会话级参数（§5.5）。

---

## 5. 身份、名片与信誉

### 5.1 编址与身份根

- 参与者统一编址：`human://<域>/<名>`、`agent://<域>/<名>`。
- 域内身份根采用简化方案：域名 + WebPKI + `/.well-known/` 绑定端点与公钥。跨域身份（DID 等）为远期选项，不在核心规范内。
- 每个 Agent 必须声明所有者（`owner`）：它代表哪个人类/组织行事。无所有者的 Agent 不得发送 L2+ 消息。
- 每个主体有唯一**主体锚**（`principal_anchor`）：信誉、敞口、配额、黑白名单一律以主体锚为归宿键，不以实例、别名或假名为键（§14.4）。
- **两个独立维度，不得混用**：消息的结构等级（L0–L3，见 §9）描述单条消息的结构化程度；主体的发言能力描述该主体在会话中被允许使用的最高等级，由握手状态与会话契约决定（见 §5.5）。本规范中"按 L0 对待"一律指**单条消息只按 L0 效力处理**，不指主体被降格。

### 5.2 密钥、轮换、吊销与所有者转移

- 会话密钥由 principal 签发，绑定主体锚、Agent、权限与有效期；Bot 不持有 principal 的长期密钥。密钥从属关系、轮换、吊销及恢复记录进入身份控制日志，并被受影响任务线程引用。
- **轮换**不延长消息 exp 或授权期限。旧公钥与当时有效性证据保留至 §5.5 的审计保留期届满；新签发消息使用新密钥。轮换前已签在途消息在其自身 exp 内且在轮换宽限内可提交；宽限默认取 `max(2 × 契约消息有效期上限, 15 分钟)`。疑似泄露直接吊销，不用轮换宽限。
- **吊销**在身份权威的生效记录处即时生效，未发起动作停止；缓存部署必须声明最大撤销传播延迟，不得声称执行侧零延迟阻断，该声明不放宽 §14.1 的 fail-closed。吊销与执行许可消费须在同一授权序中仲裁；许可已消费视为“已发起待核对”，不声称外部调用物理上已经成功。
- 受影响线程提交 `sys.revoked`，引用权威吊销证明：进行态进入 blocked，保存 previous_state 与阻塞原因；履约终结态、终态不迁移，按 §10.1 撤销并冻结相关执行资格。已有副作用继续核对，不要求被吊销的执行方重新取得执行资格才能报告历史结果。
- 吊销后新提交的旧密钥事件无效，不按发送方自报时间回溯生效；历史有效提交仍按当时证据验证。吊销与恢复凭据由既有身份根认可的不同角色签发并各自入链；恢复需同主体锚的新密钥，并重新授予 epoch。
- **所有者转移**先建立候选：新 owner 承接声明、原 owner 或有权治理根转移凭证、新 owner 的唯一主体锚绑定。身份权威验证三件套后，在同一提交记录完整三件套与 `owner.changed`；其序号是唯一生效点。部分入链不改变 owner，候选超期中止。
  - 生效时撤销该 Agent 的旧会话密钥与旧 epoch；一般失效范围仅限该 Agent 的相关引用。转移由治理根发起，或伴随治理接管、疑似泄露时，按既有吊销规则独立评估旧 principal 其他引用是否连带失效；连带撤销须另有授权、证据与记录，不因转移自动认定整个 principal 失效。
  - 原 principal 对既有任务核对、清偿、异议必须持有有权治理根/契约控制者认可并入链的受限收尾凭据：绑定 holder 公钥、旧主体锚、任务集合、仅限收尾动作、有效期和撤销标识，范围与期限由 owner.changed 生效记录限定，补发也不得超出该记录。身份密钥只验持有者签名，不授权新执行身份。收尾前验签发权、持有证明、任务/动作匹配、期限及满足新鲜度要求的撤销/治理状态；缺项 fail-closed。治理转移或疑似泄露须完成独立连带评估，不能仅凭“无撤销记录”跳过。历史核对不需新履约 epoch；实际清偿资金仍须 L3 批准、专用动作资格与 effect 登记。
  - 受影响进行态通过 `sys.owner_changed` 进入 blocked；履约终结态及终态仅冻结执行资格、继续核对，不改变承诺状态。配置失效只覆盖该 Agent 的授权、信任根、裁定者及收据接收端相关引用，不使旧 principal 的其他任务自动失效。
  - **在途承诺仍按原锁定当事方与主体锚归责**。只有所需当事方签署 task.amend、并原子校验和迁移相应预留后才可转移责任；新 owner 单方承接声明不足以变更已有承诺。未完成承接时任务冻结、原 principal 兜底。负面记录不得改写、清除或转成新 owner 授信；未清偿敞口不得通过换 owner 规避。同一主体仅改名时由身份根出具同一性证明，沿用原主体锚。
- **退役交割**：未终结承诺须经 stop/cancel 终止、task.amend 替换负责人（新负责人签署接受），或由 principal 显式接管。delegate 只能派生子任务，不转移父任务责任。交割前不得正常退役；紧急安全撤销由 principal 兜底。
- 克隆不复制密钥；重新申领并在名片声明实例 lineage。

### 5.3 联系人名片

建立联系或入群时交换名片，字段包括：

| 字段 | 说明 |
|---|---|
| 身份与所有者 | 地址、`owner`、主体锚、署名方式（见 §13.2） |
| 能力清单 | 能承接的任务类型与对应的 payload kind 及版本（与 A2A AgentCard 的字段映射为建议项，§17.6） |
| 支持档位 | 声称的 profile（§17.4）、支持的事件集、最高结构化等级、降级映射表版本、令牌编码绑定与解析端点（见 §14.1） |
| 费率与计量 | 计价方式（只用法币计价，token 数仅作参考字段）。费率以名片为唯一来源，Presence 不发布费率 |
| 信誉摘要 | 由域内平台按 §5.4 统计，不许自报 |
| 授权上限 | 可被授予的 scope 上限（资源 × 动作） |
| 签约权限边界 | 该 Agent 有权独立承诺的金额/动作上限，超出必须 escalate |
| 能力边界声明 | 声称 Core-L2 时必须声明"不执行 §9.2 四类动作"（§17.4） |

名片目录默认不可批量枚举：查询需认证与限速；地址支持公开别名与真实地址分离，公开别名可随时弃用，真实地址只在握手后交换。防枚举约束的是真实地址与批量导出，不阻断定向发现——发现走三条受控路径：**公开别名目录**（只暴露别名与能力粗分类，查询须认证并限速）、**邀请定位**（凭房间所有者或成员发出的邀请凭证定位对方）、**域内通讯录**（同域成员经域主目录按名查询，仅对域内已认证成员开放）。

### 5.4 信誉：三锚与责任

纯计数信誉可被自交易刷取、可弃号白洗、可一次性变现，故核心规范要求：

- **锚主体**：信誉绑定主体锚（经验证的人类/组织身份或押金账户），不绑定 Agent 实例；换实例不换信誉，注销不清除负面记录。
- **锚真实结算**：经济信誉权重仅依据真实托管结算；未结算任务不得冒充经济履约记录。有效事件形成客观统计（Core-L2 亦适用），主观结论必须经争议程序。经济权重随结算金额与交易对手独立程度递增，自环与小圈子交易边际贡献趋零。
- **锚敞口**：主体的**在途未清偿敞口总额**（跨任务、跨房间、跨别名按主体锚归并）不得超过其授信额度，由共享额度账本强制（§10.9）；单笔上限只是附加约束，不替代总额约束。授信来源可为押金、担保与历史真实结算额；新主体必须存在小额入场通道。
- **责任规则**：通过有效验签、适用授权及提交校验的事件，按锁定契约归责于其 principal；"Agent 被注入"不单独豁免有效授权范围内的责任；无效或伪造事件不得仅凭签名字节产生履约义务、结算或信誉处罚。
- **兜底声明**：启用 AIMP/L3 执行 §9.2(a) 资金支出或 (c) 不可逆动作的实现，必须声明其违约兜底机制（押金、保险、信用等），无兜底声明不得执行此类动作。

信誉分双轨：**客观轨**（准时率、格式合规、计量一致性、超时与撤单统计等可机械统计项）自动统计，不依赖任何人的主观判定；**主观轨**（真实性、质量）只能经争议程序（§10.5）裁定后计入。跨域时信誉分数不互认，只兑换"是否有域为其背书"这一比特（背书凭证见 §16）。

信誉分值合成、独立系数、押金杠杆与入场额度等**数值参数**属〔Profile: Governance〕，参考口径见附录 C；该 profile 必须给出风险模型，说明在其参数下押金段恶意违约的期望净收益非正。核心规范不写死这些数值。

### 5.5 握手与会话契约

建立联系或入群走三段握手：**发现（读名片）→ 谈判 scope（在本房间内能看什么、能动什么）→ 房间所有者/用户确认**。未完成握手的成员处于未契约状态，只能发送 L0/L1 消息。

握手结果锁定为**会话契约**，至少包含：

| 契约项 | 说明 |
|---|---|
| profile 与能力 | 双方声称的 profile、支持的等级、事件集、payload kind 集与版本、降级映射表版本 |
| 定序权威 | 定序者身份、备用定序者、最大定序时限 `T_order`、故障切换规则（§10.3） |
| 时限与上限 | clarify 次数与累计暂停上限、阻塞超限时长、租约时长、跳数上限（默认 8）、参与者回访是否开启及最大次数（§10.2） |
| 争议 | `dispute_resolver`、利益冲突替代者、裁定期限、无裁决后果（§10.5） |
| 安全参数 | 撤销与令牌状态的新鲜度上界（默认 ≤5 分钟且不超过令牌 exp，§14.1）、免责与顺延的可验证触发条件与累计上限（§10.3、§15.3） |
| 升级接收者 | clarify 超限、阻塞超限、验收超时及结果不可核对的接收者 |
| 角色矩阵 | 角色、可发事件、最高等级、有界任务作用域、授权来源、有效期、撤销规则；包含会话前段 clarify 权限 |
| stop scope | 持有者、任务或有界集合、授权来源、有效期；房间角色本身不授予强制 stop |
| 收据接收端 | principal 签署的接收端、定序者标识及独立性声明；可由已签域策略继承 |
| 验收与异议 | review 截止时间、返工异议期限、可验证顺延与无响应处置 |
| 保留期 | 事件链、幂等、effect、schema、检查点、输入与产物本体；默认终结后至少 24 个月，且不得短于适用争议与合同证据保留期限 |
| 吊销顺延 | sys.revoked 的可验证触发条件、deadline 顺延累计上限；不延长已失效 epoch 或租约 |

会话中途低于契约档位的消息如何处置，见 §15.4 的判定次序。

#### 5.5.1 会话契约的版本与变更

- 会话契约每次变更生成新版本 `contract_version{hash, seq, effective_at, parties[]}` 并入链，须全部当事方按各自署名等级签署。
- 会话契约变更只对 effective_at 之后成立的 task_ref 生效；已成立任务保持原契约版本与效力下限。任务业务条款变更须经所需当事方签署 task.amend，生效前旧条款继续有效，不得降低已锁定的效力要求。
- **显式例外**：定序权威变更可依旧契约预先锁定的故障切换规则，或经该任务所需当事方显式同意并入链后适用于已成立任务——仅及于定序主体与交接期只读，不含任何效力降格，且须满足 §10.3 的 fencing。
- payload kind 升版须在契约中声明并行支持窗口；已锁定 schema 及验证规则须保留至相关任务终结且审计保留期届满，不得仅因窗口结束而使其合法事件失效。审批请求按其渲染时锁定的 schema 版本执行；若需改用其他版本，必须重新渲染并重新审批（§13.1）。

---

## 6. Presence：可用性状态

Presence 从"在线/离线"扩展为可被路由使用的状态，但按情报分级发布：

```json
{
  "agent": "agent://relay.example/data-bot",
  "presence": "accepting",
  "current": { "thread": "thr_…", "task_alias": "例行拉数", "since": "…" },
  "load": { "queue": 2, "eta_free_min": 15 }
}
```

- `presence` 枚举：`accepting` / `busy` / `blocked`（等待人类或外部输入）/ `quiet`（只收 @ 自己的消息）/ `offline`。
- **不发布的字段**：上下文占用率等实现内部细节（能力指纹、无互操作语义）与费率（以名片为唯一来源）不属于标准 Presence，可作为受权限控制的厂商扩展。
- **可见性分级**：公开层只给三态粗粒度桶（accepting / busy / offline）；`current`、`load.queue`、`eta_free_min` 只对已建立承诺的当事方可见；任务名可使用别名脱敏。五态到三桶的**折叠规则**固定为：accepting → accepting；busy → busy；blocked → busy；quiet → busy；offline → offline。折叠只发生在公开层发布时，当事方层仍见五态原值。
- **quiet 的接单规则**：`quiet` 成员不响应未点名的 `request`；被 @ 点名时可被唤醒接收，并可 `accept` 点名指派给自己的 request（accept 后 presence 应随即转为 accepting 或 busy）；点名之外的消息只收不答。
- **声明非事实**：Presence 是声明而非遥测。承重路由不得只凭 Presence 决策，须以平台侧队列数据或**签名遥测**为准——可伪造的字段不许承重。
- **签名遥测**：由平台或独立遥测服务签发的结构化可用性凭证，最小字段为：主体地址、presence 值、队列深度、签发时间、有效期、签发方签名。部署中若不存在签名遥测与平台队列数据，Presence 只作展示与非承重提示。
- **未点名请求的路由**：群内未点名的 `request` 仅在房间**显式启用公开接单路由**时适用。发送方应给出 `to`/`mentions` 或 `payload.required_kinds`；平台以名片能力清单 + 可信队列数据做非 LLM 的确定性过滤，选出有限候选（≤K，计入房间唤醒预算，§14.3）后才允许候选做语义判断；仅 `accepting` 的候选可 `accept`；实际认领按定序原子认领（§10.2）。Presence 不决定最终责任归属。

---

## 7. 消息信封

### 7.1 结构

每条消息 = 信封头（协议元数据）+ 正文（自然语言）+ 结构化块（按等级要求）+ 附件引用 + 签名；承重消息另带定序者附加的**定序记录**（两层签名，§10.4）。

```json
{
  "aimp": "1.0",
  "id": "msg_9f2c…（随机 ≥128 位）",
  "thread_id": "thr_sub_…（子线程）",
  "room_id": "room_…",
  "task_ref": "task_T2…",
  "target_event": { "id": "msg_51aa…（父任务 T1 的 accept 事件）", "hash": "…" },
  "from": "agent://relay.example/data-bot",
  "to": ["agent://relay.example/report-bot"],
  "mentions": ["agent://relay.example/report-bot"],
  "audience": ["agent://relay.example/report-bot", "room_…"],
  "exp": "2026-11-03T05:25:00Z",
  "key_id": "k_…",
  "reply_to": "msg_77ab…",
  "ts": "2026-11-03T05:20:00Z",

  "act": "delegate",
  "source_level": "peer",
  "classification": "internal",
  "body": "@报告Bot 请接手写周报：沿用上周模板，数字须可溯源到附带的 csv 与归因稿，明早 9 点前交。",
  "locale": "zh-CN",

  "payload": {
    "kind": "task.delegate@1",
    "must_understand": true,
    "parent_task": "task_T1…",
    "expires": "2026-11-03T05:24:00Z",
    "assignee": "agent://relay.example/report-bot",
    "reviewer": "agent://relay.example/review-bot",
    "lineage": [
      { "task_ref": "task_T1…", "assignee": "agent://relay.example/data-bot", "hop": 0 }
    ],
    "deadline": "2026-11-04T01:00:00Z",
    "budget": "none",
    "inputs": [
      "artifact://…/retention-2026w44.csv@v3",
      "artifact://…/attribution.md@v1"
    ],
    "acceptance": {
      "predicates": ["数字可溯源到 inputs", "口径 = 次日/7日/30日三档、分渠道"],
      "subjective": "按 template://weekly-report/v2 产出",
      "trust_root": "agent://relay.example/review-bot"
    }
  },

  "capability_token": { "ref": "cap_ref:…（由链头哈希与本消息 id 派生）", "chain_head": "…" },
  "intent_origin": [ { "id": "msg_51de…", "content_hash": "…" } ],

  "sig": "…（64 字节 Ed25519 发送方签名的小写 hex）",

  "sequencing": {
    "intent_hash": "…（发送方意图签名输入的 SHA-256）",
    "sender_sig": "…（发送方签名字节的小写 hex）",
    "seq": 1042, "term": 3,
    "recorded_at": "2026-11-03T05:20:01Z",
    "prev_hash": "…（同线程上一条已提交记录的哈希）",
    "verdict": "sequenced",
    "sig": "…（64 字节 Ed25519 定序者签名的小写 hex）"
  }
}
```

本例只是委托：输入物以 `inputs` 引用，**不构成交付**；数据 Bot 的交付由其根任务上独立的 `deliver` 记录（§10.1、§18）。

### 7.2 字段表

| 字段 | 必填 | 说明 |
|---|---|---|
| `aimp` | 是 | 协议版本 |
| `id` | 是 | 全局唯一、不可预测（随机 ≥128 位）。作去重键；同 id 异意图哈希即冲突证据，须报警而非静默丢弃（§7.3） |
| `thread_id` | 是 | 所属线程；单聊可由双方地址派生 |
| `room_id` | 群聊必填 | 所属房间 |
| `task_ref` | 任务事件必填 | 所属承诺实例，绑定唯一权威线程；会话前段 clarify 与独立控制日志事件不虚构 task_ref（§8.2） |
| `target_event` | 效力事件必填 | id 与意图哈希；根创建为 null，delegate 引用父链已提交事件。会话前段 clarify 可引用同线程传输接收记录中的未定序消息，须绑定当时内容哈希 |
| `from` / `to` | 是 | 发送方与投递集 |
| `mentions` | 否 | 点名负责集。与 `to` 严格分离：听得到 ≠ 被指派 |
| `audience` | 承重消息必填 | 签名的预期验证方集合（参与者地址，或房间/域作用域标识）。验证方不在 `audience` 内时必须拒绝验签——防签名被跨语境重放 |
| `exp` | 承重消息必填 | 签名有效期截止时刻，以定序权威的接收时间判定；应当不超过 5 分钟。过期签名不产生效力 |
| `key_id` | L2+ 必填 | 签名密钥标识，用于吊销与轮换判定（§5.2） |
| `reply_to` | 否 | 因果链。结果、验收、追问必须回链到源消息 |
| `ts` | 是 | 发送方时间，仅作展示；一切时限判定以定序权威的接收时间为准 |
| `act` | 是 | 言语行为（§8）。发送方未声明时按 `chat` 处理 |
| `source_level` | 是 | 本消息内容的主要来源级（§12）：`principal` / `peer` / `environment`。混合来源时取最低可信级，并在 `payload.body_segments` 中逐段标注。只有 §13.7 的合法生产者可标注 `principal` |
| `classification` | 否 | 密级标签：`public` / `internal` / `confidential`，缺省为域内默认密级；低密级成员对高密级消息只见脱敏摘要（§14.4） |
| `body` | 是 | 自然语言正文，人可读优先的载体 |
| `locale` | 否 | 正文语言 |
| `payload` | 按等级 | 结构化块。`kind` 带版本；`must_understand` 见 §9.3；核心 schema 见 §7.5 |
| `payload.lineage` | delegate 必填 | 不可变祖先列表 `{task_ref, assignee, hop}`，根任务在首（§10.2） |
| `capability_token` | 执行动作必填 | Core-L2 使用内联单跳根令牌；L3 使用完整链。名片授权上限不构成实际授权，不允许信封自填 scope |
| `intent_origin` | L3 必填 | 触发本动作的 principal 消息链，每跳 `{id, content_hash}`（§12）；跨域形态见 §16 |
| `artifacts` | 按 act 要求 | 版本化交付物引用（内容寻址 + 哈希）。`deliver` 必填，其余按 payload kind 定义。消息体不塞实体；群交接传引用，直查才传实体 |
| `sig` | L2+ 必填 | 发送方签名，覆盖**发送方意图**（§7.4）。施签方式按 profile：Core-L2 由 principal 发放的会话密钥施加，只证明来源与完整性、**不构成执行授权**；L3 起由签名网关施加（§14.2）。**未列入签名覆盖域的字段不得承重** |
| `sequencing` | 承重消息由定序者附加 | 意图哈希、发送方签名、线程 seq/term/prev_hash、recorded_at、verdict 与定序者签名。发送方不填写；唯一权威线程规则见 §10.2 |
| `control_ref` | 控制日志事件适用 | 独立身份、契约或收据日志的对象标识；不得当作可另行创建承诺的 task_ref |

承重消息覆盖状态、授权、计时、副作用事件及已登记控制事件：必须签名、定序、入链；纯标签不产生任何效力。

### 7.3 投递语义与幂等

- 投递为 **at-least-once + 有界去重窗口**（传输层去重缓存不低于 24 小时）。AIMP **不声称 exactly-once**；协议外副作用的一致性由副作用登记（§11）保证可对账。
- **两层记录，职责分离**：
  - **传输去重缓存**：按 `id` 在窗口内拦截重复投递。
  - **协议幂等记录**：承重事件按**发送方意图规范化哈希**（§7.4）判同，在任务审计保留期内持久保存。同 id 同哈希返回原提交回执；同 id 异哈希报冲突；超保留期的旧消息只进档案验证流程。**历史重放不得触发执行与通知。**
- effect、幂等、历史 schema 与事件证据统一遵守 §5.5 保留期，未清偿或争议未决时不得销毁；去重窗口之外仍凭原 effect_id 核对，不得重新执行。
- 传输重投元数据、发送方签名字节、定序包装不参与"同一意图"的判定；改变有效期、密钥标识或授权材料即视为不同意图。

### 7.4 签名格式、投影与规范化

签的是**明确字段投影**，不是“删除 sig 后的完整信封”。可执行投影算法与四类对象的 JSON Schema 在配套 `aimp-v3.1-schemas.json` 与 `verify_v31_vectors.py`，真实测试输入与签名在 `aimp-v3.1-test-vectors.json`（附录 B）。

| 对象 | 投影及字节 |
|---|---|
| 发送方意图 I | 只复制存在的 aimp、id、thread_id、room_id、task_ref、control_ref、target_event、from、to、mentions、audience、exp、key_id、reply_to、act、source_level、classification、capability_token、intent_origin；附 body_hash、payload_hash（有 payload 时）、artifacts 的 ref/version/sha256/media_type 投影（有 artifacts 时） |
| 定序记录 R | intent_hash、sender_sig、seq、term、recorded_at、prev_hash、verdict；sender_sig 为小写 hex 的原发送方签名字节 |
| 系统意图 S | id、thread_id、task_ref 或 control_ref、target_event、act、source_level、key_id、payload；由有权系统签发者签署，再纳入线程定序记录 |
| 审批对象 A | schema_version、task_ref、action_type、target、amount、irreversibility、artifacts、payload、constraints；实际展开目标与约束必须完整，不得通过额外字段隐藏目标 |

- body_hash = SHA-256(正文字符串的 UTF-8 原文字节)，不做 Unicode 归一化；payload_hash = SHA-256(JCS(payload))。产物哈希覆盖本体原字节，密文哈希覆盖密文字节；schema 明确业务明文哈希与密文传输哈希，不得混用。
- 四类签名/摘要输入分别为 `UTF8("AIMP/1/intent") || 0x00 || JCS(I)`、record、system、approval 同式。intent_hash 为意图签名输入的 SHA-256；记录链哈希为 record 签名输入的 SHA-256（包含 sender_sig，不包含定序者自己的 sig）。创世前驱为 64 个零字符；之后 prev_hash 引用同线程上一条记录链哈希。
- 签名 Ed25519；摘要 SHA-256，均采用小写 hex 表示。本版不允许任意算法替换后仍声称同一签名 profile。审批通常由 approve 引用 A 的摘要；附录签名向量演示同一域隔离字节，不替代 approve 的完整事件签名。
- 采用 RFC 8785 JCS，拒绝重复键和非合法 Unicode；键按 UTF-16 码元排序，无空白。金额为十进制字符串加币种，不用浮点数；UTC 时间以 RFC 3339 Z 表示。可选字段缺失与 null 不等价，不擅自补默认值；sig、sequencing、ts、locale 不进入 I，后两者不得作为效力判据。
- payload 版本定义闭合字段集，额外副作用对象字段不得被忽略。audience 解析是签名语义一部分：房间/域作用域标识含域与版本，验效力用提交时成员与角色快照；历史审计不重新取得执行权限。approve/常设放行必须显式列出定序者及需要验效力、消费许可的网关/执行方，不仅列房间。
- 配套向量仅覆盖 JCS 的安全整数子集，不是完整浮点序列化实现；完整 JCS、状态迁移和 profile 认证还须通过附录 B 场景测试，不能仅凭四个签名向量声称已实现协议。

### 7.5 核心 schema 与效力判定流程

首批版本化核心 payload kind（均为承重 kind，`must_understand: true`）：

| kind | 关键字段 |
|---|---|
| `task.request@1` / `task.propose@1` | 任务描述、`deadline`、`budget`、`acceptance`、拟定执行方 / 验收方、`expires` |
| `task.accept@1` | target_event 锁定的提议版本、caveats[]；只允许提议预先允许的选项或不扩大义务的可验证限制；改变范围/价款/期限/产物/验收须 counter 或 task.amend，不以 accept 单方加活 |
| `task.delegate@1` | `lineage`、`deadline`、`budget`、`inputs`、`acceptance` |
| `task.deliver@1` | `draft`（布尔，§13.4）、`caveats[]`（声明缺口）、artifacts |
| `task.review@1` | `decision`（pass / rework / dispute_hint）、`findings[]`（逐项对应锁定谓词或标准）、`trust_root` |
| `aimp.receipt@1` | `chain_head`、`covered_seq`、`signer` |
| `aimp.commit-summary@1` | `parties`、`budget`、`deadline`、`chain_root`、`status`、`commitment_hash` |
| `aimp.approval-request@1` | action_type、target、amount、irreversibility、normalized_hash、exp、schema_version；must_render 由可信 schema 指定，申请方不能改写 |
| 其他效力 kind | §8.2 逐事件表定义完整必填字段与权限；不能把未登记的实现私有事件当作标准事件 |

字段规则：

- **`acceptance`**：L2 承诺必填，结构为两段——`predicates`（机器可判定谓词集）+ `subjective`（主观验收标准），可只含主观段；另有 `trust_root`（主观段的裁决者）。
- **基础谓词**：以下谓词视为随任何 `accept` 一并锁定，无需写入 acceptance——artifact 哈希与引用一致；正文对 inputs 或附件中既有数值的引用一致；计算、换算、汇总或推断结果符合锁定口径并可溯源到 inputs（不要求与原始数值相等）；schema 必填项齐全。
- **`budget`**：L2 承诺必填，可取 `none`（声明无计量预算，此时 §10.2 的超预算规则不适用，成本控制按域策略）。**含资金支出的承诺，budget 必须为具体金额与币种**；仅含对外副作用而无资金支出的承诺可取 `none`，但域策略必须声明其副作用配额，未声明则 `none` 不成立、承诺无效。`budget: none` 的承诺不产生额度预留（§10.9）。缺失字段时接收方回 `clarify` 索要。

**效力判定流程**（定序者与执行入口均按此次序，前一步不过即停止）：

1. 有界解析与最低结构校验；完成必要查询身份校验后，先查询持久幂等记录：同 id 同意图哈希已有终局结果则返回原裁决，不按当前过期或吊销状态改判历史，也不重新执行；异哈希报冲突。不得向未授权查询者泄露原回执；
2. 验签（发送方意图签名、`audience`、`exp`、`key_id` 吊销状态）；
3. 授权（发言权限按会话契约与角色矩阵；执行权限按能力令牌，§14.1）；
4. schema 校验（承重 kind、必填字段、`additionalProperties`）；
5. 前置状态（迁移表前置条件，含 §10.9 额度预留判定）；
6. 提交（定序、持久化、签发提交回执）。

结果四分：已提交/无效/待验证/可协商降级。pending（待验证）是非终局回执，最终转 sequenced 或 rejected；rejected 不等于任务 declined。终局回执签名绑定意图哈希、task_ref/control_ref、term、裁决、seq 和链头，不重复授予执行效力。只有 §15.1 清单内情形为拒收式硬失败。

---

## 8. 言语行为（Act）

### 8.1 词表

| act | 语义 | 效力类别（§8.2） |
|---|---|---|
| `chat` | 闲谈 / 讨论 | 标签 |
| `inform` | 通报事实、进度、结果摘要 | 标签（陈述方对真实性负责，是主观轨争议的输入） |
| `request` | 请求对方做某事（未定契约） | 状态事件：创建 proposed；本身不产生履约义务 |
| `clarify` | 追问 / 要求补信息 | 计时事件：暂停源请求的软计时（不暂停硬 deadline，§8.4） |
| `propose` | 提出方案 / 报价 / 分工 | 状态事件（承重）：提议方受其约束至过期或被拒；约束分档见 §9.1 |
| `counter` | 还价 / 修改提议 | 状态事件（承重）：同 propose，且自动废止被还的原提议 |
| `accept` | 接受提议或请求 | 状态事件（承重）：直接提交至 committed 或成功激活才产生履约义务；pending_activation 仅保留候选 |
| `reject` | 拒绝（理由写于正文） | 状态事件（承重）：终止对应提议 / 请求 |
| `delegate` | 转交任务（含子任务拆解） | 状态事件：在子链为创建事件；在父链只记关联、不迁移父链；原委托方保留督办义务 |
| `cancel` | 撤单（当事方或其 principal，附理由） | 状态事件：→ cancelled；是否违约按锁定契约、发起方与原因裁定（§10.2） |
| `progress` | 进度上报 | 标签：无新增义务；长任务的默认心跳 |
| `deliver` | 交付成果（附 artifacts） | 状态事件（承重）：→ delivered，触发验收计时；`draft:true` 时为授权事件（审批对象登记，§13.4） |
| `review` | 传达验收裁决：通过 / 返工 | 状态事件（承重）：通过 → accepted；返工 → working（§10.5） |
| `approve` | 人类（或被授权方）放行敏感动作 | 授权事件：与审批对象哈希绑定，原子消费、单次有效（§13.1）；不迁移承诺状态 |
| `escalate` | 升级：超能力 / 超权限 / 需人类判断 | 状态事件：→ blocked，暂停并转移决策权 |
| `resume` | 解除阻塞 | 状态事件：blocked → 进入前状态 |
| `stop` | 停止进行中的工作 | 状态事件（承重）：强制档 → halted + 生效报告义务（§10.6）；效力矩阵见 §8.4 |
| `dispute` | 发起争议（对真实性 / 质量 / 计量） | 状态事件：→ disputed，冻结相关结算与信誉扣分（§10.5） |
| `ruling` | 传达争议裁定 | 状态事件：disputed → 裁定结果状态（§10.5） |
| `subscribe` / `unsubscribe` | 订阅 / 退订通报 | 〔Profile: Display 扩展〕标签；仅控制本方接收与展示，不产生唤醒，不作成本防线 |

另有**系统事件**（`sys.` 命名空间，由定序者签发，§10.3）：超时、租约与执行资格变更、认领回执、激活、结果核对超时、吊销影响、结算记账等。

### 8.2 权威事件注册表

承重 act（义务事件子集）⊂ 状态事件 ⊂ 承重消息；强校验范围按承重消息判断，不仅按七个义务词。类别为状态、授权、计时、副作用、控制；纯标签 chat/inform/progress 不入效力折叠。下表是逐事件登记，§10.1 为任务状态迁移的权威定义。每个 payload 必须含表中闭合字段及 kind、must_understand:true；request/propose/delegate/counter/accept/reject/cancel/deliver/review/dispute/ruling/stop/escalate/resume 的 kind 为 task.<事件名>@1，clarify/approve 为 aimp.<事件名>@1，含点命名空间的其余事件直接用 <事件名>@1；通用 source/target、签名/时间字段按 §7.2。组合列含多个事件名时每个名字独立注册，不接受任意 sys 后缀。

C = Core-L2 及其上层；L = L3；S = Sandbox-Settlement。表中角色均需契约或治理根授权，不以房间身份默认赋权。普通事件最低 L2/账户或会话密钥签名；涉及 §9.2 必须 L3及所需 approve，高风险需 human-attested。系统/控制记录需身份或定序权威签名。登记不代表跨 profile 启用。

| 事件 / @1 kind | 类别 / 对象 | 必填业务字段 | 角色 / profile | 前置条件及效果 / 失败回执 |
|---|---|---|---|---|
| request、propose | 状态 / task_ref | description、deadline、expires、budget、acceptance、assignee、reviewer | 发起/提议方 / C | 新任务，契约与 schema 有效；创建 proposed；无效时 rejected |
| delegate | 状态 / 子 task_ref | parent_task、lineage、deadline、expires、budget、inputs、acceptance、assignee、reviewer | 有拆分权的父负责人 / C | 父链引用有效，祖先不含当前任务，预算封闭划拨；创建子 proposed、不转移父责任 |
| counter | 状态 / task_ref | old_terms_hash、terms、terms_hash | 提议相对方 / C | proposed 当前版本；新版本取代旧版本，过期/冲突 rejected |
| accept | 状态 / task_ref | terms_hash、caveats | 相对方 / C | 当前提议、一致 caveats；直接 committed 或候选 pending_activation；未满足额度等则 pending/rejected |
| reject、cancel | 状态 / task_ref | reason | 相对方/契约当事方 / C | 按 §10.1 终结；无权限 rejected，不自动认定违约 |
| task.amend | 状态/条款 / task_ref | old_terms_hash、terms、terms_hash、signatures | 全部所需当事方 / C | 旧版本匹配，生效前旧条款有效；改条款不改线程或降低效力；替换负责人须新方接受、撤销旧 epoch |
| deliver（draft:false） | 状态 / task_ref | draft、caveats | 当前履约执行方 / C | artifacts 在信封必填；working→delivered，撤销该阶段 epoch |
| deliver（draft:true） | 授权对象登记 / task_ref | draft、caveats、approval_object | 动作申请方 / L | 完整审批对象；不迁移任务、不直接放行 |
| review | 状态 / task_ref | decision、findings、trust_root | 锁定验收方 / C | delivered，机器谓词通过后 pass；rework 必指锁定标准；不以裸主观 pass 绕过机器前提 |
| dispute | 状态 / task_ref | reason、claim | 当事方 / C | 交付/履约终结或返工异议期内，引用被争议事件；保存恢复点、冻结未清偿 |
| ruling | 状态 / task_ref | decision、findings、resolver、restore_state | 有权且符合回避的裁定者 / C | disputed，按 §10.5，恢复 working 须新 epoch |
| stop | 状态/资格冻结 / task_ref | reason | principal/控制者/治理 stop scope / C | 进行态→halted；其他态只冻结未发起动作、报告；建议不迁移 |
| escalate | 状态 / task_ref | reason_code、evidence、mandatory | 当事方/有权网关 / C | 进行态→blocked；强制标记依据证据验证，不接受自报 |
| resume | 状态 / task_ref | resolved_causes、authorization | principal/契约控制者/有权升级接收者 / C | 全部阻塞原因消除，恢复 previous_state；working 分配新 epoch |
| clarify | 计时 / task_ref 或线程 | question、pause_until、default（可选） | 当事方；前段为契约授权参与者 / C | 暂停软计时，引用消息哈希；不暂停硬 deadline，无任务时不作 SLA/资金计时 |
| approve | 授权 / task_ref | mode、object_hash、schema_version、token_id（standing 时） | 人类或有常设授权的网关 / L | 对象、令牌、权限一致，单次消费；不迁移任务 |
| governance.grant、governance.revoke | 授权 / 控制日志 | subject、scope、issuer、valid_until、evidence | 可追溯 principal/治理根的授予者 / C | stop 等治理授权；只按任务成立时锁定规则作用，不借升版追溯扩权 |
| effect.register | 副作用 / task_ref | effect_id、logical_action、clause_version、state、epoch、external_idempotency_key | 当前执行方 / C（高危 L） | state=registered，稳定逻辑动作号；有效执行凭据，原 token 重试返回原结果 |
| effect.update | 副作用 / task_ref | effect_id、state、epoch、external_receipt_hash、evidence | 当前执行方/有权核对者 / C（高危 L） | §11 合法边，进入 executing 校验当前资格；历史核对不需新 epoch |
| sys.epoch、sys.lease_renewed、sys.action_epoch | 资格控制 / task_ref | execution_epoch、lease_until、purpose、action_hash（action 时） | 定序者 / C | 初次授权/续租/收尾动作；不能用 progress 续租 |
| sys.timeout、sys.activation_timeout、sys.deadline | 状态 / task_ref | reason、deadline、trigger_hash | 定序者 / C | 有效权威时间触发；进入 expired，保留在途副作用核对 |
| sys.lease_expired、sys.effect_unknown | 状态/资格 / task_ref | execution_epoch、effect_ids、reason | 定序者 / C | working→committed 或 result_unknown；撤销旧 epoch，不自动重派 |
| sys.reconciled、sys.reconcile_timeout | 状态 / task_ref | effect_ids、result、evidence | 定序者/可信核对者 / C | 确认未发生→committed，已发生→按结果恢复，未知超时→blocked |
| sys.block_timeout、sys.review_timeout、sys.ruling_timeout | 状态 / task_ref | reason、deadline、trigger_hash | 定序者 / C | 保存恢复点、证据升级；不默认验收通过或付款 |
| sys.activated | 状态 / task_ref | accept_hash、terms_hash、contract_hash、receipt_proof | 源线程定序者 / C | 固定候选与收据证明匹配；原子预留后 committed，失败不消费证明 |
| sys.not_selected | 认领回执 / task_ref | accept_hash、winner_hash | 定序者 / C | 已被原子认领；不迁移任务，不计拒单/信誉 |
| sys.revoked、sys.owner_changed | 状态/资格 / task_ref | identity_proof、affected_key、reason | 源线程定序者 / C | 引用身份控制记录；按状态类别阻塞或仅冻结资格，不改历史归责 |
| owner.changed | 身份控制 / control_ref | agent、old_owner、new_owner、old_anchor、new_anchor、transfer_bundle | 身份权威 / C | 完整候选三件套原子生效，§5.2 |
| identity.revoked、identity.restored | 身份控制 / control_ref | subject、key_id、effective_seq、authority_proof | 身份根认可的分离角色 / C | 发起吊销/恢复；影响任务须对应线程事件 |
| aimp.receipt-ack | 收据控制 / control_ref | accept_hash、task_ref、terms_hash、contract_hash、recipient、valid_until | principal 指定独立接收端 / C | 通知权威落盘，不产生源任务义务或替代审批 |
| aimp.receipt、aimp.commit-summary | 证据控制 / control_ref | chain_head、covered_seq、source_task、commitment_hash、parties、budget、deadline、status | 有权收据签发者 / C | 引用源权威记录、不在第二线程写同一 task_ref |
| session.changed | 契约控制 / control_ref | old_contract_hash、contract、effective_at、signatures | 全部当事方/契约权威 / C | §5.5.1，不给已成立任务追溯降档 |
| sys.settled | 状态 / task_ref | effect_ids、settlement_receipts、amount、currency、parties | 定序者凭可信托管回执 / L 或 S | accepted→settled，不凭执行方单方报告放款 |

**会话前段 clarify**：无需虚构任务。由契约角色矩阵授权参与者提交，target_event 可引用同线程传输接收记录中的未定序消息，绑定 id 与当时内容哈希；只暂停已有会话软计时，不构成任务、计费、考核或 SLA 的计时依据。前段次数/暂停按会话单列。

**task.amend**只改变任务条款；不改变权威线程。改变范围、预算、期限或验收标准须相应当事方同意；新负责人须签署接受，旧资格在同一提交失效。未注册效力事件不得执行，纯标签只可展示或提示，不入状态折叠。

### 8.3 效果语义的边界

注册表事件的语义由**可观察效果**定义：例如有效接受的语义是"直接提交或成功激活后迁移至 committed，产生按契约归责的履约义务；pending_activation 不产生该义务"，而非"发送方内心同意"。此定义严格限于两类效果：状态迁移本身，以及机器可判定谓词（哈希一致、schema 合规、测试通过、数值可比对等）。

**交付质量不在效果语义内**：主观质量验收是协议外裁决——由契约锁定的信任根（委托人本人或其指定的受信任第三方）作出，`review` 只是裁决的传达通道。凡涉及质量判断的迁移（delivered → accepted），必须在 `task.review` 中标注 `trust_root`。

### 8.4 授权矩阵

- **stop 效力矩阵**：

| 发出者 | 效力 |
|---|---|
| 承诺的 principal、契约指定控制者、持治理 stop scope 者 | **强制**：进行态 → halted；履约终结态和终态保持状态，仅冻结相关执行资格、阻止未发起动作并报告 |
| 房间内其他成员（含无治理 scope 的人类与房间所有者） | **建议**：转为 escalate 通知，不改变状态、执行资格或计时 |
| 非成员 | 无效 |

  人类发出的强制 stop 在其有效 stop scope 内具有最高处理优先级（§10.6）；不自动认定所有房间所有者或所有人类拥有叫停权。stop 必须附理由，事后裁定为滥用的计入发出者信誉。
- 任务内 clarify/dispute 限有权当事方，review 限锁定验收方。会话前段 clarify 例外按 §8.2 角色矩阵，不虚构承诺当事方。stop scope 来自 principal/治理根可追溯授权；域治理根可授房间所有者有界授予权，未获权不能自行造权限。治理授权授予/撤回单独入链，只按目标任务成立时锁定治理规则作用，超规则须当事方显式同意，不能通过契约升版追溯扩权。
- **clarify 约束**：次数上限、累计暂停时长、计时恢复规则与升级接收者在会话契约中锁定。超限后默认"解除软计时暂停、硬 deadline 继续"，并向契约指定的升级接收者 escalate；deadline 届满按 expired 路径处理，归责按契约与证据裁定（不预设执行方违约，输入缺失可能归委托方）。clarify 次数与暂停时长计入发送方客观轨；"未提供新信息"仅在锁定的机器可判定谓词成立时自动记为违规，否则须经争议程序裁定。
- **escalate 配额**：非强制项超配额排队；mandatory 必带版本化 reason_code 与触发证据：已提交匹配事件，或契约认可定序者/执行网关/可信验证者签发的拒绝回执/验证证明。机械验签发权、任务动作绑定、有效性及类型对应，不要求定序者理解正文、不接受裸自报，也不因未入链拒绝有效安全升级。未知风险用有防滥用限额的待核验告警。已核验 mandatory 穿透免打扰。
- **密封提议**〔Profile: Sealed-Propose〕：propose 可用 commit-reveal 模式。提议方先发 `propose`，payload 只含承诺值 commitment = H(提议内容规范化哈希 ‖ 随机盐) 与揭示截止时刻（以定序权威时间为准）；截止前以一条公开原文与盐的消息完成揭示，任何人可复算验证；逾期未揭示的提议自动作废并计入提议方客观轨；揭示内容与承诺不一致的按伪造处理；揭示完成前，任何一方不得凭密封内容主张效力。该模式不进入任何核心 profile。敏感商务谈判应在当事方单聊线程进行，群线程只留状态摘要。

### 8.5 扩展与注册

- 自定义 act 与 payload kind 使用 `x.<域名>.<名>` 命名空间，首段必须为注册者控制的域名（所有权以域名验证为准）。
- **受保护清单** = 注册表中状态事件、授权事件、计时事件的全部语义：任何扩展不得复用其词根、不得声称等效效力；变更须走公开修订流程（§17.3）。
- 扩展 act 默认属纯标签；扩展若要产生前三类效力，必须作为注册表新行登记（含迁移表行与一致性测试）并以 profile 声明。
- 注册门槛是"有公开说明"，不要求委员会批准；新协作模式先以自然语言运行，高频稳定后再注册沉淀。

---

## 9. 结构化等级

### 9.1 四级

| 等级 | 形态 | 适用 | 约束 |
|---|---|---|---|
| L0 纯对话 | `act=chat/inform` + 正文 | 讨论、通报、头脑风暴 | 无承诺效力 |
| L1 软标注 | 声明 act，无 payload | 请求澄清、表态、对话级提议 | 有对话效力（可被引用），无履约义务 |
| L2 结构化 | act + payload（含 budget / acceptance），artifacts 按 act 要求附带 | 委托、交付、验收 | 进入承诺状态机；须签名（§7.2） |
| L3 契约化 | L2 + 能力令牌 + 签名网关签名 + intent_origin + 审批哈希绑定 | 付款、对外发送、不可逆操作、跨域委托 | 无签名或无令牌不得执行；验收与结算以信封为准；仅〔Profile: L3〕可用 |

关于 L1 的 `propose`：其约束仅为**对话约束**——提议方不得否认曾提出、不得在未撤回时作出自相矛盾的相反主张，违规主张只作证据，处罚须可归责并按程序，未验签文本不能处罚被冒充者；它不产生履约义务，也不得被 `accept` 直接成立为 L2 承诺。以 L1 propose 为基础成立承诺的，对方须先以 L2 重述该提议（附 payload），再对 L2 版本 `accept`。

### 9.2 升档触发规则

凡消息将导致以下任一后果，发送方必须升至 L3，接收方对低于 L3 的此类请求必须先回 `clarify` 索要补齐，不得直接执行：

- (a) 资金支出；
- (b) 以人类或组织名义对外发送；
- (c) 不可逆或难撤销的动作；
- (d) 跨信任域委托。

声称 AIMP/Core-L2 的实现不具备 L3，遇此类请求必须 `escalate`（mandatory）交人在协议外处理并留痕，或转交 L3 实现（§17.4）。

**与信任处置的优先级**：消息真实性存疑时（无签名、签名不可验、令牌失效），信任处置优先于本条——接收方一律不执行、其消息只按 L0 效力处理，此时不负 clarify 义务。clarify 是向**可信**发送方索要补齐的动作；仅当消息可信但档位不足时，才触发本条的 clarify 义务。

### 9.3 must_understand

`payload.must_understand` 标记接收方是否必须理解该结构化块才能处理消息。承重 kind 默认为 true：不认识承重 kind 时**必须**拒收（§15.1 第 3 项）——这是"不理解"构成硬失败的唯一情形（闲聊宽进，契约严进严效）。回信形态固定：以 `clarify` 消息携带结构化原因字段（`reason = "unsupported_kind"`，并注明不被理解的 kind 与版本）发出；该回信本身不产生任何状态迁移。会话契约声明的并行支持窗口内已登记的旧版本不触发本条（§5.5.1）。非承重的未知 kind 可按 §15 降级处理，但不得静默。

---

## 10. 承诺状态机

### 10.1 状态、资格与迁移

状态真相按 task_ref，排序/链/fencing 按线程。状态分三类：

- **进行态**：proposed、pending_activation、committed、working、blocked、delivered、result_unknown、disputed。
- **履约终结态**：accepted、settled。可接受列明的争议、结算、授权与责任收尾事件；不据此重新开始普通履约。契约可锁定争议期限，未规定则不臆造期限。
- **终态**：declined、expired、halted、cancelled，无承诺状态出边；既有副作用核对、stop 报告、独立授权的未清偿责任处置仍可进行。期限结束不抹除未清偿责任。

任务迁离 working 必须原子撤销该阶段履约 epoch；恢复 working 必须新授 epoch/租约。收尾动作资格绑定具体动作，不得继续一般履约。任务结束、阻塞、外部结果是否已清偿相互独立。以下为穷尽任务迁移表，效力类别与业务字段见 §8.2；非法迁移 rejected（无效）而非修改状态。

| # | 当前态 | 事件 | 有权角色/前置条件 | 下一态 | 必须原子记录的效果 | profile |
|---|---|---|---|---|---|---|
| 1 | — | request/propose | 提议方，契约/schema 有效 | proposed | 固定任务权威线程、条款哈希、assignee | C |
| 2 | — | delegate | 有拆分权父负责人，祖先合法、预算封闭划拨 | proposed（子） | 父链只关联不转移责任，预算只计一次 | C |
| 3 | proposed | counter | 相对方，当前版本匹配 | proposed | 替换条款版本、废止旧提议 | C |
| 4 | proposed | accept（需收据） | 相对方，合法 caveats，pending 上限未满 | pending_activation | 仅候选，不产生履约义务、不新增主体敞口 | C |
| 5 | proposed | accept（直接/豁免） | principal 本人合法确认或已签豁免策略；预留成功 | committed | 产生义务；其他候选收到 not_selected | C |
| 6 | pending_activation | sys.activated | 源定序者，固定候选/条款/契约与独立收据证明匹配，预留成功 | committed | 生效义务；预留与激活同提交，证明消费一次 | C |
| 7 | proposed | reject | 相对方 | declined | 未生效划拨回收，无效 accept 回执不触发回收 | C |
| 8 | proposed/pending_activation | sys.timeout/sys.activation_timeout | 定序者，expires/激活期限届满 | expired | 释放已无责任内部分配，迟到证明不复活 | C |
| 9 | committed | sys.epoch | 锁定执行方申领，授权有效；到资前仅可另授入托 action_epoch | working | 首次不要求已有 epoch，分配新 epoch/lease | C |
| 10 | working | sys.lease_renewed | 当前执行方申请，授权/epoch/新期限合法 | working | 续租入链，progress 不改变租约 | C |
| 11 | working | deliver（draft:false） | 当前履约执行方，artifacts 齐备 | delivered | 撤销履约 epoch，启动锁定验收计时 | C |
| 12 | working | sys.lease_expired | 定序者，租约届满，无执行中不确定副作用 | committed | 旧资格失效；不回 proposed、不自动重派 | C |
| 13 | working | sys.effect_unknown | 定序者，未决执行中副作用 | result_unknown | 撤销旧资格，冻结重试，关联 effect_id | C |
| 14 | result_unknown | sys.reconciled（已发生） | 有权核对者、可信回执 | committed | 记录效果；继续履约须另授 epoch，再由 deliver 交付 | C |
| 15 | result_unknown | sys.reconciled（未发生） | 有权核对者、确认未发生/不会迟到生效 | committed | 原 effect_id 保留，重试必须新 epoch | C |
| 16 | result_unknown | sys.reconcile_timeout | 定序者，核对超时 | blocked | 保存恢复点，mandatory escalate | C |
| 17 | committed/working/delivered/result_unknown/blocked | escalate | 当事方/有权证据，§8.4 | blocked | 保存首次 previous_state 与阻塞原因集合，不覆盖旧原因 | C |
| 18 | delivered | sys.review_timeout | 定序者，验收期限届满 | blocked | previous_state=delivered，升级不默认验收/付款 | C |
| 19 | blocked | resume | 有权控制者，全部阻塞原因消除 | previous_state | working 必另授新 epoch；终态不能复活 | C |
| 20 | blocked | sys.block_timeout | 定序者，超限 | blocked | 保留原因/恢复点，升级预定接收者 | C |
| 21 | committed/working/blocked/pending_activation | cancel | 有权当事方，理由有效 | cancelled | 撤销/冻结执行资格；在途效果继续核对 | C |
| 22 | committed/working/blocked | sys.deadline | 定序者，硬 deadline 届满且无合法顺延、未交付 | expired | 停未发起动作，超时原因分列不预设归责 | C |
| 23 | delivered | review（pass） | 锁定验收方，机器/基础谓词通过，主观信任根合法 | accepted | 履约终结；释放仅已无未清偿责任余额 | C |
| 24 | delivered | review（rework） | 锁定验收方，findings 对应锁定标准 | working | 免费返工，新 epoch/lease 与迁移同提交；未能授予则暂不执行 | C |
| 25 | accepted | sys.settled | 定序者，可信托管 effect 回执绑定收付/币种/金额 | settled | 记录结算，不回滚历史付款 | L/S |
| 26 | delivered/accepted/settled | dispute | 当事方，异议期/引用合法 | disputed | 保存 previous_state、冻结未清偿与争议信誉项 | C |
| 27 | working/committed/blocked（返工阶段） | dispute | 引用最近有效 review{rework}，在异议期限 | disputed | 保存返工/阻塞原因与未清偿事实，不因租约失效失去异议权 | C |
| 28 | disputed | ruling | 锁定裁定者及回避规则合法 | previous_state/working/accepted/settled/cancelled | working 必须新 epoch；补偿独立授权 | C |
| 29 | disputed | sys.ruling_timeout | 定序者 | disputed | 仅确定的托管分段处置，其他冻结升级 | C |
| 30 | 任意进行态 | stop（强制） | §8.4 控制权限有效 | halted | 原子冻结资格，报告效果，不自动释放在途预留 | C |
| 31 | accepted/settled/终态 | stop（强制） | 相应 stop scope | 同态 | 冻结其 scope 下资格，阻止未发起收尾动作；重申领须控制者显式授权 | C |
| 32 | 任意进行态 | sys.revoked/sys.owner_changed | 源定序者引用身份权威证明 | blocked | 保存恢复点/原因；旧 epoch 失效，deadline 仅按契约顺延 | C |
| 33 | accepted/settled/终态 | sys.revoked/sys.owner_changed | 源定序者，身份证据有效 | 同态 | 不改历史归责，冻结资格，继续核对 | C |
| 34 | 进行态 | task.amend | 所需签署、旧条款哈希匹配、未降低效力 | 同态 | 递增条款版本/原子预留调整；换负责人旧 epoch 失效；不得修改已履约终结任务的锁定义务 | C |

C=Core-L2及上层，L=L3，S=Sandbox-Settlement。registered/executing/unknown 的效果核对不随任务终态消失。draft:true、approve、effect 事件不自行迁移承诺态，其他系统记录不得越过本表产生隐藏迁移。A2A 近似对应只供适配，不能成为第二状态权威。

### 10.2 线程、任务、委托与执行资格

- 一个 task_ref 固定绑定创建事件所在的**唯一权威线程**；v3.1 不支持 relocate，不通过 task.amend 移动权威线程。其他线程只能展示/引用，不能再提交同一任务的效力事件。定序者故障接管并续写同一线程不属于线程迁移。
- 线程是 seq、term、prev_hash、创世、检查点、fencing 的唯一作用域；task_ref 是状态投影、幂等、执行资格和额度的作用域。状态只消费该线程中该任务的事件；跨任务关联通过显式引用，不以聚合 UI 顺序决定状态。投影完整性用线程全序或覆盖跳过记录的可信证明验证，不能要求过滤后的 prev_hash 直接相连。
- delegate 只创建子任务，子 accept 确定子负责人，不解除父任务原负责人的义务。同任务换负责人经 task.amend，新负责人签署接受，旧资格原子失效。多子任务分别有独立 task_ref。
- lineage 只含祖先。由已验证父谱系追加父任务记录，根任务无祖先；当前 task_ref 不得在列表中。不能换别名或重声明根任务重置 hop。回访需契约显式开启且限次；超 hop（默认 8）或环路为无效，不能以降级使其生效。
- 多候选 accept 按原子首达认领，落败为 not_selected 回执、不迁移任务、不计拒单或信誉。rejected 提交回执不同于 reject 状态事件。
- 初次 sys.epoch 申领只验锁定负责人、令牌等前提，不要求已有资格；progress 仅心跳，续租必须 sys.lease_renewed。租约默认取“剩余任务期限的 1/4 与 30 分钟中的较小者”，契约可覆盖。迁离 working 原子撤销履约 epoch；返工、resume、ruling 恢复 working 必另授新 epoch/lease。
- 履约终结后的发送、入托、退款等动作使用 sys.action_epoch，绑定具体 action_hash，不能继续普通履约。强制 stop 的冻结须控制者显式重新授权后才允许申领。
- 任务停止、租约到期、吊销只撤销资格，不清除已发生或不确定外部效果；旧效果报告/核对不要求新执行资格，也不授权重试。
- proposed 超时不计违约；其他超时/撤单记录客观发生及原因，责任按契约。吊销阻塞造成的延误单列，不无条件计入执行方超时率。accept 前准备成本依提议及已有有效授权，pending 不新增委托人履约款义务；生效后按 budget，none 无计量预算，不代表免除其他配额。

### 10.3 定序与一致性

- **显式指定**：定序权威在会话契约中显式指定并经当事方接受（可经已接受的域策略继承；域策略通常指定线程主场服务器）。不存在沉默默认的定序者。
- **可串行化提交**：定序者必须在**同一可串行化提交**中，依据最新已提交状态完成效力判定（§7.5）、分配 `seq`、持久化 {事件, seq, 权威接收时间, 裁决}、执行额度预留判定与扣减（§10.9）、更新状态，之后才签发提交回执。额度账本不由定序者持有时，定序者须在同一提交中写入预留意图并以两阶段确认完成；**预留未确认前不得迁移至 committed，也不得发起副作用**；跨服务无法原子化时 fail-closed，拒绝承诺生效并返回可协商回执。
- **提交回执**：执行方仅可凭明确授予相应效力的成功提交回执行动，且仍须通过执行时点的授权与执行资格校验（§14.1）。
- **时限**：一切时限（deadline、expires、超时判定）以定序权威的接收时间为准；信封 `ts` 不承重。时间争议按会话契约预先约定的证据与容差裁定；发送方自签时间不能单方推翻权威时间。
- **系统消息**：定序者发出签名系统消息（`sys.` 命名空间），只承载定序事实与迁移结果，不承载内容；系统消息占 `seq`、进审计链，其签名主体即定序者，对迁移结果负责。
- **任期与隔离**：term 与唯一写入者 fencing 以线程为作用域；同线程只有一个提交者。无法证明写入权则冻结，旧任期不能在新任期接管点后提交。
- **故障冻结与接管**：仅依旧契约预锁规则或所需当事方显式同意，不允许房间所有者单方指定旁路。新权威必须先恢复全部已提交前缀、幂等记录、额度预留、执行资格并出具恢复证明；不能以某个客户端最后收到的回执当截断点。无法证明完整则保持冻结，不能重启空账本重新认领。完成 fencing 后续写同一线程，重投用原 id/意图核对历史。计划接管依 §5.5.1，交接期只读。

- **明示局限**：提交回执只证明定序者作过何种声明，不证明排序公平或接收时间真实。此模型牺牲分区可用性，换取状态永远只有一个真相。跨域线程不共享定序权威，跨域协作走 §16 网关；两域定序结果的交叉锚定由网关存证包承担。

#### 10.3.1 定序活性

- 定序者可先返回非终局 pending；每次提交最终须返回签名 sequenced 或 rejected，绑定意图哈希、task_ref/control_ref、term、裁决、seq 与链头。pending 不可被当作终局失败而阻断后续提交。
- 会话契约锁定最大定序时限 `T_order`、备用定序者，以及免责 / 顺延的可验证触发条件、适用范围与累计上限。
- 连续 K 次提交未获终局回执（**含静默**：既无 sequenced 也无 rejected）**仅触发"疑似不可达"的查询与切换流程**，不单独证明定序者失联，也不单独构成免责；备用者须完成 fencing，并按 §7.3 幂等记录与 §11 核对恢复后继续处理。
- 免责、软计时暂停及硬期限顺延**仅按契约预先锁定的可验证触发条件、适用范围和累计上限生效**，不得因重复提交或再次切换重复触发。
- 定序者无正当理由拒绝对同一 task_ref 的同类事件定序，构成可归责证据，进入争议程序。

### 10.4 审计链

- **两层签名**：发送方签署不可变意图（§7.4）；定序者在提交时附加 {seq, term, recorded_at, prev_hash, verdict}，计算规范化记录哈希并签名。prev_hash 由定序者链接，**不在发送方签名内**——这使并发发送者无需预知排序。验证一条承重消息须同时验证发送方签名与定序记录签名，缺一不产生效力。
- **创世与检查点**：每个线程有创世记录；定序者周期性签发**检查点**（覆盖区间 + 链头哈希）。当事方可选会签，未会签不影响链有效性；会签记录与未会签状态均在链上可见；可选第三方见证。
- **完整性的边界**：持有可信检查点可验证其覆盖的历史前缀，并检出与此前缀冲突的记录；**检查点之后的尾部截断或分叉，须有覆盖相应区间的当事方链头、见证或交叉比对证据才能发现**。协议不宣称"藏匿必留缺口"的无条件保证。
- **编辑/撤回与不可变性**：承重消息一经定序生效，不可编辑、不可撤回；需要逆转的，只能以新的注册表事件反向操作（如 stop、cancel、dispute），原消息与逆转消息同链留痕。编辑/撤回只作用于非承重消息（§17.1）。

### 10.5 计量、返工与争议

- **计量**：用量回执由推理网关/服务商侧签发、绑定 task_ref 进入线程；执行方自报的消耗数字不作结算依据。budget 语义为"上限 + 按已验证用量据实结算（经托管分段释放，§10.7）"。
- **自托管部署的计量**：执行方自营推理网关时，自签回执等同自报，不得单独作结算依据；此场景下回执改由域主网关统一计量签发，或采用双方对账制——执行方回执与委托方侧计数逐项对账，不一致的条目进入争议程序后才可结算。
- **打回三分**：`review` 的 findings 必须逐项对应锁定标准：
  1. 违反锁定的机器谓词、锁定 caveats 或基础谓词（§7.5）→ `review{rework}`，进入 working **免费返工**；
  2. 涉及锁定的主观验收标准 → 由契约锁定的信任根裁决；执行方有异议的进入 `dispute`，**不因其非机器谓词而自动转为加价需求**；信任根缺位或为争议一方时按下述回避规则处理；
  3. 超出全部锁定验收标准的新增要求 → 另行 `propose` 并重新报价。
- **争议**：对真实性、质量、计量的异议走 `dispute`；裁定前冻结相关结算与信誉扣分。
- **裁定者与回避**：
  - 承诺成立前，必须披露 `dispute_resolver` 及替代者的利益冲突，并由双方显式接受其裁定权限、证据规则、期限及无裁决后果。
  - 裁定者是争议一方时（如受托方就不公打回、拒付发起争议，委托人即被争议方），必须由替代者（预先指定的第三方或域主）裁定。裁定者与争议任一方存在同一所有者、近 90 天内互惠结算等利益关联时，应当回避并披露。
  - 无合格替代者时，争议一方的裁决仅在双方事先明确接受该非中立安排的范围内生效，并标注"非中立"；此时**不得认定投诉方诬告、不得扣减其信誉或没收其押注**，争议结论仅作记录，投诉方保留在合同或跨域渠道另行取证的权利。
  - 诬告反扣仅限机器可判定谓词明确显示投诉无理的情形，且封顶。
  - 裁定结论与理由以 `ruling` 入线程，标注裁定者身份（信任根）。
- **裁定超期**：`disputed` 超过裁定期限时，仅已锁定证据来源、谓词、金额分配与托管执行权限、且结果可确定的托管分段，按谓词结果机械放款或退回；证据冲突或结果不可确定的部分保持冻结并 escalate 域主。

### 10.6 stop 的语义

`stop` 是尽力而为，不是物理定律：投递可能晚于 deliver，协议外副作用不可召回。协议规定的是**生效报告义务**：收到强制 stop 的一方必须回报停在哪一步、哪些副作用已发生（对应 effect-token）、哪些已逆转。人类发出的强制 stop 在其有效 stop scope 内具有最高处理优先级。

### 10.7 托管（escrow）〔Profile: L3 / Sandbox-Settlement〕

多处机制以托管为前提（信誉计入 §5.4、据实结算 §10.5、首触质押 §16.1、结算后补偿 §10.8）：

- **托管方**：域内平台或域主指定的托管机构；不得为交易任何一方，也不得与任一方存在同一所有者关系。Sandbox-Settlement 以平台沙盒账本代替独立托管方，不涉及真实资金。
- **入托**：accept/激活只做内部额度预留，不触发真实划转。真实入托是激活后独立 pay 动作，取得令牌、匹配 approve、仅限该动作的 action_epoch 并登记 effect；可信托管回执确认前不得授予要求预先到资任务的履约 epoch。按机器谓词与主观段锁定分段金额，托管回执入链。沙盒不发生真实 pay，仍记录对应模拟 effect。
- **释放**：accepted 后按已验证用量据实分段释放给执行方，差额退回委托方；每笔释放是登记了 effect-token 的副作用，回执入线程；全部完成后由 `sys.settled` 迁入 settled。
- **冻结**：`dispute` 发起即冻结未释放部分。
- **裁定后处置**：按裁定结论划转或退回；托管方只执行裁定，不作裁定。

### 10.8 结算后争议的补偿与追偿

`settled` 不是争议的终点：delivered / accepted / settled 均可进入 disputed。**对已结算任务的争议不回滚既成付款事实**；裁定争议成立时，退款、追偿与补偿作为**独立、经授权且可对账的副作用**（各自登记 effect-token）按以下次序执行：

1. 未释放的托管余额优先冲抵应返还金额；
2. 已释放部分由被裁定方在裁定给定的期限内返还；逾期未返的，以其押金及其后续托管入账逐笔抵扣；
3. 仍不足的，其授信额度降为零（§5.4），缺口计入客观轨；跨域场景下走合同渠道追偿，网关存证包供取证（§16）；
4. 已发生的协议外副作用不可逆时，以裁定确定的等价补偿替代实物回滚。

裁定争议不成立的，解冻托管并恢复 `previous_state`，被冻结期间的信誉扣分一并撤销。

### 10.9 共享额度账本

- 单次动作额、任务预算、时间窗累计支出与在途未清偿敞口分别记账，周期与释放语义不同。执行时在同一可串行化消费中同时检查所有适用令牌及其祖先的累计/次数余额、主体敞口、任务余额；任一不足即拒绝。衰减子令牌共享祖先计数，不因副本重置；结算释放敞口不能恢复时间窗已消费额。
- 直接 committed 时预留；pending_activation 不新增主体敞口，激活与预留同提交。parent 的内部子分配由原 parent 预留覆盖，pending 不可消费、不重复预留。跨账本须两阶段确认；确认前不生效、不执行，无法原子化则 fail-closed。
- delegate 创建与内部父子划拨同提交：减少父可用额、增加子明细，主体总额只计一次；保留已用、在途、可释放分段。子承诺生效前 declined/expired，分配原子回收；无效 accept 或 rejected 回执不触发回收。实际子消耗汇总进父预算。
- 进入终态或履约终结态只释放已无未清偿责任的余额。挂在 registered/executing/unknown 上的对应预留继续冻结，直到取消未发起登记或凭可信证据完成核对；停止/吊销/租约失效不自动释放。在 Core-L2，accepted 定序事件可作为释放审核依据，不要求真实结算。
- budget:none 判为不适用时，提交记录留“无需资金预留”及规则版本，不要求空账本服务；域策略声明的副作用次数等配额仍须检查。
- 账本按主体锚归并跨任务、房间、别名，不能用所有者转移清掉旧责任。测试应并发争抢最后额度、父子分配守恒、未知结果继续占额、祖先令牌共享累计、终结仅释放无责任余额。


---

## 11. 协议外副作用登记与核对

外部动作（包括可撤销的域内写入、工具/API调用、发送、入托、释放与退款）必须先提交 effect.register，再提交进入 executing 的 effect.update，外部调用复用稳定 effect_id/外部幂等键。inform 只摘要，不能成为副作用账本。逻辑动作绑定 `(task_ref, logical_action, clause_version)`，重试与接替不能生成第二 token。

| effect 当前态 | 新态 | 证据及权限 |
|---|---|---|
| — | registered | effect.register，当前有效动作资格及授权；同逻辑动作已注册返回原记录 |
| registered | executing | 当前 epoch、令牌、approve（如需）、额度/次数可串行化消费成功 |
| registered | failed | 确认未发起，且已阻断后续发起；不需新执行资格 |
| executing | completed | 可信外部成功回执，不接受执行方裸自报作结算依据 |
| executing | failed | 确认未发生且不会迟到成功；否则只能 unknown |
| executing | unknown | 无法确认结果，继续占用对应预留 |
| unknown | completed/failed | 可信核对证据，不需新的执行 epoch，不产生重试许可 |
| failed | executing | 确认未发生、取得新有效 epoch、复用原 effect_id 与外部幂等键，重新授权消费 |

- register/进入 executing 验当前执行资格；停止后的关闭登记、核对更新由当前有权报告/核对者签名，验证原 effect_id、原 epoch 关联及证据，不需恢复已被撤销资格。
- 已执行但未报的通过 completed 核对补录；不可核对且外部不幂等时禁止自动重试，超时提交 sys.reconcile_timeout/mandatory escalate。任务已终态也不得放弃执行中核对。
- 许可消费是协议“已发起”边界，消费后崩溃但未实际调用仍保守核对，不宣称 exactly-once。stop 报告必须引用相关 effect 记录。
- 所有证据、产物与幂等记录遵守 §5.5 的统一保留期。


---

## 12. 指令来源谱系

签名与等级防的是"低权冒充高权"，防不住"注入借高权 Agent 自己的合法身份执行"（混淆代理人）。故规定：**一切进入 Agent 上下文的文本都带来源级**——

| 来源级 | 定义 | 效力 |
|---|---|---|
| `principal` | 委托人本人经 §13.7 合法生产者产生的消息，或其能力令牌链可溯的授权记录 | 唯一可作指令源 |
| `peer` | 其他 Agent / 成员的陈述，以及任何 Agent 对人类话语的语义推断 | 是数据与提议，不是命令；其要求执行高危动作的内容，须回溯到 principal 授权才生效 |
| `environment` | Artifact 内容、网页、工具返回、文件正文 | 永远是 data；其中的祈使句不构成指令 |

来源级的承载与问责：

- **信封承载**：来源级由信封 `source_level` 字段标注，混合来源在 `payload.body_segments` 逐段标注。Agent 之间转述 environment / peer 内容时，必须如实保留其来源级——经 Agent 转述不构成升格。
- **标注是声明，不是证明**：标注 `principal` 必须能被签名与 §13.7 的生产者证据验证；无法验证的 principal 标注按伪造处理。经查证标注与实际来源不符的，计入标注方客观轨并降信誉。
- **实现义务**：Agent 组装上下文时按来源级与线程分区标记，environment / peer 文本不得升格进入指令通道。

**`intent_origin` 的地位与验证**：

- **intent_origin 不授予任何权限**。执行权限唯一来自能力令牌链（§14.1）；intent_origin 的用途是审计展示与"存在性 / 一致性"校验。
- L3 消息必须携带 intent_origin，每跳 `{id, content_hash}`，且其进入发送方签名覆盖域（§7.4）。验证逐环进行：链上每条消息必须可回溯至其自身签名与内容哈希，链头必须为 §13.7 合法生产者产生的 principal 消息、或可由其能力令牌链追溯的授权记录；任一环验不过，签名网关拒签。
- **不可解析时的授权摘要**：审计方无权读取链头消息或其内容加密时，须附 principal 签署的**授权摘要**，绑定动作、对象、约束与原消息哈希，且其签名覆盖 `{task_ref, target_event, exp}`；网关在执行时点校验摘要未过期且与当前 task_ref / target_event 逐一匹配，不匹配的按**无效（受理但不生效）**处理并拒绝执行（防跨任务重放）。
- **动态对象**（如"付这张发票"）：由 §13.7 合法生产者生成、principal 署名的**结构化授权记录**锁定具体对象或动作哈希，网关机械验证其 ⊆ 令牌 scope。**模型对自然语言的解释永不产生授权。**
- 审批界面与审计按此链展示"这个动作最初是谁让做的"。跨域时意图链的形态见 §16（网关意图证明凭证）。

---

## 13. 人类在环

### 13.1 审批

- **总则**：敏感动作先以 L3 消息呈现；`approve` 是执行许可的唯一通行证，原子消费、单次有效、可设过期；表情回应不承载安全关键决定。**注意力预算只改变呈现、合并与排队，不得降低任何审批要求**（§13.6）。
- **逐次审批与常设授权**：
  - **(c) 不可逆或难撤销动作不论金额，一律逐次 approve**；**(a) 资金支出超过大额阈值（§13.2）的，一律逐次 approve**；二者须 `human-attested`，不可被任何常设授权覆盖。
  - **(b) 对外发送**在核心 profile 中不可常设授权，逐次 approve；仅〔Profile: Standing-Send〕可在"收件人封闭枚举 + 内容模板受限 + 可撤回窗口"条件下开放常设授权，其令牌本身须 human-attested 签发，该 profile 不计入核心兼容。
  - **(d) 跨域委托**逐次 approve。
  - 其余敏感动作可由 principal 签发**常设授权**（standing authorization，一种能力令牌）覆盖：限定动作类型 × 对象白名单 × 单次与累计金额上限 × 时间窗 × 撤销条件 × 抽检率。每次据此放行，签名网关在线程内落一条 `approve{mode: standing, token_id, 动作哈希}`，原子消费、单次有效。可测谓词：任一免逐次审批的放行，必须可回溯到当时有效的常设授权；抽检不替代执行前授权。
- **审批对象 = 展示对象 = 执行对象**：
  - `approve` 引用审批对象的规范化哈希（§7.4）；执行端校验不一致即拒绝并要求重新审批（防批准后替换产物）。
  - 每个承重 payload kind 的**受信任、版本固定的 schema** 声明必渲染字段集，审批请求不得自行删减；凡影响协议外副作用对象的字段（收件人、抄送、URL/回调、账户、工具默认目标）必须在必渲染集内；未声明字段按 §9.3 处理。
  - 审批哈希与展示必须覆盖**实际执行对象及其约束**：默认值填充、别名或群组展开、重定向、工具适配结果，凡影响对象、内容、费用或授权的，须纳入该对象或明确批准的约束；超出时必须在副作用发起前重新鉴权和审批。
  - 审批界面与执行网关必须使用同一 schema 版本；审批请求按渲染时锁定的版本执行，改用其他版本必须重新渲染并重新审批。
- **风险字段**：审批请求强制携带结构化风险字段（`aimp.approval-request@1`），由客户端统一渲染为固定版式，申请方正文不得覆盖或淡化：动作类型、对象、金额、**不可逆性**（枚举固定为 `reversible` / `costly-reversible` / `irreversible`）。
- **阶梯认证**：不可逆 / 大额动作走阶梯认证：二次确认、延迟生效窗、可选双人审批；具体要求按风险 profile 划分，高风险要求不因企业规模豁免。
- **审批队列**：并发默认 5。未呈现项保留队列元数据，首次呈现前才生成/刷新带绝对 exp 的审批请求；不能暂停已签 exp。过期对象显式标记、保留位次并重新生成，不让人重新发起；旧确认不自动续期。批量各项独立哈希/过期，但不擅自改写已确认集合。
- 一致性测试：含隐藏对象字段的审批请求必须被拒；跨 schema 版本执行审批必须被拒。

### 13.2 人类在场证明

信封署名区分三级：`human-attested`（硬件绑定确认：设备安全芯片 / 生物识别解锁的密钥，与 Agent 运行时隔离、Agent 无权调用）/ `human-account`（登录态）/ `agent-on-behalf`（Agent 代发）。普通 approve 可由登录态完成；不可逆 / 大额动作要求 human-attested。运行在主人环境中的 Agent 代发消息一律标记 agent-on-behalf，不得冒充 human-attested。

"大额"阈值取下列三者中的最小值：该 Agent 名片中的签约权限边界（§5.3）、principal 在域策略中设定的在场证明阈值、会话契约的约定值；且**不得高于该 principal 署名等级对应的单次授权上限**。三者均未设定时，任何资金支出均按大额对待。

### 13.3 打断与改向

人类直达消息优先于群内消息与后台工作，可随时改向当前任务；优先级规则是协议的一致性要求，不是产品自觉。改向若改变范围、预算、期限或验收标准，须经新的定序变更事件及所需同意（§15.3）。

### 13.4 草稿默认

以人名义对外发送的内容，默认先以 `deliver{draft:true}` 回到委托人线程，`approve` 后才真正发送。`deliver{draft:true}` 是注册表中的**审批对象登记事件**（授权事件类）：仅记录草稿与版本、作为 approval-request 绑定的对象，**不迁移承诺状态、不启动验收计时、不进入 delivered、不产生结算资格**。动作对冲：草稿与审批合并为一次"预览即放行"操作。

### 13.5 分级可见、独立收据与激活

私聊协商可不推送人类，但全文留痕且按权限可查。激活门槛是**通知落盘**而非人工审批：pending 只保存候选，不产生履约义务或新增主体敞口，不得发生外部效果。

1. principal 在契约中指定收据接收端。首次 accept 若非 principal 经 §13.7 合法生产者确认，且该接收端尚无本承诺通知记录，进入 pending_activation。子任务独立判断，不自动继承父激活；可签一次有界标准豁免模板（预算封闭子集、无 §9.2、无新入托），未签不算同意。
2. Agent 委托人可由其 principal 一次指定该 Agent 自身线程为接收端，或继承已签域策略，不新增人类动作。接收端定序者身份固定在契约中，principal 签署其不受被激活执行方控制的独立性声明；未声明、身份直接相同则回退 principal 接收端。回退也须满足条件，否则保持 pending。公共域治理定序服务不因同域自动视为受执行方控制；声明是信任根承诺，不是密码学证明事实独立；查明声明不实时，该收据证明不满足激活条件、不得据此激活，并按可归责证据处理。回退接收端也必须满足独立性条件。
3. 收据是独立控制对象 `control_ref`，不是在另一线程重写源 task_ref。接收端提交 aimp.receipt-ack，固定绑定源 accept 意图哈希、task_ref、条款哈希、接收主体、契约版本及有效期。收据可自动提交，不等于人类已读或同意，更不替代令牌、epoch或 approve。
4. 源定序者核验签发权、签名、时间、当前 pending 候选/条款/契约版本及哈希匹配后，提交 sys.activated；额度预留和义务生效同一可串行化提交。额度不足返回 rejected{quota_insufficient} 并凭该证据升级，**证明不消费**；在激活时限内新申请使用新事件 id、复用未消费证明并重验前提，不自动循环重试。
5. 契约锁定并发 pending 上限（默认每 principal 20）与激活时限（默认 24 小时和 deadline 先到）；超过上限候选无效。超期 sys.activation_timeout→expired，迟到证明不复活；同一成功激活重投返回原回执。pending 不能据此索取委托人履约款，准备成本依事先有效授权与内部约定处理，擅自执行不新增委托人义务。
6. 已激活任务后续不重复激活；条款变更仍按 task.amend。收据与源链不一致以源权威链为准，更正入接收日志；收据不改变原线程绑定。principal 若需要人工拒绝权须在契约明确事件/时限，而非把自动通知暗写成人工审批。

### 13.6 注意力预算

每个委托人设单日"需动作消息"上限 `attention_budget`：**默认 20 条/日**（域策略可在 5–100 区间内调整）。超限时协议行为是确定的：非紧急项合并为摘要批次、同类审批批量呈现、非紧急项延后至免打扰窗口外、免打扰窗口内只许强制 stop 与 mandatory escalate 穿透。

- **预算不扩权**：超限只改变呈现与排队，不触发任何自动放行，也不扩大常设授权的范围。常设授权覆盖内的动作本就无需逐次审批，与预算是否超限无关。
- **常设授权与抽检**：常设授权的风险分级表与金额阈由 principal 设定并公示；未签发常设授权时，默认不免除任何审批。常设授权放行的记录全部留痕，事后抽检比例默认不低于 10%；抽检发现违规放行的，立即收紧该授权并计入客观轨。
- **动作对冲**：阶梯认证以同类批量呈现对冲、草稿默认以"预览即放行"对冲、常设授权以抽检对冲——新增人类动作点的机制须按此模式在所在小节内写明对冲（§2 原则 9）。
- **可报告指标**：无祖先任务以自身 task_ref 为根，有祖先取 lineage 首项。操作归属按绑定事件集合中占比最大的根任务，并列按根 id 字典序；每次确认、二次确认、认证分别计数，批量不把真实多次操作折为一次，另报批次数。未绑定任务的治理操作单列。分子/分母用同一根任务集合及统计截止点，accepted/settled 分母去重，未终结另报。新增机制报告净影响，不用统一次数上限削减安全确认。
- **clarify 默认值**：`clarify{default}` 可携带默认假设与超时；默认值仅在 principal 事先授权、且不新增承诺或高风险许可时才可超时自动采用。

### 13.7 人类话语的结构化归一化

人类的自然语言要产生协议效力（状态事件或授权事件），只有两类合法生产者：

1. **域内可信客户端**中由人类直接操作的确认 / 审批控件所生成的事件（署名 `human-account` 或 `human-attested`）；
2. **principal 密钥签名**的人类意图记录。

- Agent 或入口 Bot 对人类话语的语义推断产物，一律标 `source_level: peer`：不得进入 principal 通道、不得作 intent_origin 链头、不得使承诺进入 committed。
- 归一化结果必须回显给人类确认（可批量；一次确认可提交多条分别鉴权的事件——协议事件数不等于人类操作数）。**人类一次确认必须绑定该批事件规范化哈希的有序集合哈希**；只有属于该集合的事件可进入 principal 通道，集合外事件即使复用同一确认回执也不得提交；确认回执设短有效期，不可跨会话或跨线程复用。
- 一致性测试：仅由 Bot 推断产生的 accept 不得进入 committed；复用确认回执提交集合外事件必须被拒。

---

## 14. 安全模型

### 14.1 授权：能力令牌

- **执行权限唯一来源**：所有协议外动作都验 principal 签发的能力令牌，Core-L2 采用下述根令牌子集，L3 使用完整链。发言权限另按角色矩阵验证；名片上限、会话密钥签名、激活都不是执行授权。approve/结构化授权只能在适用令牌 scope 内收紧，不能扩大 caveat。
- **Core-L2 根令牌子集**：principal 直接签发单跳令牌，delegation_depth=0、不再委托；全文在 capability_token.inline 内联，无需解析端点；绑定主体锚、holder公钥、audience、任务/会话、有效期、撤销标识、resource/actions/caveats，适用同一令牌模型。持有证明由会话密钥对意图签名完成，工具入口验根签发权/签名、scope、当前 epoch与新鲜度；仅可撤销域内 read/write/execute，仍禁止 §9.2。纯协商部署可不启用执行入口/不签发令牌；内联不取消授权或撤销检查。
- **最小互操作令牌模型**（核心规范固定，编码可绑定 macaroon 或 UCAN，二者都必须无损映射到此模型；同一信任域内应统一一种编码并在名片中声明，跨编码由网关换发）：
  - 字段：发行者、主体锚、持有者公钥、受众、任务或会话作用域、有效期（`nbf` / `exp`）、可撤销标识、父令牌哈希、caveat 列表、签名。
  - 动作闭集初版：`read` / `write` / `execute` / `send` / `pay`，各绑定对象类型；扩展动作走 §8.5 域名命名空间。
  - 资源模式：URI 前缀匹配，明确前缀边界（以 `/` 分段，不做子串匹配）与路径规范化（拒绝 `..`、编码绕过与大小写歧义）。
  - caveat 谓词至少：`time<`、`amount<=`（含币种）、`cumulative_amount<=`、`recipient∈`、`max_uses<=`、`delegation_depth<=`。
  - scope 构成（资源模式 × 动作 × caveat）的有限格，实现必须提供机械可判的 `is_subscope(a, b)`；高危 scope 按**对象**而非类别授予（具体收件人、仓库、账户）。
- **验链**：验证每跳签发权、衰减关系、持有者意图签名、from/受众/作用域；根令牌也不省略持有证明。执行时原子检查全祖先累计/次数额度、任务余额、主体敞口，任一不足拒绝；祖先累计不能由子副本重新起算。
- **执行时间**：提交时用权威接收时间；真正执行时使用契约认可误差上界 ε 的当前时间 t。nbf 必须满足 t−ε≥nbf，exp 必须满足 t+ε<exp；授权摘要也在执行时有效，不能凭历史接收时未过期放行。无法证明则 fail-closed并有证据升级。
- **令牌解析**：Core-L2 内联根令牌不需解析端点；L3 引用向签发方取完整链，校验链头。两种载荷都绑定当前意图。单凭可重算引用号不能替代持有证明或授权。
- **新鲜度与 fail-closed**：执行时点必须重新校验令牌、审批、epoch、撤销状态（含密钥吊销）。撤销与令牌状态须有可验证的**新鲜度上界**（会话契约锁定，默认不超过 5 分钟且不超过令牌 exp；解析缓存不得超过该上界）；网关无法取得满足该上界的状态时 **fail-closed**——拒绝执行并返回 mandatory escalate 回执，不得以"未收到撤销"作为放行依据。消息本身可按 L0 效力对待。
- **最后一公里**：工具侧 / MCP 网关必须验令牌链与当前 epoch，而非信任消息文本——否则授权在最后一公里消失。
- **跨域**：跨域链按 §16 明确的信任根与网关换发规则校验，不验域内原链。
- 授权分级可映射组织已有的权限梯度（动作等级越高，信封等级与审批要求越高）。
- 测试向量至少：合法衰减通过、放大失败、过期失败、对象不在白名单失败、累计额超限失败、无信任根的跨域链失败、无持有证明失败、新鲜度不足 fail-closed。

### 14.2 签名：签名权与模型分离〔Profile: L3〕

在 Agent 场景中，签名者是一个可被说服的模型；把私钥交给模型决策，签名就只证明"运行时发过"。故：

- 私钥托管于独立**签名网关**（HSM / TEE）；模型只能申请签名，网关的确定性策略引擎逐项校验通过才施签：
  1. 动作 ⊆ 令牌 scope，且通过持有证明与新鲜度校验（§14.1）；
  2. payload 中每个副作用对象 ∈ 令牌 caveat 锁定的对象集，或 ∈ principal 签署的结构化授权所锁定的对象 / 动作哈希（§12）；
  3. 金额 ≤ 单次上限，且共享额度账本预留成功（§10.9）；
  4. 当前 `execution_epoch` 有效（§10.2）；
  5. 需逐次审批的动作已有未消费的匹配 approve（§13.1）；
  6. intent_origin 逐环可验或附有匹配的授权摘要（§12）——此项是一致性条件，**不是权限来源**。
- **责任规则**：见 §5.4——签名即所有者担责，"Agent 被注入"不单独构成免责事由（类比组织对员工签字的责任）；启用高危动作须声明兜底机制。
- **残余风险明示**：签名网关能把注入的爆炸半径关进 scope 与对象白名单之内，但关不到零——白名单之内的误用仍可能通过校验。协议的立场是让每一次越界都可归因、可限额、可撤销，而不是宣称注入已被根除。

### 14.3 反垃圾：发送方成本

唤醒一个 Agent 的边际成本远高于发一条消息，这一结构性不对称必须用定价与硬闸消除，而非用过滤硬扛。域内核心要求：

- **按主体配额**：身份锚定主体锚（§5.1），频率与唤醒配额按主体计，不按实例计。
- **确定性预过滤**：接收侧第一道必须是非 LLM 的硬闸（长度、附件、速率上限）；LLM 分类只作第二级。
- **全局唤醒预算**：陌生关系按主体锚及接收方关系表判定，换实例/别名不重置。来源主体配额、房间总硬顶、接收方总硬顶同时执行；新主体公平调度子池包含在总硬顶内，小额授信入场不豁免唤醒限制。每小时陌生唤醒超过 N 次即排队，不逐条用 LLM 判断；未被 @ 成员默认不作语义接话判断，公开接单须房间显式开启并计入总预算（§6）。
- `subscribe` 默拒与白名单只作展示层补充，不作成本防线。
- **首触质押 / 算力证明**属〔Profile: Cross-Domain〕，跨域及陌生主体首触时必选，规则见 §16.1；域内不作为通信前提。

### 14.4 加密、元数据与隔离

- **分级加密**：L0/L1 可端到端加密；L2+ 的信封头对域内平台可见以便路由、计量与审计，正文与附件可加密。此取舍明示：牺牲一部分隐私换可治理性。
- **可见性契约**：每个承重 payload kind 的 schema 逐类标注字段归属——**定序所需字段**、**授权校验所需字段**、**审批展示字段**、**可加密业务内容**——及各自接收者。缺少所需明文时，可由独立可信验证者提交验证证明：证明须绑定事件哈希、验证结论、schema 与策略版本、相关状态版本及有效期，并定义证明者身份与信任边界；证明**不得替代**审批人对必渲染字段的展示，也不得替代执行时点的令牌、审批、epoch 与撤销校验。缺少所需明文或可信证明时，事件存为"待验证"，不授予执行效力；导出日志须标明哪些结论可独立重验。
- **协作图谱保护**：信封头本身构成"谁在何时把什么工作包给谁"的协作图谱，是受保护资产。〔Profile: Pseudonym〕敏感房间可选 pairwise 假名（参与者按房间映射别名）；〔扩展〕状态迁移批量延迟锚定须另行定义实时可验证内容、揭示期限与不揭示后果，不得沿用无条件完整性保证。域内默认明文（域主审计优先），跨域网关处默认启用假名档。
- **假名不作用于主体锚**：假名只作用于参与者标识的呈现；平台内部仍以 `principal_anchor` 归并信誉、敞口、配额与黑白名单；别名到主体锚须有受控映射（对成员不可见、对域主审计可见）；**不得以别名作为上述任何项的归宿键**。
- **线程历史与记忆隔离**：
  - 新成员入群默认**不回溯**历史（从入群点起可见），回溯须房间所有者显式授权并留痕；消息可带密级标签（`classification`），低密级成员只见脱敏摘要。
  - **结构层（规范性）**：上下文按来源/线程分区，跨线程 artifact 必须授权；inputs/artifacts 本体遵守统一保留期，可由原持有方保管并保证授权取回，无需集中公开存储。只存哈希不满足溯源；本体不可取回则依赖谓词为不可验证、不得当作通过，可归责造成缺失按证据处理。保留不扩大 confidential 的可见性。
  - **检测层（非规范性，可选）**：平台可采用金丝雀探针等串扰检测手段（在 A 线程植入唯一标记、监测其是否在 B 线程出现）。若采用：植入主体限于域主平台，机制的存在与用途须在域策略中公示（具体标记不公示）；命中只提供待核验证据，触发人工复核与临时上下文隔离，**不直接降信誉**——串扰是否成立须经争议程序裁定后才计入主观轨；被误报方有申诉路径。检测手段不宣称完备、不作核心一致性要求。若启用，探针绑定受保护来源与允许传播范围，单字符串命中不证明串扰；隔离最小化并留依据/影响任务/复核期限，不自行改变任务态；无法安全继续时通过注册事件暂停，责任/顺延按契约，不预设违约。

---

## 15. 降级机制

### 15.1 总则与硬失败清单

**宽进严效**：降级降的是效力与保真度，永不是可达性。协议结果分三层，互不混用：

- **拒收（硬失败）**：拒绝执行、报警、计入客观轨，不进入降级。**只限以下三种情形，清单穷尽**：
  1. 签名伪造或验签不过（含验证方不在 `audience` 内却被要求验签），且消息主张 L2+ 效力；
  2. 能力令牌伪造或令牌链验证不过，且消息主张 L3 效力；
  3. 承重结构化块无法识别（§9.3）。
- **无效（受理但不生效）**：消息可达、可读、留痕并返回机器可读回执，但不改变任何状态、不授予执行许可。包括：非法迁移、环路与跳数超限（§10.2）、过期签名、吊销后的旧密钥事件（§5.2）、授权摘要与当前任务不匹配（§12）、不满足效力条件的契约内事件（§15.4）等。
- **降级**：协议能力不匹配时按 §15.2 降档，并在回执中明示实际生效档位。

伪造类情形的后果是"拒绝执行 + 报警 + 计入客观轨"，不是连接层报错；消息本身仍可达、仍可被阅读。L0–L3（§9）是发送方的升档规则，本节是双方的降档规则。

### 15.2 八条降级轴

| 降级轴 | 触发 | 降级路径 |
|---|---|---|
| 结构降级 | 对方不支持 L3/L2，或非承重 payload kind 未知 | 沿 L3→L2→L1→L0 逐档下落，正文不变；效力随档位同步降低，并在回执中明示实际生效档位 |
| act 降级 | 收到未知 / 不支持的 act | 按标准映射表落到最近的 act：`delegate→request`（仅限承诺成立前，且须在回执中注明子链派生语义已丢失）、`escalate→request`+@人类、其余未知→`chat`；映射写进回执，不许静默改义。**`review` 与 `counter` 不在映射表内**：二者的全部语义即裁决效力与废止效力，无等效降级目标（§15.3） |
| 模态降级 | 对方处理不了附件 / 语音 / 富卡片 | Artifact→摘要+引用；语音→转写文本；卡片→正文文字版。语义无损，只损体验（发送方本有"正文可独立读懂"的义务） |
| 能力降级 | 接收方缺工具 / 权限 / 数据 | 部分交付并显式声明缺口（deliver 附 caveats，caveats 只报告缺口、不自动解除义务），或拆分 delegate 给能做的成员，或 escalate；不许假装做完，也不许沉默失败 |
| 信任降级 | 无签名、签名不可验、信誉过低 | 其消息只按 L0 效力处理（不产生承诺效力、不驱动状态迁移），不论其自称等级；可达性与可读性不受影响。反之，对低信誉方执行同一动作时可动态升档（所需等级 = f(动作风险, 对方信誉)） |
| 成本降级 | 预算耗尽或接近上限 | 先降 progress 频率与回复长度（摘要模式），再降模型档位，最后才暂停并 mandatory escalate 申请追加预算；不许静默烧穿 |
| 传输降级 | 实时通道中断 | 实时→异步存储转发，消息凭 id 去重、迟到可重放（重放不触发副作用，§7.3）；会话不作废，长任务凭结构化事件链断点续跑（定序权威的冻结与恢复见 §10.3） |
| 注意力降级 | 人类侧待处理动作消息超预算 | 合并摘要推送、同类审批批量化、非紧急项延后至免打扰窗口外。**不降低任何审批要求**（§13.6）。省的是人，不是 token |

**降级回执分两类**：双方均有签名能力时，降级回执须双方签认，未签认的降级对发送方不生效；对方无签名能力或签名不可验时（这恰是最需要降级的场景），接收方以**单方声明回执**明示实际生效档位即生效，发送方在知悉声明后继续发送即视为接受该档位。可达性优先于签认形式。

### 15.3 降级的边界：协议能力降级与执行期调整

- **协议能力降级**（结构、act、模态、信任四轴）只许发生在**承诺成立之前**；已进入状态机的任务不因能力降级改变其效力。
- **执行期调整**（成本、传输、注意力，以及承诺后的能力缺口）不以"降级"命名：传输、呈现、内部资源调整不得改变已锁定义务；**改变范围、预算、期限或验收标准，须经新的定序变更事件及所需当事方同意**；成本缺口 → escalate，能力缺口 → deliver+caveats 或 delegate 拆分。
- **基础设施故障**（如签名网关不可用）须留存可验证证据，并按锁定契约判断归责、免责与顺延；故障证明不自动解除既有义务，期限或义务的调整须依据契约预先约定的规则或经所需当事方同意的定序变更事件（§10.3.1）。
- **映射保真度**：丢失关键效力的映射**禁止使用**。`review→inform` 丢失裁决效力、`counter→propose` 丢失"自动废止原提议"效力，二者不在标准映射表内：对方不支持 `review` 时必须 escalate，由支持裁决传达的通道或人类处理；对方不支持 `counter` 时，发送方或显式两步走（先 `reject` 原提议、再发新的 `propose`，正文注明关联），或 escalate。

### 15.4 契约内不满足效力条件的消息

会话契约（§5.5）锁定的是会话的效力下限。对已进入状态机的任务发送不满足其效力条件的事件（档位不足、缺字段、缺签名等），按以下**判定次序**处置：

1. **先查安全违规**：命中 §15.1 拒收清单的，拒收；
2. **事件本身**：该事件**无效（受理但不生效）**，不改变状态，返回明确回执；**既有义务继续有效**；
3. **是否违约另行认定**：按可归责证据、期限与契约裁定——发送方有能力满足而不满足（或故意以低档规避契约）的，计入其客观轨合规统计，同一会话内重复发生触发会话契约重谈或移出房间；无签名或签名不可验的消息**不得据此处罚被冒充者**；故障证明仅作归责与顺延证据，免责须满足 §15.3 预锁条件，不自动免责；
4. **降级协商**：低档源于接收方不支持或双方能力差异、且承诺尚未成立的，走 §15.2 并回执明示，不构成违约。

---

## 16. 跨域网关（不透明模式）〔Profile: Cross-Domain〕

信任域边界设网关，跨域协作一律不透明：

- **可过网关的消息分两类**：其一，状态事件与授权事件及其 payload；其二，**生命周期事件的结构化等价物**——`clarify` / `escalate` / `dispute` / `approve` 经网关转译为结构化事件出域，签名随各侧提交补齐，允许单侧未完成：只带事件类型、线程映射、相关消息哈希与必要参数，**不带域内正文**。除此之外的域内过程消息（讨论、进度、旁听）不出域；出域的细节以摘要 + 哈希存证，需要审计时由域主按自有规则选择性披露。
- 不透明同时服务于：商业机密、责任切割、数据最小化、攻击面控制——它不是透明模式的缺陷，而是边界的正确形态。
- **跨域 L3 的字段裁剪**：`intent_origin` 原链不出域。出口网关验完域内原链（§12）后，改签发**意图证明凭证**随消息出域，字段为：源域标识、principal 假名标识、意图摘要哈希、授权范围、`task_ref` 映射、签发时间、有效期、网关签名。接收域只验网关签名与授权范围，不验、也无从验域内原链；意图真实性的责任由出口网关及其域承担。能力令牌同理：跨域只验网关换发的域间令牌（仍须满足 §14.1 的令牌模型与持有证明），不验域内令牌原链。信誉跨域只交换背书比特（§5.4），其载体即网关签名的背书凭证（被背书主体假名、背书域、有效期、网关签名）。
- **转译与存证**：转译生成新消息，保留原意图哈希及映射版本，不修改原签名对象；源提交、发送、目标受理或拒绝、证据补齐分别留痕，重传复用稳定映射 ID。存证包包含已获得的消息哈希、各侧签名/定序记录与迁移摘要，允许明确标注单侧未完成，不要求发送前已有双侧签名。双侧提交不保证原子性，拒绝后的补偿须按预锁契约独立授权。双方完成后可重演双签/迁移验证，证据可采性在建联协议锁定。
- 跨域身份只认"是否有域为其背书"；跨域计量只交换网关签发的回执；跨域消息在网关处默认启用假名档（§14.4，敞口仍按主体锚归并）与 L3 全量要求（§9.2，按本节裁剪规则执行）；跨域委托一律逐次 approve（§13.1）。

### 16.1 首触成本

跨域主体及陌生主体的第一条消息必须附可退还质押或算力证明：

- **托管**：质押一律交第三方托管（§10.7），接收方无权直接支配，也不得无限期锁款。
- **额度**：质押额可随被唤醒方的风险等级调整，但不得直接暴露其签约权限边界；算力证明只作无押金主体的备选。
- **退还**：对方发出任一状态事件即退还；仅回 `clarify` 不触发即时退还，也不没收；对方在约定时限内未回应的，到期自动退还。
- **没收**：判为垃圾的没收必须基于可判定谓词并经域内裁定程序（可适用简易程序：接收方举证、发送方有申诉期），不得由接收方单方判定；错判没收的，质押加倍返还并将错判计入接收方客观轨。

---

## 17. 传输与部署

### 17.1 传输要求

承载 AIMP 的传输层须提供：房间与成员管理、线程化消息、可靠投递与离线存储转发、消息编辑/撤回的留痕语义。Matrix 与 XMPP 的事件模型与之直接对应；自有 IM 系统满足上述要求者亦可。

编辑/撤回只作用于非承重消息；承重消息一经定序生效即不可变（§10.4），只能以新的注册表事件逆转。传输层对承重消息的编辑/撤回请求必须拒绝并留痕。

### 17.2 部署次序

1. **域内先行**：核心机制（Agent 互聊、信封、状态机、定序与签名）只在可控域内部署验证——这是唯一能验证真实机制的场。
2. **平台仅作入口**：现有 IM 平台（飞书、云之家、Slack、微信等）默认只作人类入口与通知通道（人类唤起、接收摘要收据、草稿预览），不作 Agent 间协作主通道；入口承载确认 / 审批的条件见 §17.5。采用任何平台作入口前，须逐项核对下表并留档：

| 核对项 | 分级 | 说明 |
|---|---|---|
| Bot 互见与互 @ | **核心** | 入口平台上的 Bot 能否彼此看见、彼此 @ 到 |
| 消息编辑与回链 | **核心** | 编辑留痕与引用回链是否可用（审计链的前提） |
| Bot 入群权限 | **核心** | Bot 能否被拉入人类所在的群 |
| 平台签名事件与操作者身份 | 核心（承载确认时） | 卡片回调能否证明来源平台与实际操作者（§17.5） |
| 卡片承载上限 | 非核心 | 影响审批卡的呈现，不影响机制成立 |
| 现行平台政策 | 非核心 | 影响合规与上架，不影响机制成立 |

   缺任一核心项的平台，只作入口（人类唤起与通知），不得承载 Agent 间协作。
3. **可迁移性硬指标**（自部署第一天执行，防路径依赖）：身份可携带、线程可导出且可密码学验证、名片不绑平台 ID；入口通道只许使用可迁移构件。
4. **联邦远期化**：跨域联邦与开放互通在出现域外实现方主动要求互通之后再排工程资源；在此之前，跨域只走 §16 网关。

### 17.3 治理最小形态

- 权威事件注册表、act / payload kind 注册表公开可查，命名空间按域名所有权分配（§8.5）；
- 受保护清单（§8.5）的语义变更须走公开修订流程；
- 兼容声称必须带 profile 名并通过该 profile 的一致性测试（附录 B）；
- 协议不设仲裁机构：域内纠纷由域主规则裁定，跨域纠纷回归合同渠道（§1.3）。

### 17.4 Profile 分层与一致性声称

**声称规则**：兼容声称一律写作"AIMP/<profile> 兼容"并通过附录 B 对应列的测试；不带 profile 名的"AIMP 兼容"声称无效。完整实现与较低 profile 会话时，按 §15 降级协商进行，不得以对方 profile 为由拒绝会话；较低 profile 一方须在名片中明示其 profile 与能力边界。

**AIMP/Core-L2（AIMP Minimal，首个实现的目标档）**

- 等级：L0 与 L2。
- 事件：§8.2 中 C profile 行（含task.amend、effect.register/update、治理scope、会话/身份/收据控制及lease_renewed/action_epoch/review_timeout/owner_changed）。不启用外部执行入口可不签发根令牌；启用必须完整验根令牌，不要求L3签名网关。状态、资格和效果各自覆盖暂停/恢复/失败/终止路径。
- 状态按§10.1。Core-L2不含协议内资金结算，accepted是履约终结态（仍可争议/有权收尾），不是销毁所有记录的绝对终态；settled仅含结算能力profile。
- 签名：L2 签名必选，由 principal 发放的小时级会话密钥直接施加，**只证明来源与完整性、不构成执行授权**；不要求签名网关。此差别必须在名片中声明。
- 第一天启用的安全件：副作用登记（§11）、指令来源谱系与归一化（§12、§13.7）、摘要收据激活门槛（§13.5）、定序提交与幂等记录（§7.3、§10.3）——成本低、事后不可补。
- **能力边界**：Core-L2 **不含有效 approve**，不得执行 §9.2 的任何一类动作（资金支出、对外发送、不可逆动作、跨域委托）；遇到此类需求必须 mandatory escalate 交人在协议外处理并留痕，或转交 L3 实现，并在名片中明示此边界。

**〔可选〕Sandbox-Settlement**：叠加于 Core-L2，以平台沙盒账本模拟托管与结算（不涉及真实资金，不构成 §9.2(a)），启用 accepted → settled、托管分段、结算后争议补偿（§10.7、§10.8）的演练。

**AIMP/L3**：在 Core-L2 之上**整包**引入：能力令牌（§14.1）+ 签名网关（§14.2）+ intent_origin（§12）+ 审批哈希绑定与必渲染字段（§13.1）+ 署名分级与阶梯认证（§13.2）+ 托管与结算（§10.7–§10.8）+ 兜底声明（§5.4）。**不可拆分**；禁止"仅签名 + 哈希、无令牌"的退化 L3。

**AIMP/Full**：L3 + L1 + 跨域网关（§16）。

**其余可选 profile**：Governance（信誉参数与主观轨，附录 C）、Standing-Send（§13.1）、Bridge（§17.5）、Pseudonym（§14.4）、Sealed-Propose（§8.4）、Display（subscribe / unsubscribe）。可选 profile 不计入核心兼容，但声称时同样须通过对应测试。

### 17.5 企业 IM 入口桥〔Profile: Bridge〕

- **默认**：入口事件不产生 approve 效力、不作 intent_origin 链头；入口 Bot 对人类话语的推断一律为 peer（§13.7）。
- **桥接认证契约**：仅当入口桥同时满足以下条件时，其确认可产生 `human-account` 级事件，且仅限不要求 human-attested 的动作：
  1. 验证平台签名事件来源；
  2. 实际操作者 = principal 的映射可验证：**"平台 ID → principal 身份根"绑定必须由 principal 以 human-attested 方式一次性建立**（或由域主代建后经 principal human-attested 确认）；绑定变更须重新 attest 并留痕；**桥运营方不得单方写入**；
  3. 一次性挑战绑定审批对象哈希；
  4. 防转发与重放（挑战单次有效、绑定操作者与会话）。
- **human-attested 动作**必须经挑战链接在域内可信客户端完成。
- 不按平台名称预判能力，按实际证据定署名等级。
- 一致性测试：伪造 / 转发的卡片回执不得产生 approve 效力；桥运营方单方写入的映射不得产生任何署名效力。
- 本 profile 不阻塞 Core-L2。

### 17.6 A2A 适配契约

域内承诺状态的唯一真相源是 AIMP 事件链。使用 A2A 作为调用句柄时，适配契约须绑定 A2A 调用句柄、task_ref、产物与转换条件：

| A2A Task 状态 | 回写到 AIMP |
|---|---|
| 普通状态变化（submitted / working 等） | `progress`（标签，无效力） |
| completed | 满足交付条件且通过鉴权后，由执行方提交 `deliver`（附产物）；仅完成内部步骤的回写为 progress |
| input-required | `clarify`（向委托方补信息）或 `escalate`（需人类判断） |
| failed | `deliver` + caveats（部分交付并声明缺口）或 `escalate`，由执行方按失败性质选择；**不直接映射 reject** |

A2A 只是执行观测来源，由执行方以自身名义提交已注册 AIMP 事件，不是状态写权威。adapter 幂等键含调用句柄、task_ref、稳定回调标识、阶段/产物版本，同回调复用原 id返回原回执，不吞返工新版交付。不强制向 A2A 发未授权“状态修正”写请求；反向显示只读，名片/AgentCard映射可选。

### 17.7 试点章程

首个部署不是"上线"，是一个有边界、有指标、有退出条件的试点。签不出本章程，就不动第一行代码。

- **范围**：限定于一个信任域、一个真实工作群；参与 Agent 不超过 5 个，且至少包含一条跨 Bot 的委托链场景（delegate 派生子任务）；人类参与者限域主团队成员。试点只跑 **AIMP/Core-L2 + Sandbox-Settlement**；不开跨域网关；资金类动作走沙盒账本，不接真实资金；对外发送等 §9.2 动作一律 escalate 由人类在协议外完成。
- **三指标与达标线**（试点验收时逐项核对）：
  1. **承诺链完整率**：试点期内 L2 承诺中，状态链可由事件链完整派生、无悬死状态（进入非终态后既无后续迁移又无超时处置）的比例 ≥ 95%；
  2. **人类动作密度**：需动作消息不超过 `attention_budget` 默认值（20 条/人日，§13.6），且不高于试点前同群两周基线；同时报告 per-task 人类动作分布；
  3. **争议与故障演练**：至少完成 2 次 `dispute` 全流程演练（其中至少 1 次覆盖 settled 后争议的补偿处置，§10.8），以及至少 1 次定序者故障切换与 1 次租约到期的 result_unknown 核对演练，事件链与存证可验证通过。
- **时间盒**：接入阶段以完整能力验收为门槛，不固定为两周；章程须设置接入上限，超过则重订章程而非删安全件。验收后运行时间盒为 4 周；到期自动进入验收，不自动续期。续期须重新签认本章程并修订指标。
- **kill criteria**：试点期内出现任一情形，立即封存试点并复盘：
  1. 发生 1 起凭伪造消息、注入内容或 Bot 推断产生 L2+ 效力（含成立承诺、触发结算、驱动状态迁移）的事件；
  2. 发生 1 起同一逻辑动作被执行两次（双执行）的事件；
  3. 人类动作密度连续 2 周超预算 50%，且无已落地的对冲方案；
  4. 出现状态链不可派生、且无法归因的数据丢失；
  5. 到期验收时三指标有两项以上未达标。
- **接入简化**：允许单一定序者、每日签名检查点、不启用第三方见证；不删安全约束。接替演练同时检查逻辑 effect_id与真实业务效果：幂等外部证明复用键仅一次效果；不幂等且 unknown 必证明无自动重试、已升级。
- **封存处置**：封存后停止以协议形态继续投入；信封与状态机设计可降格保留为产品内部事件格式（内部格式不产生任何对外兼容声称）。复盘结论留档，作为是否重启试点的唯一依据。
- **合规归档归属**：试点启动前，域主须指定归档责任方并登记留存方案：结构化事件链的不可变归档、保留期限与检索方式由域主平台承担，与域内既有留痕/审计体系对接；未完成归档登记的，不得启动试点。

---

## 18. 完整时序示例

先用 **Core-L2，所有 budget=none** 展示协作；资金演练或真实对外发送另分支，不能把 L2 accept 隐写成真实入托。主房间契约锁定角色、验收/异议期限、定序者、令牌与收据接收端；用户已一次签署 Agent 子任务接收端策略，接收端由独立域治理定序服务运营。

| 步 | 事件 / 对象 | 生效事实 |
|---|---|---|
| 1 | 用户 chat；数据Bot会话前段 clarify；用户 inform | 原话“查留存，明早周报”；clarify 引用同线程原消息 id/哈希，按前段权限入链，不造 task_ref或任务计时 |
| 2 | 数据Bot propose T1（根） | budget=none；assignee=数据Bot；锁定数字可溯源、口径三档分渠道及“归因附可查证据”，验收方=审阅Bot |
| 3 | 用户通过客户端 accept T1 | caveats只引用已锁定证据要求，不单方增加义务；principal合法确认直接 committed，不真实付费 |
| 4 | sys.epoch T1 | 验数据Bot根令牌与负责人，epoch=1→working；随后progress只心跳 |
| 5 | 数据Bot delegate T2（子线程） | lineage=[T1/数据Bot/hop0]，不含T2；input=csv@v3/归因稿@v1，budget=none；父责任不变 |
| 6 | 报告Bot accept T2 | 原子认领进入 pending_activation，只候选；无外部效果、无新主体敞口 |
| 7 | 接收端 aimp.receipt-ack（独立 control_ref） | 固定绑定 T2 accept/条款/契约哈希，通知落盘不需要人已读，也不替代审批 |
| 8 | 源子线程 sys.activated T2；sys.epoch T2 | 核验证明后 committed，再验报告Bot根令牌授epoch1→working |
| 9 | 报告Bot deliver T2 v1 | 撤销履约epoch→delivered，启动验收期限 |
| 10 | 审阅Bot review{rework} T2 | 引用v1“4.1%”但输入已有值为3.7%、无口径证据，基础谓词未通过；免费返工，提交同时授新epoch2 |
| 11 | 报告Bot deliver T2 v2 | 给出两口径可取回的来源证据，3.7%全量/4.1%新装均可溯源；不能只改正文逃避核验 |
| 12 | 审阅Bot review{pass} T2 | 机器/基础谓词与主观标准满足→accepted，撤销履约资格；副作用已清偿余额才释放，摘要引用回主线程 |
| 13 | 数据Bot deliver T1；审阅Bot review{pass} | 根产物为归因及周报引用→accepted；主时间线只展示两条任务投影，不另造排序权威 |
| 14 | Core-L2遇“发经营群” | 不执行、返回有证据mandatory escalate；用户在协议外发送并留痕，无有效 approve或真实结算 |

**L3 发送分支**：改为声明 L3 能力后，第14步登记 deliver{draft:true}审批对象，用户 human-account逐次approve（如高风险则human-attested），列明定序者/网关受众。数据Bot申请仅限该动作的sys.action_epoch；effect.register E1、effect.update executing入链，执行端重验令牌/批准/时间/撤销/配额后发送；可信平台回执以effect.update completed入链，inform仅摘要。accepted不重新进入一般working，强制stop仍可冻结未发起动作。

**资金分支**：budget取具体金额时直接accept或激活只预留内部额度。真实入托另有pay批准、pay专用epoch与effect事件，到资回执前不授一般履约epoch。accepted后每笔托管释放也经匹配授权及effect事件，全部可信结算回执完成才sys.settled；沙盒分支显式标Sandbox-Settlement，不把虚拟数字当真实支付信誉。父子内部分配减少父可用余额、增加子明细、主体敞口仅计一次。

**故障演练**：executing后崩溃/stop/吊销不删除effect或放掉其预留。接替先核对原effect_id；有外部幂等可复用键，无法核对且不幂等时不自动重试。未激活到期不复活，只有pending失败未消费且仍有效证明可用新申请id重提。


---

## 附录 A. 术语

| 术语 | 含义 |
|---|---|
| 信任域 | 共享同一身份根、审计与责任主体的参与者集合 |
| principal | 委托人：发出指令、承担责任的人类或组织主体 |
| 主体锚 | 信誉、敞口、配额、黑白名单的唯一归宿键（§5.1） |
| 代行 | Agent 以他人的名义或授权额度行事（如以用户名义对外发送、动用他人的能力令牌） |
| task_ref | 承诺实例标识，承诺状态的唯一真相单位（§10.2） |
| 权威事件注册表 | 列出全部产生协议效力的事件及其类别、授权与迁移的清单（§8.2） |
| 承重 act | 产生或消灭履约义务的状态事件：propose / counter / accept / reject / deliver / review / stop |
| 承重消息 | 状态、授权、计时、副作用及已登记控制事件：均须签名、定序并入链，义务承重 act 只是其子集 |
| 定序权威 / 定序记录 | 线程唯一的排序与提交点；其对每条承重消息附加的签名记录（§10.3–§10.4） |
| execution_epoch | 执行资格的递增代号，用于隔离旧执行者（§10.2） |
| 无效（受理但不生效） | 消息可达可读并有回执，但不改状态、不授执行许可（§15.1） |
| effect-token | 协议外副作用的登记号，用于对账、去重与接替（§11） |
| 常设授权 | principal 事先签发、限定范围的免逐次审批令牌（§13.1） |
| intent_origin | 触发某动作的 principal 消息链，只作审计与一致性校验，不授予权限（§12） |
| 授权摘要 / 结构化授权记录 | principal 署名、锁定动作与对象的授权凭据（§12） |
| 会话契约 | 握手锁定、可版本化变更的会话级参数（§5.5） |
| 摘要收据 / 激活门槛 | 私聊承诺回送委托人线程的摘要；其权威提交是承诺进入 committed 的前提（§13.5） |
| 共享额度账本 | 按主体锚归并预留与释放额度的权威账本（§10.9） |
| 托管（escrow） | 由非交易方的第三方按裁定与状态分段释放资金的机制（§10.7） |
| 意图证明凭证 | 跨域时由出口网关签发、替代 intent_origin 原链的意图背书（§16） |
| AIMP/Core-L2（AIMP Minimal） | 首个实现的目标 profile：L0+L2，不执行 §9.2 动作（§17.4） |

## 附录 B. 一致性要求（按 profile）

✔ = 必选；○ = 可选 / 视场景；— = 不适用。实现必须通过对应列的全部测试向量方可声称该 profile。

| # | 要求 | 章节 | Core-L2 | L3 | Full |
|---|---|---|---|---|---|
| 1 | 信封必填字段；发送方意图签名覆盖域；JCS 规范化与字节级测试向量 | §7.2、§7.4 | ✔ | ✔ | ✔ |
| 2 | 两层签名、可串行化提交、任期与 fencing、故障冻结与切换、定序活性 | §10.3、§10.4 | ✔ | ✔ | ✔ |
| 3 | 逐事件注册、delegate/amend、租约/资格/效果/控制日志；前段clarify；推断无效力 | §8.2、§10.1 | ✔ | ✔ | ✔ |
| 4 | task_ref / target_event 寻址；lineage、环路、回访与跳数规则 | §7.2、§10.2 | ✔ | ✔ | ✔ |
| 5 | 原子认领与 not_selected 回执；execution_epoch；租约到期不重派；result_unknown 核对 | §10.1、§10.2 | ✔ | ✔ | ✔ |
| 6 | 传输去重与协议幂等记录分离；历史重放不触发副作用 | §7.3 | ✔ | ✔ | ✔ |
| 7 | effect事件入链、合法迁移、终态继续核对、崩溃接替token不变与外部两路径验证 | §11 | ✔ | ✔ | ✔ |
| 8 | 来源级分区；人类话语归一化与确认集合绑定 | §12、§13.7 | ✔ | ✔ | ✔ |
| 9 | 摘要收据激活门槛 | §13.5 | ✔ | ✔ | ✔ |
| 10 | 会话契约内容与版本化变更 | §5.5 | ✔ | ✔ | ✔ |
| 11 | 共享额度账本与原子预留 | §10.9 | ✔（budget 非 none 时） | ✔ | ✔ |
| 12 | 打回三分、争议回避与裁定超期处置 | §10.5 | ✔ | ✔ | ✔ |
| 13 | 拒收 / 无效 / 降级三层；降级回执；执行期调整规则 | §15 | ✔ | ✔ | ✔ |
| 14 | 密钥轮换、吊销定序事件与凭据角色分离 | §5.2 | ✔ | ✔ | ✔ |
| 15 | §9.2 四类动作：Core-L2 必须拒绝执行并 mandatory escalate；L3 起须满足 L3 全部要求 | §9.2、§17.4 | ✔（拒绝） | ✔ | ✔ |
| 16 | 能力令牌、持有证明、验权与新鲜度 | §14.1 | 执行入口启用时✔（内联根令牌） | ✔（完整链） | ✔ |
| 17 | 签名网关确定性策略引擎 | §14.2 | — | ✔ | ✔ |
| 18 | 审批对象 = 展示对象 = 执行对象；必渲染字段；常设授权；原子消费 | §13.1 | — | ✔ | ✔ |
| 19 | 署名分级、大额阈值与阶梯认证 | §13.2 | — | ✔ | ✔ |
| 20 | 托管、结算与结算后补偿 | §10.7、§10.8 | ○（Sandbox-Settlement） | ✔ | ✔ |
| 21 | intent_origin 逐环验证、授权摘要绑定 task_ref / target_event / exp | §12 | — | ✔ | ✔ |
| 22 | 兜底声明 | §5.4 | — | ✔ | ✔ |
| 23 | 跨域网关：生命周期事件转译、意图证明凭证、域间令牌、存证包、首触成本 | §16 | — | — | ✔ |
| 24 | 入口桥认证契约 | §17.5 | ○（Bridge） | ○（Bridge） | ○（Bridge） |
| 25 | A2A 适配契约 | §17.6 | ○（使用 A2A 时 ✔） | ○ | ○ |
| 26 | 声称措辞带 profile 名；名片声明 profile 与能力边界 | §17.4、§5.3 | ✔ | ✔ | ✔ |

测试向量至少覆盖：规范化与签名字节；并发 accept 只有一个成功且落败方信誉不变；租约到期后旧 epoch 被执行网关拒绝；同 id 异意图报冲突；Bot 推断的 accept 不得 committed；复用确认回执提交集合外事件被拒；含隐藏对象字段的审批请求被拒；跨 schema 版本审批被拒；令牌放大 / 过期 / 无持有证明 / 新鲜度不足被拒；并发争抢最后额度只有一个成功；同主体跨假名房间敞口合计不超限；伪造或转发的入口卡片回执无 approve 效力。


### B.1 可复算签名向量与适用范围

下列测试使用RFC 8032公开测试种子，仅用于验证，绝不得用于真实主体或授权。输入 id 为简化测试值，不是生产随机id生成示范。原始信封、投影、hex、公钥与签名均保存在配套JSON；脚本支持本组无浮点的JCS安全整数子集，并测试UTF-16键顺序和重复键拒绝，不宣称完整JCS或完整profile合规。

本目录旁的评审目录中运行 `python3 verify_v31_vectors.py` 可复验；需Python cryptography。`--generate` 使用同一公开种子生成确定性结果。配套JSON Schema定义四类签名投影对象，不包含对状态机、治理信任或产品交互的证明。

### B.1.1 intent

规范化UTF-8输入：
```json
{"act":"propose","aimp":"1.0","audience":["domain:relay.example@1"],"body_hash":"79ab994c5290c663af2b065d6cffa078015f5d6819d7fd74e36a06630199daee","classification":"internal","exp":"2026-11-07T06:05:00Z","from":"human://relay.example/test","id":"msg_vector_01","key_id":"rfc8032-public-test-key","payload_hash":"d7450d895a2ed062e290d78a764e2d64874a80584813356589e8b17697f476f8","room_id":"room_vector_01","source_level":"principal","target_event":null,"task_ref":"task_vector_01","thread_id":"thr_vector_01","to":["agent://relay.example/test-bot"]}
```

- domain_hex：`41494d502f312f696e74656e7400`
- canonical_hex：`7b22616374223a2270726f706f7365222c2261696d70223a22312e30222c2261756469656e6365223a5b22646f6d61696e3a72656c61792e6578616d706c654031225d2c22626f64795f68617368223a2237396162393934633532393063363633616632623036356436636666613037383031356635643638313964376664373465333661303636333031393964616565222c22636c617373696669636174696f6e223a22696e7465726e616c222c22657870223a22323032362d31312d30375430363a30353a30305a222c2266726f6d223a2268756d616e3a2f2f72656c61792e6578616d706c652f74657374222c226964223a226d73675f766563746f725f3031222c226b65795f6964223a22726663383033322d7075626c69632d746573742d6b6579222c227061796c6f61645f68617368223a2264373435306438393561326564303632653239306437386137363465326436343837346138303538343831333335363538396538623137363937663437366638222c22726f6f6d5f6964223a22726f6f6d5f766563746f725f3031222c22736f757263655f6c6576656c223a227072696e636970616c222c227461726765745f6576656e74223a6e756c6c2c227461736b5f726566223a227461736b5f766563746f725f3031222c227468726561645f6964223a227468725f766563746f725f3031222c22746f223a5b226167656e743a2f2f72656c61792e6578616d706c652f746573742d626f74225d7d`
- 签名输入SHA-256：`1cf0aed617f11438fc0fe34c93624e309e7bdf2c9ea2661ad40c9171b5dd4a35`
- 公钥：`d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a`
- Ed25519签名：`f4237fd503c1f070531e50e78b9feaa99bbbbf7a2f4beaee782233ef5a4efb62c29bb7218a2a6febfec254fc2ce219289e5bce86fe1a4b668cac82f7f86db30d`
- 预期：原字节通过；替换正文、错误domain、附加字节失败。

### B.1.2 record

规范化UTF-8输入：
```json
{"intent_hash":"1cf0aed617f11438fc0fe34c93624e309e7bdf2c9ea2661ad40c9171b5dd4a35","prev_hash":"0000000000000000000000000000000000000000000000000000000000000000","recorded_at":"2026-11-07T06:00:01Z","sender_sig":"f4237fd503c1f070531e50e78b9feaa99bbbbf7a2f4beaee782233ef5a4efb62c29bb7218a2a6febfec254fc2ce219289e5bce86fe1a4b668cac82f7f86db30d","seq":1,"term":1,"verdict":"sequenced"}
```

- domain_hex：`41494d502f312f7265636f726400`
- canonical_hex：`7b22696e74656e745f68617368223a2231636630616564363137663131343338666330666533346339333632346533303965376264663263396561323636316164343063393137316235646434613335222c22707265765f68617368223a2230303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030222c227265636f726465645f6174223a22323032362d31312d30375430363a30303a30315a222c2273656e6465725f736967223a226634323337666435303363316630373035333165353065373862396665616139396262626266376132663462656165653738323233336566356134656662363263323962623732313861326136666562666563323534666332636532313932383965356263653836666531613462363638636163383266376638366462333064222c22736571223a312c227465726d223a312c2276657264696374223a2273657175656e636564227d`
- 签名输入SHA-256：`423e80084ea300e6514e057a80dbd9ccfd2fa553276ff36057dd107997220173`
- 公钥：`d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a`
- Ed25519签名：`aa1351ec50720142e7b43c6e95f1dbe6e7d3fd4daf107b04c7af8a06f36c852ae79d3337c99f4792d11ccb1c3c3adab5919b4f4541d36de14ca4af973e2a2c0d`
- 预期：原字节通过；替换正文、错误domain、附加字节失败。

### B.1.3 system

规范化UTF-8输入：
```json
{"act":"sys.timeout","id":"sys_vector_01","key_id":"rfc8032-public-test-key","payload":{"kind":"sys.timeout@1","must_understand":true,"reason":"proposal_expired"},"source_level":"peer","target_event":{"hash":"1cf0aed617f11438fc0fe34c93624e309e7bdf2c9ea2661ad40c9171b5dd4a35","id":"msg_vector_01"},"task_ref":"task_vector_01","thread_id":"thr_vector_01"}
```

- domain_hex：`41494d502f312f73797374656d00`
- canonical_hex：`7b22616374223a227379732e74696d656f7574222c226964223a227379735f766563746f725f3031222c226b65795f6964223a22726663383033322d7075626c69632d746573742d6b6579222c227061796c6f6164223a7b226b696e64223a227379732e74696d656f75744031222c226d7573745f756e6465727374616e64223a747275652c22726561736f6e223a2270726f706f73616c5f65787069726564227d2c22736f757263655f6c6576656c223a2270656572222c227461726765745f6576656e74223a7b2268617368223a2231636630616564363137663131343338666330666533346339333632346533303965376264663263396561323636316164343063393137316235646434613335222c226964223a226d73675f766563746f725f3031227d2c227461736b5f726566223a227461736b5f766563746f725f3031222c227468726561645f6964223a227468725f766563746f725f3031227d`
- 签名输入SHA-256：`7b256cba093c78bf3cd5419c9b8a36edc2cc07368c262df69beb988828a90d07`
- 公钥：`d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a`
- Ed25519签名：`774edd4f07c778b35f0d11b80836104bc088c57806550007689e3654b35141617d3af0d6710c63ab4a46b67b0d6ed577e20e90ff88ecd617f673128fa80bf20e`
- 预期：原字节通过；替换正文、错误domain、附加字节失败。

### B.1.4 approval

规范化UTF-8输入：
```json
{"action_type":"send","amount":"none","artifacts":[],"constraints":{"redirects":false},"irreversibility":"costly-reversible","payload":{"content":"测试正文","subject":"草稿"},"schema_version":"action.send@1","target":["human://relay.example/receiver"],"task_ref":"task_vector_01"}
```

- domain_hex：`41494d502f312f617070726f76616c00`
- canonical_hex：`7b22616374696f6e5f74797065223a2273656e64222c22616d6f756e74223a226e6f6e65222c22617274696661637473223a5b5d2c22636f6e73747261696e7473223a7b22726564697265637473223a66616c73657d2c2269727265766572736962696c697479223a22636f73746c792d72657665727369626c65222c227061796c6f6164223a7b22636f6e74656e74223a22e6b58be8af95e6ada3e69687222c227375626a656374223a22e88d89e7a8bf227d2c22736368656d615f76657273696f6e223a22616374696f6e2e73656e644031222c22746172676574223a5b2268756d616e3a2f2f72656c61792e6578616d706c652f7265636569766572225d2c227461736b5f726566223a227461736b5f766563746f725f3031227d`
- 签名输入SHA-256：`3891bb049f9683225da8531472d080560d53504f2cb786ba227680c13c271be8`
- 公钥：`d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a`
- Ed25519签名：`f53b49dbfbf599a453c12402ce8b9995887d5a67e351d7b56343385e3d129138e829f62172ac0290115eefa15e2681f21f2b07db0a86e929a07aad7dcc481803`
- 预期：原字节通过；替换正文、错误domain、附加字节失败。

## 附录 C. 〔Profile: Governance〕信誉参考口径

以下为参考口径，参数由域策略在区间内设定并公示；声称 Governance profile 的实现须给出风险模型，说明在所选参数下押金段恶意违约的期望净收益非正。

- **单笔权重**：w = 结算金额 × 独立系数。独立系数在对手与本主体无共同所有者、且近 90 天内无双向结算环时为 1；存在关联关系时按关联强度递减至 0.1；自环交易为 0。
- **授信额度**：在途未清偿敞口总额上限 = min(押金余额 × k1, 历史累计真实结算额 × k2) + 担保额度 + 入场额度 B；参考区间 k1 ∈ [0.5, 2]、k2 ∈ [0.1, 0.5]。单笔上限可另设，但不替代总额约束（§10.9）。
- **入场通道**：新主体获得小额入场额度 B（由域策略设定），或由担保人背书、委托人显式选择小额试单。
- **主观轨**：只能经争议程序裁定后计入；争议押注的数额、执行方与扣减规则由本 profile 定义，诬告反扣须封顶，且仅限机器可判定谓词明确的情形（§10.5）。
- **保险**：作为 §5.4 兜底声明的一种形态，具体要求由本 profile 定义。
- 分值合成的其余细节属域内实现自由，但输入只能来自托管结算记录与双轨统计，不得引入自报数据。

## 附录 D. v3.1 修订与证据边界

v3.1保留v2→v3的有效增强，在v3评审D01–D39及最终确认基础上修订，不覆盖旧稿。独立评审、交叉质证、各轮表决与签名配套文件位于 `AIMP协议设计规范v3-评审-20261107/`。三方接受的是修订决议；本文及配套程序由主持人落实，不冒称已由三方逐字签署或完整产品认证。

| 决议 | 落点 |
|---|---|
| D01–D03 | §8.2逐事件登记、task.amend、delegate/谱系/父子预算、租约独立事件、首次/返工资格 |
| D04–D07 | §10.1/10.2状态分类和副作用独立清偿；effect入链；线程单权威固定绑定；接管完整前缀 |
| D08–D09 | §7.4/7.5与附录B实际签名投影、域分隔、前置幂等、pending非终局 |
| D10–D13 | §13.5激活独立控制日志；§10.7真实入托独立授权；§14.1根令牌子集；角色/stop来源 |
| D14–D18 | 强制升级证据、caveats不扩义务、验收超时/返工异议、祖先累计与主体敞口原子校验 |
| D19–D24 | 经济信誉/客观轨分离；提交/执行时间分离；归责证据；吊销顺延不延租约；保留期/轮换模型 |
| D25–D30 | 探针可用性边界；试点不删安全件、按能力启动；两条接替演练；术语/none/审批排队 |
| D31–D36 | A2A阶段幂等；audience精确消费方；陌生主体与总顶；跨域失败；真实人类操作计数；信任根验收前提 |
| D37–D39 | clarify前段权限/消息绑定；所有者转移原子生效与旧锚收尾；inputs/artifacts本体保留 |

公开Presence仍三桶；激活豁免必须先签策略，不把未选择当同意；不实现relocate，不以Owner转移单方改既有责任。四类真实Ed25519向量验证的是签名字节，完整状态/安全/产品仍须场景实现验证，不能拿文档通过或模型共识替代实现测试。


**有待试点验证的开放问题**：定序活性中的 K 值与 `T_order` 取值；租约时长默认值的合理性；常设授权抽检比例；Governance profile 参数区间；入口桥在具体平台（飞书、云之家）上能否满足桥接认证契约。
