VERDICT: APPROVE

v4 已解决前轮唯一 P1：§7 引入由可信 Goal 服务持有的唯一分解协调 owner，通过 CAS append、`goalDecompositionRevision/activeHead`、`purposeSlot/stepKey/stepId`、幂等键与 step 执行 owner 的 claim CAS 两层隔离，明确“非 owner 不能 mint 可执行 step”，并配套 A35/A46/A40 等验收覆盖并发分解、并发认领、非 owner 新建拒绝、停止 epoch 与 scope fence。五个聚焦点在文档中均有可验收的约束与探针，未发现未解决的 P0/P1/P2 阻断。

以下是非阻断建议（P2/实施级），不影响当前结论：

1. §13.1 canonical 状态 owner 表格建议补一行：明确 Goal 分解、Commitment 生命周期、Facts/更正的唯一 writer 为“新共享核心的 Goal 服务”，并说明其如何只读引用项目/验收 owner。当前 §7、§14 已定义，但表格汇总遗漏可能让实现侧误判 writer 归属。

2. §7 “用户改派也经同一入口”建议改述为“用户改派经 Goal 分解 owner 入口：先收敛旧 step/run，再生成改派后的 step 并由新 Bot claim”。当前上下文可推导，但“同一入口”与后文 claim CAS 字面接近，易误读为直接 claim 旧 step。

3. §9.2 后台无窗口时的回复解析，建议显式写明不依赖“当前选中卡片/工作”客户端状态；若 replyTo 与唯一最近事项均不足，应直接追问而不是猜测执行。

4. §11.2 F1–F10 探针建议每项补充通过阈值，例如 F5 cancel 后最长等待多久未退出即判 fail/unknown，F7 审批内容版本变化后多旧算失效等，便于 A43 不依赖主观解释。

5. §18.1 真实观察集“30 条有独立意图的用户输入”建议给出统计口径：是否包含用户自身补充说明、Bot 自发言、系统工作更新；避免用 Bot 重复发言凑数。

综上，v4 文档已具备进入 P0a 实施的安全与验收基础。
