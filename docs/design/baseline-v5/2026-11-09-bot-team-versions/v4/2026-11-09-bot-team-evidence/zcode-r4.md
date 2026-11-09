结论：通过

**前轮阻断核销**

1. xiaok P1 已解决：§7 确立可信 Goal 服务为唯一分解 owner（lease/fence），模型/Bot 仅 proposal；CAS `append(goalId, expectedDecompositionRevision)` 加 originEventId/proposalOperationKey 幂等，服务分配 purposeSlot/stepKey/stepId，并发分解仅一个 activeHead；同 stepKey 重提不新建 run，替换版本先收敛旧 step，语义不可判定保持 proposal/needs_review、不 mint 可执行 slot；§14 同步子 stepID 生成规则；A46 直测并发分解与非 owner mint 拒绝，A35 保留首次 claim CAS，未以“另取 stepId”绕开。正常分解免逐次确认的风险被“超目标/外部副作用仍按原审批”加 claim/admission 独立闸门约束，无授权扩大。
2. xiaok P2 已解决：§18.1 明示各门槛独立且同时满足（noop 10/10、必需成员召回 ≥90%、sum|P−T|≤2、零越权、每条至多一次 router 调用）；A03/A12 绑定 §8 计数器；A47 限定可注入 clock 只测时序、真实停止仍须宿主证据；§9.2 统一前台可见 1 秒，A48 覆盖双端乱序 union、不重复横幅、新消息不被旧全读清除；hosted fallback 纳入 resolvedModel/unknown 规则（A39 与 §18.1 末句）。
3. Kimi、zcode 非阻断项均按处置落入正文：单次 router 语义、read 区间单调 union、云同步外发授权边界、可控采样参数冻结加 unknown、canonical 三负例（§11.5）、P0c 更正传播（§17）、真实观察集零越权并逐条解释（§18.1 末段），无删改回退。

**五项焦点复核**

- 认领/移交闭环：§6–§8 及 A01–A04、A33、A35、A46 覆盖，“无需用户传话”有可测判据。
- 本地 Agent 与 xiaok 协作空间同权接入、不静默换模型：§11.2 modelPolicy/bindingRevision、§11.5 registry、A06/A24/A28/A39/A43 成体系；外部候选不达标时有“托管-only 内部预览”的显式降级路径（§18.1），不虚标适配。
- 小K主动性/消息感知/未读/回复上下文：§9–§9.2、A18、A29、A36、A48；on-open 晨报与顺序应答两处已知代码事实均被显式列为待改差异而非已具备能力。
- 权限/撤销/外发/停止恢复/独占 owner：§13.1 owner 表、§15.2 fence 加 scopeEpoch、A31/A32/A40/A42，未留第二可写 owner 路径。
- 首发范围与测试可执行：P0a 探针集（F1–F10、40 条冻结语料、安装握手、canonical 正负例）可执行；A45 冻结 B/D 预算跑三条真实链；时序类测试依赖已注入化且不替代真实停止证据。

**非阻断建议（留给实施，不影响定稿）**

1. needs_review 分解 proposal 的裁决主体与时限未写明，建议默认升为 ask_user 并定义过期归档，避免长期悬挂。
2. “首轮一个协调 pass”与分工草案生成若分属组件，目前仅靠 token 分账验证边界，建议 P0a 冻结该 pass 的调用边界定义以便审计。
3. 替换 step 等待旧 step 停止期间的用户可见状态，可并入 A38 的 checkpoint 表述。

未发现 v4 内部矛盾或与已核实代码事实（Room 托管真执行、xiaok-cli ID 缺口、OpenDuet on-open/顺序应答）冲突的阻断项；文档保留“P0a 探针与实现未执行、批准不等于适配上线”的边界声明，各遗留项均有验收门槛而非待讨论状态。同意作为冻结稿通过。
