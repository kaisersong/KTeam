# 多Bot协作App产品设计：v5增量评审记录

日期：2026-11-09，Asia/Shanghai。

## 当前结论

**v5参考OpenMausBot增量通过。作者Codex、xiaok、Kimi、zcode均APPROVE，无未解决设计阻断。**

- [当前产品设计](2026-11-09-bot-team-product-design.md)：20个主章节，56条唯一验收用例，正文SHA256 `8644218d427851e7671d954dec70d7d30556fa0e5f6b9dde6a3d4048e8fcc428`。
- 基线为已完成四轮评审的v4，SHA256 `92ff0b4dc7d29617023dc5aaee89f3b3e5a9fda74b1c374a337cfd3452bc9056`；[v4原稿和完整历史](2026-11-09-bot-team-versions/v4/2026-11-09-bot-team-product-design-review.md)保持原样。
- 本轮是一轮**完整规范差异与v4兼容性复核**，不是再次全量重新审读v4。评审包包含完整unified diff、v4关键合同、两版hash；[diff](2026-11-09-bot-team-evidence/openmaus-v4-to-v5.patch)与[packet manifest](2026-11-09-bot-team-evidence/openmaus-review-packet-v5a.json)可核对，没有省略变更。
- 批准只适用于产品设计与验证路径；新App、适配、共享服务、真实能力/路由探针仍未实施验证。

## 参考项目和设计取舍

OpenMausBot固定完整SHA `717343f2869d6179e21a301c3b5920953937e231`，源码位于kai-mbp `/Users/kai/projects/refre-proj/OpenMausBot`。本轮只读源码，无依赖安装、产品运行、fixture、真实连接器或电脑控制。

| 主题 | v5处理 |
|---|---|
| 具名Bot、本地driver、单harness | 原有xiaok执行/身份/owner继续复用；借鉴细化合同和不可用原因，不另造运行平台 |
| 频道上下文与谁回答 | 自动/负责人/仅@、稳定Bot/独立会话和scope、可解释路由；保留noop和预算 |
| 主动检查 | 成功来源版本与候选变化后才申请推理预算；读取失败保留cursor，不造无事项结论 |
| 接力与交付 | frontier原子核对、等待精确工作ID、父stream结束不当团队完成、settled不当成功 |
| 引擎/Computer | RuntimeBinding与ComputerTarget分开；VM/云目标不证明本机CLI沙箱，P0不引入新电脑平台 |
| 后续能力 | 团队MD与MCP列P1，受限manifest/预览/新ID/暂停routine；无授权/凭据继承，无审批绕道 |
| 不采纳 | 默认Full、跨engine权限携带、无noop Auto、模型自报completed即验收、Jev0.6/上游评测直接套K-IM |

源码证据：[产品/路由](2026-11-09-bot-team-evidence/openmaus-product-routing-evidence.md)、[执行/审批/恢复/Computer](2026-11-09-bot-team-evidence/openmaus-runtime-permission-evidence.md)。其中已有测试文件/文档或源码常量均不冒充本轮实测。

## 真实评审

| 参与者 | 实际入口与状态 | 结论 |
|---|---|---|
| 作者 | v4基线与完整diff自审 | [APPROVE](2026-11-09-bot-team-evidence/openmaus-self-review-v5.md) |
| xiaok | kai-mbp既有正式Desktop，task `task_mw83abm2_8g5n`，completed，工具0/errors0，无额外Electron窗口 | [APPROVE](2026-11-09-bot-team-evidence/openmaus-xiaok-v5a.md) |
| Kimi | 本机已安装CLI独立headless，exit0 | [APPROVE](2026-11-09-bot-team-evidence/openmaus-kimi-v5a.md) |
| zcode | 本机已安装CLI独立headless plan，exit0 | [APPROVE](2026-11-09-bot-team-evidence/openmaus-zcode-v5a.md) |

xiaok CLI在前轮已证启动/凭据故障，本轮沿用正式Desktop入口，未重复失败调用或改凭据。工具名称不自动等于不同底层模型；实际使用各入口配置，具体模型身份未独立验证。zcode有Built-in provider刷新schema warning，但有效输出且exit0，不当额度错误。本轮**无已确认额度问题、无额度跳过**；若出现额度错误应按用户要求跳过且不计同意。

各方非阻断建议保留在原文，交实施阶段处理，包括负责人模式度量/quiet、频道设置写权限、frontier重判上限、模板预览细节及P1 MCP威胁模型；没有在批准后悄悄改规范正文。新增A49–A56不替代A01–A48，模板/MCP/新电脑平台不挤入首发。

## 文件和运行检查

- [完整性检查](2026-11-09-bot-team-evidence/openmaus-document-validation.json)：56条唯一ID，无缺失相对源码证据链接；最终交付时复核全部相对链接及文件hash。
- 本机首次完整检出因磁盘空间不足中断；只移除了本任务未完成的临时clone，既有文档与应用未动。参考仓库改在kai-mbp稀疏检出，HEAD如上、worktree clean；没有为磁盘空间删除用户其他文件或已有应用。
- 原始CLI日志/模型思考流、任务事件留本机专用`/tmp/xiaok-openmaus-study-20261109`，交付仅最终评审结论/脱敏摘要/源码证据，不导出凭据或公司群原文。
- 未修改产品代码、未发真实IM/日程、未运行参考项目或能力探针；仅参考源码和明确授权的评审任务。未向GitHub发布本设计。
- 临时SSH及本轮评审进程按精确记录回收；保留正式Desktop和原K-IM服务。清理结果见[cleanup](2026-11-09-bot-team-evidence/openmaus-cleanup.json)。
