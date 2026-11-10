# KTeam 工程约定

- 所有代码、配置和项目文档改动必须在分支提交并创建或更新对应 PR，通过 PR 合入主干；禁止直接 push 主干。配套 mydocs 文档在其仓库单独提 PR。

- 产品版本使用简短三段号（如 `0.2.1`），不使用预发布后缀；构建来源通过提交 SHA 区分。
- 中文沟通。产品基线在 `docs/design/baseline-v5/产品设计.md`；消息协议以 `docs/reference/aimp-design-spec-v3.1.md` 为准。
- `docs` 必须是指向 `../mydocs/kteam` 的相对软链接；文档实体只保存在同级 mydocs 仓库的 `kteam/`。新增/修改文档经此链接写入，在 mydocs 中单独检查并提交本任务范围。禁止重新创建实体 docs 目录或复制第二份。构建和测试不依赖 mydocs；链接存在时 `verify:sources` 核对文档摘要。
- KTeam 是独立客户端和服务组合边界。逻辑 Agent/项目/任务由 KSwarm 持有；Room/成员/群转录由 intent-broker 持有。禁止另建可写名册、群转录或项目任务状态机。
- `runtime-core/` 是 KTeam 自己的代码（源自 xiaok-cli `f8728a34`，见 NOTICE），不与 xiaok 同步，也不得重新引入对 xiaok-cli 仓库、`~/.xiaok`、`XIAOK_*` 环境变量或 xiaok 钥匙串/更新源的依赖；`tests/decoupling.test.ts` 守住这条边界。kswarm/intent-broker 等外部源码仍记录在 `sources.lock.json`。
- Electron main/共享 host 持有凭据、文件、进程、后台队列；renderer 只使用白名单语义 API。不要暴露通用 HTTP/文件/子进程接口。
- AIMP 的文档版本是 3.1，信封 `aimp` 字段仍为 `1.0`。自然语言不能授予承诺、审批或执行资格。未实现的能力明确不可用，不声称通过某 profile 的一致性认证。
- `requestSource` 来自认证会话，不能由消息自填。独立客户端凭据、API/schema 握手和写前版本检查不可省略。未知执行/外发结果不自动重放。
- 测试使用专有临时目录和真实隔离服务；按自己记录的 PID 清理，不按进程名批量杀，不运行临时 Electron GUI。
- 验证 `npm run check`；新增行为须覆盖越权、重复、异常和恢复路径。不得以 mock 测试代替真实执行探针或已安装双客户端验收。
- 新仓库不自动创建 CodeGraph 索引；已有索引的来源仓库按该仓库规则先查图谱。
