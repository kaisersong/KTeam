# v3→v4 定稿复核

Kimi与zcode已对v3批准；xiaok Desktop v3只有一个P1：Goal新建分解/step缺唯一owner和并发裁决。v4聚焦补此缺口，并收敛各方非阻断建议，不改变产品范围和原有门槛。请确认当前完整v4是否无未解决阻断；不要把实现未执行或未来细节当新的产品范围。仅最终结论≤1500字，不输出思考过程，不调用工具。

1. xiaok P1：§7唯一Goal分解owner（可信服务，不要求用户配置主管Bot），持久goalDecompositionRevision/activeHead/owner/fence。模型/Bot只proposal；服务在用户目标授权预算内accept，正常分解无需逐次人工确认。CAS append、originEvent/proposalOperationKey幂等、服务分配purposeSlot/stepKey/stepId，同一目标并发只有一个active分解；二次同stepKey不新建run，替换先收敛旧step，判断不了语义重叠保持proposal/needs_review。A46直接测试两个并发不同分解和非owner新建拒绝。不是用“取不同stepId”绕开首次claim CAS。
2. xiaok P2：§18.1明确所有指标是独立并且同时满足；A03/A12绑定§8计数器；A47可注入clock/budget生产依赖测时序（不能替代真实process停止）；§9.2统一前台可见1秒，A48双客户端已读与不重横幅；hosted fallback同样遵守model/unknown规则。
3. Kimi非阻断：首轮协调就是单次router语义调用；read按(user,conversation)单writer合法区间union，stale区间可合并但不允许回退覆盖/未来seq，显式全读有截止，新消息仍未读；已识别云同步目标按外发授权，不声称能识别所有第三方同步/不反复逐文件审批；模型/温度/top-p/版本冻结，可控项冻结不可知标unknown；canonical三个负例已列出。
4. zcode非阻断：P0b是有效事实版本投影，P0c是更正传播到主动研究/小K；真实观察集零越权，遗漏/打扰逐条解释并进入发布评审。

作者v4自审APPROVE：规范已覆盖原请求、已核实代码差异和所有此前实质风险；P0a探针及产品实现均未执行，不会把文档批准当适配已上线。请对同一v4冻结稿给最终APPROVE/REVISE；如还有阻断必须指出v4实际未解决的具体矛盾，非阻断建议可留给实施而不形成无止境细节扩张。
