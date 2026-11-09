# v2→v3 复核处置

xiaok Desktop与zcode已对v2 APPROVE；Kimi v2 REVISE。现v3处理全部实质问题，三方请仅复核同一v3全文及变更，最终输出APPROVE或确切仍未解决阻断。非阻断建议可保留，不把未执行的产品测试当作设计不可能批准。用户要求的原生+外部本地Agent/两客户端/小K主动性首发门槛不降级。

## Kimi v2
P0-1 接受明确化：§6逐成员/拟动作能力匹配，claim+能力+项目/成员/来源+预算都通过才execute；§18.1标签新增执行资格，discussion-only误用于写/执行计越权。
P0-2 接受独立权威交集，不采纳“某一个project验证owner单方面决定全部runtime资格”的混同：§13.1 Binding只维护能力证明不授项目权，项目/workspace当前授权也不能把未满足的adapter变可用，交付验收不授写权。每次admission比较全部当前revision/fence，任一deny或缺失fail-closed；KSwarm保留项目事实owner而Binding保留运行能力证明并不冲突，二者不能相互覆盖旧allow。
P1-1 §6草案proposed+revision，无owner/fence；Bot接受或用户派工同claim CAS，从proposed step取expectedRevision，成功才fence。
P1-2 原问题假设“如果旧ledger有read”与源码不符：assistant-morning-delivery.ts实际claimed/issued/skipped/failed/unknown是投递尝试，不能迁移为已读或改写。§9.2显式说明保留原ledger，新read共享核心writer，UI只报证据，旧入口转发/只读，旧客户端不争写。
P1-3 §15.2紧急停止高优先同步控制命令，不排模型队列；原子scopeEpoch fence后admission写前CAS拒旧版。此前admitted/在途纳入cancel且如实unknown，不能保证收回已发生外部行为；A42并发复验。
P1-4 §16预算P0b校准门槛：冻结3真实链/B/D/模型机器、无人工传话/成本与误唤醒达标、失败不靠提高预算抹掉，版本变化复跑；未知usage不承诺严格token计费。
P2-1 §11.2 F1–F10夹具/实际证据/未验不得授予，跨scope/非零退出/取消子进程/恢复不重复/审批内容变更/身份与usage。
P2-2 §17已有服务门槛，A40添加双客户端/升级回滚单调epoch与单active owner/run日志指标。
P2-3 §9.3按优先级表覆盖DND/quiet/即时/紧急/暂停组合，即时仅App内即时，不能越过OS；A44。

## xiaok v2（非阻断建议全部处理）
P2-1 A39区分expectedModelId可证明与agent_managed/unknown，不承诺未知模型/账单精确；能力包含usage_observability/token_limit，严格预算工作只选合格绑定。
P2-2 §14列全Run状态与允许迁移表，waiting_input/approval分离，stopping/unknown/resuming明确。
P2-3 A41未授来源读取0/无投递，不能用断连当无事项。
P2-4 §18.1明确召回的冻结等价集合/分子分母与总误唤醒成员次数口径（40条全集sum|P−T|≤2），noop单独10/10门槛、零越权。
P2-5 §18.1候选全不合格的P0a结项决策：产品负责人选扩大候选或托管-only内部预览并标需求未满足，不降安全门槛/不称正式首发。
其它：首轮最多3后续按依赖/缺口补其它成员；日期为Asia/Shanghai 2026-11-09，UTC记录2026-11-08是同一时刻，不改成错误本地日期；去掉文字重复。

## zcode v2（非阻断建议）
§18.1真实观察集最少2工作群/30条独立用户意图，脱敏授权和失败桶保留；未接云之家/邮件也不能豁免本机事件主动性。建议P0a并行两候选作为实施效率选择，硬门槛仍至少一种外部实际执行通过，不因候选数多而降低隔离/取消证据。

作者自审v3：上述变化未增加首发范围，只使既有合同可判定；在设计层面无未解决阻断，产品实现/能力探针仍未执行。请独立确认，不需要重复列已被正文明确解决的假设问题。仅输出最终结论（最多1500字）、新阻断或非阻断建议，不输出思考过程，不调用工具。
