# KTeam 工程约定

- 所有代码、配置和项目文档改动必须在分支提交并创建或更新对应 PR，通过 PR 合入主干；禁止直接 push 主干。配套 mydocs 文档在其仓库单独提 PR。

- 中文沟通。产品基线在 `docs/design/baseline-v5/产品设计.md`；消息协议以 `docs/reference/aimp-design-spec-v3.1.md` 为准。
- `docs` 必须是指向 `../mydocs/kteam` 的相对软链接；文档实体只保存在同级 mydocs 仓库的 `kteam/`。新增/修改文档经此链接写入，在 mydocs 中单独检查并提交本任务范围。禁止重新创建实体 docs 目录或复制第二份；CI 先 checkout 锁定的 mydocs revision 再检查。
- KTeam 是独立客户端和服务组合边界。逻辑 Agent/项目/任务由 KSwarm 持有；Room/成员/群转录由 intent-broker 持有。禁止另建可写名册、群转录或项目任务状态机。
- 优先复用 xiaok 现有合同、运行器和服务。源码来源及原样复制文件的哈希进入 `sources.lock.json`；有修改的抽取代码需写明差异和验证。
- Electron main/共享 host 持有凭据、文件、进程、后台队列；renderer 只使用白名单语义 API。不要暴露通用 HTTP/文件/子进程接口。
- AIMP 的文档版本是 3.1，信封 `aimp` 字段仍为 `1.0`。自然语言不能授予承诺、审批或执行资格。未实现的能力明确不可用，不声称通过某 profile 的一致性认证。
- `requestSource` 来自认证会话，不能由消息自填。独立客户端凭据、API/schema 握手和写前版本检查不可省略。未知执行/外发结果不自动重放。
- 测试使用专有临时目录和真实隔离服务；按自己记录的 PID 清理，不按进程名批量杀，不运行临时 Electron GUI。
- 验证 `npm run check`；新增行为须覆盖越权、重复、异常和恢复路径。不得以 mock 测试代替真实执行探针或已安装双客户端验收。
- 新仓库不自动创建 CodeGraph 索引；已有索引的来源仓库按该仓库规则先查图谱。
