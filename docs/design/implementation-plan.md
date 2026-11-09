# KTeam 实施计划与 AIMP 接入决议

日期：2026-11-09。产品名称正式确定为 **KTeam**。

## 基线与新增要求

- [产品设计 v5](baseline-v5/产品设计.md)原文与四方评审、48+8 条验收用例冻结保存。SHA-256：`8644218d427851e7671d954dec70d7d30556fa0e5f6b9dde6a3d4048e8fcc428`。
- 本次用户明确要求最大化复用 xiaok、继续使用 kswarm 与 intent-broker，消息协议采用 [AIMP 3.1](../reference/aimp-design-spec-v3.1.md)。协议 SHA-256：`95ef720884deef2ff0d26dba3ebb08713b2d12357ece0647c24c1ce8e22778d0`。
- v5 的用户体验、预算、停止、事实验证和主动消息投递门槛继续有效。AIMP 的效力约束是实现要求，不以本地聊天演示替代。

## 唯一 writer 决议

| 状态/命令 | owner | KTeam 的职责 |
|---|---|---|
| Bot 逻辑身份、Agent catalog、项目/任务/验收 | KSwarm | 稳定 ID 引用及语义命令；当前先读已有名册 |
| Room、成员、群转录 | intent-broker | 转发建群/收发命令；不另存转录 |
| AIMP task_ref、线程定序、契约、effect 账本 | intent-broker 的新增协议模块（待实现） | 编码、展示、向 owner 提交，禁止本地第二 reducer 授予效力 |
| 项目任务/运行状态 | KSwarm / 对应执行 host | 经版本固定 adapter 回写 AIMP 观测；AIMP承诺态与执行观测不是同一个状态 |
| 凭据、文件、进程、真实停止 | 对应 xiaok runtime host | 通过共享执行合同接入；KTeam UI 不能自报实际权限已收窄 |
| 主动性与 due | 既有统一队列 owner | 以 adapter 扩展；不新增第二个 due 扫描器 |
| KTeam 安装与协议 host epoch | KTeam host | 自有小型元数据，不接管上述域 |

## 首批已实现：P0a 基础切片

- [x] 独立 Git 项目、构建、CLI、源码锁定与检查工作流。
- [x] 从 xiaok 原样抽取 `room-workspace-protocol` 门禁和 `RoomExternalDiscussion` 合同（后者暂为共享类型，不宣称执行器已接通）。
- [x] KSwarm Agent/runtime 读取、broker 建群与分页历史的语义 adapter。
- [x] AIMP L0 信封通过 broker 的同一消息事务持久化；ID 去重、异意图冲突、引用回复与回执丢失未知态。
- [x] 独立客户端凭据、Unix socket、API/schema 握手；不兼容客户端只读，缺认证/网页 Origin 拒绝。
- [x] host 独占 OS 锁与递增 epoch；两个客户端共享同一 host；真实子进程并发启动、崩溃接替与正常退出验证。
- [x] AIMP 3.1 四组原始签名向量、UTF-16 键排序、重复键/非法 Unicode/越界输入测试。
- [x] 使用真实 KSwarm HTTP server 与真实 broker Room/store 的隔离联调，不改上游业务代码；测试夹具只限制监听到 loopback 并把实际端口回传。

**此切片不等于 P0a 结项，也不等于设计首发完成。** 当前 L0 不唤醒 Bot、不接受承诺、不执行工具。CLI 中运行时状态展示 `not_verified`，不把项目 harness 的 supported 标记复制成 KTeam 执行许可。

## 下一批的固定实施顺序

1. **AIMP owner 模块**：先在 intent-broker 添加版本化 payload 注册表、独立协议幂等记录、线程定序链和审计回执；受理/无效/待验证/硬失败区分清楚。保留已有 Room ID，不能用 roomSequence 冒充 thread seq。
2. **身份与契约**：生产身份根/会话密钥、principal normalization、三段会话握手、角色矩阵/任务作用域、根令牌、收据激活与撤销。schema/签名/契约须全部核验才产生效力，未知承重 kind 不静默降级。
3. **承诺与项目桥**：AIMP 的 task_ref 固定权威线程，与 KSwarm work/task/run 建幂等映射。Bot 分解只是 proposal，由唯一 owner CAS 接受。A2A/CLI 输出只是观测，不能直接标任务 accepted。
4. **effect 与执行探针**：副作用先登记后执行；unknown 先核对不重放。复用 xiaok hosted worker 与既有项目 harness，原生 + 一个外部候选逐项跑 F1–F10。没有实际隔离/取消证据就不开放自动执行。
5. **服务交付**：正式安装/开机启动、排空升级、schema 迁移与回滚，kai-mbp 两个正式客户端握手和 owner 切换；当前 CLI 自动测试不能代替真机桌面验收。
6. **P0b 独立 Desktop**：名字建 Bot、目标建群、私聊/群聊、认领交接、执行交付、未读、审批、停止恢复。同一 binding 接入 xiaok 协作空间。
7. **P0c 主动性**：统一队列接入承诺/事件跟进，主动消息写进聊天；research 显式启用。冻结 40 条路由集和预算，在真实工作链验证相关性与 noop。

## AIMP 实现边界

- 文档版本 `3.1` 与 wire version `1.0` 不混用。
- 当前解析/JCS 仅支持向量中的安全整数子集，拒绝浮点；不声称完整 RFC 8785 实现。
- L0 完整信封位于 broker `room_messages.source_ref_json`，仅作为对话原文；当前无 AIMP 定序记录，不以存入 Room 冒充协议提交。
- 签名投影明确排除 `ts/locale/sig/sequencing`；它们不参与执行/时限判定。重投相同意图返回原消息；更改有效期、正文或授权内容会改变意图哈希。
- 当前主机 API 是经过本地认证的用户命令入口；没有给 Agent 暴露用户凭据或代填 `requestSource` 的入口。
- 按 Core-L2 首发目标，资金支出、以人/组织名义外发、不可逆动作和跨域委托都必须升级给人，不能用本地产品审批卡伪造有效 L3 approve。
- L0/L1/L2 的展示、完整 Core-L2 所有 C 行、effect/收据、语义路由、共享主动队列和真实执行资格均有未完成项；完整实现须逐项通过 AIMP 附录 B 与产品 A01–A56，不降低门槛。

## 验证记录

每次验证的原始终端输出与进程回收记录保存到本地 `.artifacts/`；版本提交内仅记录可复现命令。`npm run check` 运行源文件校验、8 组测试以及独立 CLI 子进程冒烟。最低 Node 版本与当前版本分别验证，不以 CI 配置存在代替 CI 已运行。
