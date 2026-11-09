# 多Bot协作App产品设计：对抗性评审与定稿记录

日期：2026-11-09，Asia/Shanghai（原始运行时间使用UTC，部分为2026-11-08，与本地日期一致）。

## 最终结论

**v4设计通过：作者Codex、xiaok、Kimi、zcode均明确批准；没有未解决的设计阻断项。**

主文档：[产品设计](2026-11-09-bot-team-product-design.md)。冻结正文SHA256：`92ff0b4dc7d29617023dc5aaee89f3b3e5a9fda74b1c374a337cfd3452bc9056`。此结论只批准设计合同与验收规范；新App、共享后台服务、Agent适配、P0a探针、真机/CI均未因此视为已实现或已通过。

文档共20个主章节、48条唯一验收用例，包含独立App定位/UX、名字建Bot/群目标分工、长期身份/记忆/共享事实、主动管线、本地Agent能力合同、xiaok协作空间同等接入、小K助理消息/已读/回复上下文、权限/停止/恢复、单owner服务与迁移、预算/故障、阶段和测试门槛。

## 参与者与实际入口

| 参与者 | 入口 | 最终结果 |
|---|---|---|
| 作者 | Codex自审；首轮自查后结合外部意见修订 | [APPROVE](2026-11-09-bot-team-evidence/self-review-final.md) |
| xiaok | kai-mbp正在运行的正式Desktop，真实createTask评审，plan模式、各轮工具调用均0 | [v4正文APPROVE](2026-11-09-bot-team-evidence/xiaok-desktop-r4.md)，[完成确认APPROVE](2026-11-09-bot-team-evidence/xiaok-desktop-r4confirm.md) |
| Kimi | 本机kimi CLI2.4.1，独立headless任务 | [v4 APPROVE](2026-11-09-bot-team-evidence/kimi-r4.md)，exit0 |
| zcode | 本机zcode CLI0.16.9，独立headless plan任务 | [v4通过](2026-11-09-bot-team-evidence/zcode-r4.md)，exit0 |

工具名称不自动代表不同底层模型；使用各工具当时实际配置，没有为了得到同意切换模型，具体底层model identity未独立核验，故不伪称已验证。源码研究另由GPT-6 Astra及只读研究者提供证据，不冒充指定工具的评审。

## 轮次与收敛

| 轮次 | 冻结版本 | xiaok | Kimi | zcode | 处置 |
|---|---|---|---|---|---|
| R1 | v1 | REVISE | REVISE | REVISE | 补能力/授权合同、路由探针、状态机、原子认领、服务交付、消息与未读 |
| R2 | v2 | APPROVE（含非阻断建议） | REVISE | APPROVE | 补权威交集、草案/claim、停止竞态、来源/时钟/夹具/预算口径 |
| R3 | v3 | REVISE：新建分解/step并发缺唯一owner | APPROVE | 批准 | 补Goal分解owner、CAS append、activeHead/stepKey、A46，及非阻断澄清 |
| R4 | v4同一冻结稿 | APPROVE，后作完成确认 | APPROVE | 通过 | 三方无未解决阻断；作者最终自审批准 |

作者R1自审明确REVISE；后续没有把自审初步满意当成一致，接受xiaok R3新增实质问题并继续至v4。每轮版本hash见[manifest](2026-11-09-bot-team-evidence/review-manifest.json)，问题逐项处置见[v1→v2](2026-11-09-bot-team-evidence/disposition-r2.md)、[v2→v3](2026-11-09-bot-team-evidence/disposition-r3.md)、[v3→v4](2026-11-09-bot-team-evidence/disposition-r4.md)。

## 调用故障、额度与准确性

- 未遇到已确认的额度不足，**没有评审因额度跳过**。用户允许额度不足直接跳过的规则已执行为：若返回真实额度错误则记录并停止，不将skip算同意；本轮无此类错误。
- 本机xiaok CLI因无法读取系统钥匙串所需凭据失败；kai-mbp CLI也在启动配置阶段中断。未解锁/更改凭据、未把启动失败当评审通过；改用用户授权评审范围内、正在运行的正式xiaok Desktop。未额外启动Electron窗口。
- Kimi help虽列plan，但实际拒绝`--prompt`与`--plan`合用；按真实错误纠正为prompt模式，在专用中性目录、只评审内嵌正文，无工具调用指令。失败尝试不计评审。
- zcode有Built-in provider schema刷新警告，但最终各轮给出有效结论并exit0。warning不是额度错误或评审失败；未读凭据、未修改配置来绕过。
- xiaok R4确实输出正文APPROVE，但该次hostDelivery在verify阶段因`validation_limit`失败，error=`needs_explicit_followup`。**这次任务终态保留failed，不计作运行成功。** 随后对同一v4作纯文字完成确认，task `task_mw82kz8i_5s1j` completed、工具0、errors0、明确APPROVE；原失败未清除/篡改，见两份summary。
- 评审正文允许有非阻断实施建议；这些保留在最终意见中，不将“批准设计”扩大成“探针/适配已通过”，不在批准后悄悄修改冻结正文。

## 证据与交付范围

- [xiaok本地Agent/Room源码证据](2026-11-09-bot-team-evidence/xiaok-local-agent-evidence.md)
- [OpenDuet源码证据](2026-11-09-bot-team-evidence/openduet-evidence.md)
- [文档完整性校验](2026-11-09-bot-team-evidence/document-validation.json)

原始CLI日志、会话原始事件及失败诊断只在本机专用目录`/tmp/xiaok-bot-team-design-20261109`保留；导出仅最终评审结论/处置/脱敏状态，不导出模型思考流、私人群消息全文或凭据。评审输入仅设计正文及行为摘要，不把原始公司群全文上传Github。

本次没有修改产品代码、没有运行探针/用户项目、没有创建真实日程或向他人发消息；仅写文档、读取参考代码、执行明确授权的评审任务。未向GitHub发布本设计。临时SSH与已完成评审进程按精确记录回收，正式Desktop和K-IM服务保留。
