# R1问题处置→v2

所有R1评审的实质问题已纳入修订，严重级别有分歧但不影响处理；没有将失败CLI/警告当通过或额度。请对最新全文复核，若没有未解决的安全/需求阻断则APPROVE；可接受将实现验证保留为门槛，设计批准不是代码上线。

## 作者自审
SELF01：§13.1 canonical owner表/旧ID/迁移/fence/回滚，Work只映射已有任务与验证事实。
SELF02：§11.2可强制执行的Agent权限资格、非--plan沙箱、夹具探针、无证明不开放自动执行。
SELF03：§9.2/§14改稀疏已读区间+连续cursor，前台视口1秒/显式全部已读；A36。
SELF04：§9.1 followup上限/ownership/用户routine保护、Hide/snooze；A30。
SELF05：§15.2撤销后投影/模型/导出失效，历史占位，不承诺收回已看/已导出。

## Kimi R1
P0-1：§11.2 binding包含canonical/profile/provider/expected/resolved model，变更新revision并确认/明确事先策略；agent-managed无法证明则unknown可见，不声称模型锁定；A28/A39。
P0-2：§11.5 canonical registry表/别名来源校验/冲突/探测失败提示，权威为共享服务；项目/Room同绑定正负例。
P0-3：§9.2 publish/listSince/markRead/resolveReplyContext与固定助理thread合同；read由用户UI独立写，不让Bot写readCursor。
P0-4：§15.1明确模型/来源读取、已授权项目内写盘/测试、对外发/发布/破坏/付费分类。采纳动作分类和授权边界；不采纳“全部网络/写盘/每次token都确认”的过宽建议：已明确授权目标/来源/预算内应自主，避免破坏原用户主动性要求；外发/高影响默认确认或有效有界事先授权。
P0-5：§15.2紧急停止/撤销先fence，再取消并保留stopping/unknown，与普通暂停区分；A31。
P1-1：§18阶段映射、P0a先探针/P0b复验/P0c主动性，安全底线不拖到P1。
P1-2：§9.1主动reason枚举及3条/Bot/day、10条/account/day新建议上限；§18.1固定40条探针及明确门槛。
P1-3：§14 resuming、host/session/版本/授权/副作用检查，unknown不盲重做。
P1-4：§13.1迁移/服务安装升级握手和§17/P0a/P0b/A27硬门槛。
P1-5：§7交接5分钟超时、有界一次改派/回原owner/用户升级，A33。
P2：变更复跑探针/OS DND与App任一安静/单价来源时间标记，均已补。

## zcode R1
P1-1：§7首次claim(goal,step,revision)CAS/唯一active owner/fencing，与系统指派/交接统一；§14 Goal/Commitment生命周期；A35。
P1-2：§11.2/§16/A28/A39不静默切换，选择主语用户；有事先明确fallback策略才可按策略新建关联run。
P1-3：§18阶段映射，A08首发可用串行而非必须并行worktree，保留安全底线。
P1-4：§13.1/§17/P0a/P0b/A27服务真正交付。
P2-1：§15.2进行中主动取消/边界撤销，未知不假称停止。
P2-2：§11.2 App自有夹具测试、不触达用户真实项目/收件人。
P2-3：§9首发来源清单与scope开关。
建议：已读区间/晨间semanticDeliveryKey去重均补。

## xiaok Desktop R1
P0-1：§18.1路由探针进P0a；冻结40条含4类及10noop，noop10/10不启动成员、必需成员召回≥90%、误唤醒总数≤2、零越权、≤1路由语义调用/条、首轮≤3成员；不达只能显式@内部预览，不能宣称首发完成。小样本只回归，不泛称真实准确率。
P0-2：§14补waiting_budget/waiting_host/paused/expired/checkpoint/Wake validUntil及恢复/过期规则；A38。
P1-1：§7/§14首次认领CAS/唯一owner/lease/fence，A35。
P1-2：§13.1/§17/§19后台安装方式在P0a前定稿、正式交付在P0b。
P1-3：§8区分触发扇出、合法长run deadline、无进展10分钟阈值；开发run建议60min可调，心跳非进展；不按10min硬杀正常构建。
P1-4：§9.2/§14/A36稀疏已读区间，不用max(sequence)清洞。
P1-5：§11.5 canonical权威解析与旧ID映射/防重复/冲突失败。
P1-6：§6首轮一个协调pass+最多3成员并计费；不每成员开场长聊。
P2：实际model进binding/run、晨间与事件语义去重（新实质变化不被“每天一次”误抑制）、Bot可见性主体、replyTo/卡片/唯一相关事项/歧义追问优先级、完整探针门槛已补。

请输出最终评审，最多2000字，不输出思考过程。仅评审正文，不调用工具。不要把设计验收未执行当成设计必然不可批准；应确认验证路径与失败门槛是否明确。
