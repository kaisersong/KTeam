<p align="center">
  <img src="desktop/assets/icon.svg" alt="KTeam" width="120" height="120" />
</p>

# KTeam

> 组建你的 AI 团队，让工作主动向前。KTeam 是本地运行的多 Bot 协作桌面应用：在群聊里让多名 AI 成员讨论、分工、交付，你随时拍板和验收。

KTeam 的协作建立在 **AIMP（Agent Intent Messaging Protocol，智能体意图消息协议）** 之上。这是 KTeam 在技术上与其他多 Agent 工具最大的不同：聊天文字不等于授权，讨论答复也不等于事情已经办完。

[English](README.md) | [简体中文](README.zh-CN.md)

**当前版本：0.3.0。** 安装包见 [GitHub Releases](https://github.com/kaisersong/KTeam/releases/latest)。0.3 是第一个经过苹果签名和公证的版本，仅支持 macOS Apple 芯片（arm64），并带有自动更新。各版本改动见[版本日志](#版本日志)。

---

## 为什么是 AIMP

大多数多 Agent 工具把协作当成一串函数调用或一段自由聊天：要么结构太硬、人看不懂，要么全靠自然语言、说过的话说不清算不算数。AIMP 的思路是：

- **以 IM 会话为顶层。** 联系人、群聊、线程、@提及、引用回复、审批卡这些人们熟悉的协作方式，直接对应到协议里的房间、线程和事件链，人和 Agent 在同一个会话里协商、委托、交付、验收。
- **人可读优先，结构渐进。** 去掉结构化部分，人读正文也能看懂发生了什么；闲聊可以只有自然语言，风险越高、越不可逆的事，结构化要求越严。
- **状态只来自结构化事件链。** 协作状态由已定序、已签名的结构化事件推导，自然语言正文只作证据，永远不直接产生协议效力。
- **承诺必须显形，人类有最终决定权。** 接单、交付、验收要有显式事件；人的消息在优先级、打断和否决上高于 Agent；执行权限只来自可过期、可撤销的能力令牌。
- **不重造传输层。** AIMP 是协作层，跟 MCP（工具层）、A2A（调用层）分工互补，可以跑在现有消息通道上。

完整规范：**[AIMP 协议设计规范 v3.1](spec/aimp/aimp-design-spec-v3.1.md)**（另有[英文译本](spec/aimp/aimp-design-spec-v3.1.en.md)，以中文版为准），配套 [JSON Schema](spec/aimp/aimp-v3.1-schemas.json) 和 [签名测试向量](spec/aimp/aimp-v3.1-test-vectors.json)。

### KTeam 现在实现了哪些

- 信封线格式版本为 `aimp: "1.0"`，对应规范 3.1（[`src/protocol/aimp.ts`](src/protocol/aimp.ts)）。
- 通过规范官方的四个签名域测试向量：规范化字节、哈希和 Ed25519 签名（[`tests/protocol.test.ts`](tests/protocol.test.ts)，向量副本见 [`tests/fixtures/aimp-v3.1-test-vectors.json`](tests/fixtures/aimp-v3.1-test-vectors.json)）。
- 规范化 JSON 子集会拒绝重复键、非法 Unicode、不安全的数字和过深嵌套。
- L0 预览从不把「接受」「批准」或工具调用之类的文字当成授权。
- 已接通 intent-broker 的实验性讨论生命周期。

**KTeam 目前不声明完整兼容 AIMP v3.1，也不声明通过 Core-L2 认证。** 生产身份根、收据激活、完整的状态迁移和执行副作用登记等还没有完成。规范里提到的复验脚本 `verify_v31_vectors.py` 没有随本仓库提供。0.4 会按 v3.1 规范逐条核对实现情况。

---

## 0.3 有什么

- **与小K完全解耦。** KTeam 有自己的应用名、Bundle ID（`com.kteam.desktop`）、数据目录 `~/.kteam/`；内置服务的端口由系统分配，记在 `~/.kteam/service-endpoints.json`，不会和小K抢端口；凭据默认存在 KTeam 自己的私有文件里，主动切换到 Mac 钥匙串时也只用 KTeam 自己的条目。启动和后台运行都不读小K的任何文件。
- **从小K导入模型。** 已经在小K里配好模型的用户，可以在模型设置里点「从小K导入」。只有你点了这个按钮，KTeam 才会读一次小K的配置和钥匙串，复制进 KTeam 自己的凭据，从不改写小K。第一次读小K钥匙串时 macOS 会弹授权框；如果选了「拒绝」，导入会停下并提示你手动填写或重试，不会反复弹框，也不会留下导入了一半的数据。
- **Mac 自动更新。** 只从 [KTeam 的 GitHub Releases](https://github.com/kaisersong/KTeam/releases) 获取正式版本（不拉预发布版，不降级），后台下载，下载完问你是否重启；选「稍后」就在下次退出时安装。也可以在菜单 KTeam ▸ 检查更新… 手动检查。
- **0.2 升级提示。** 0.2 里和小K共用的服务数据不会带到 0.3。如果检测到这种旧配置，界面顶部会显示一次提示和「去设置」按钮，关掉后不再出现。
- **签名和公证。** 0.3 的 macOS 包经过苹果签名和公证。

## 主要功能

- 按名字创建长期的 Bot 成员，每个成员可以单独配置职责、主动性和模型。
- 建群聊，让多名成员讨论；KTeam 会挑选和话题相关的成员发言（也可以都不发言），讨论共识随时记到共享纪要。
- 单成员私聊、组队方案卡片、暂停 / 继续、用户验收。窗口关闭后，后台工作继续进行。
- 接入本机已有的 Agent：自动探测本机安装的 xiaok CLI、Codex、Kimi、ZCode，沿用它们自己的配置和登录。

---

## 安装

### 下载

1. 打开 [KTeam Releases](https://github.com/kaisersong/KTeam/releases/latest)，在 Assets 里下载 0.3.0 的 macOS arm64 `.dmg`。
2. 打开 dmg，把 `KTeam.app` 拖进「应用程序」。
3. 第一次打开时，macOS 会提示这是从互联网下载的应用，点「打开」即可。

只支持 Apple 芯片（M 系列）的 Mac，Intel Mac 暂不支持。0.3 没有正式的 Windows 版本，Windows 计划在 0.4 提供。

可选校验：把 Release 里的 `SHA256SUMS` 和安装包放在同一个文件夹，运行 `shasum -a 256 -c SHA256SUMS`。

### 从 0.2 升级

0.2 没有自动更新功能，请**手动下载安装一次 0.3**，覆盖原来的 KTeam。之后的版本会自动更新。

升级后，0.2 里和小K共用的服务数据不会带过来，按界面提示在设置里重新设置一次服务即可；需要原来在小K里配的模型，可以点「从小K导入」。

---

## 架构

| 部分 | 负责什么 |
|---|---|
| KTeam 桌面应用 | 界面、设置、工作队列、预算、执行绑定；数据存在 `~/.kteam/` |
| `runtime-core/` | KTeam 自己维护的 Agent 运行时，最初从 [xiaok-cli](https://github.com/kaisersong/xiaok-cli) `f8728a34` 一次性复制，之后不再同步，来源见 [NOTICE](NOTICE) |
| [KSwarm](https://github.com/kaisersong/kswarm) | Agent 和项目的唯一 owner |
| [intent-broker](https://github.com/kaisersong/intent-broker) | 房间、成员和群消息的唯一 owner，承载 AIMP 讨论生命周期 |

KSwarm 和 intent-broker 以固定版本内置在应用里，版本锁定在 [sources.lock.json](sources.lock.json)，不需要另外安装。界面进程只能使用白名单里的语义 IPC，读不到凭据，也不能调用任意文件、命令或网络请求。

## 构建和检查

需要 Node >= 22.22.0。把 `kswarm` 和 `intent-broker` 放在 KTeam 的同级目录下。

```sh
npm ci --ignore-scripts
npm run check
npm run pack:desktop
```

`pack:desktop` 打出的是本地 ad-hoc 签名的开发包；正式签名、公证和发布由 GitHub Actions 的发版流程完成。

## CLI

```sh
node dist/src/cli.js --help
node dist/src/cli.js doctor
node dist/src/cli.js bots
node dist/src/cli.js teams
```

不要把凭据写进命令参数或提交到 Git。

---

## 版本日志

### v0.3.0

- 与小K完全解耦：独立的数据目录、端口和凭据。
- 保留「从小K导入」，只在用户点击时只读一次。
- Mac 自动更新，只认 KTeam 自己的 Releases。
- 0.2 共享服务用户的一次性升级提示。
- macOS 包经过苹果签名和公证。

### v0.2.0

第一个正式版本（macOS arm64，ad-hoc 签名，未公证）。详见 [v0.2.0 Release](https://github.com/kaisersong/KTeam/releases/tag/v0.2.0)。

## 反馈

遇到问题请到 [Issues](https://github.com/kaisersong/KTeam/issues) 反馈，附上 macOS 版本和截图。

## 许可

[Apache-2.0](LICENSE)。第三方来源说明见 [NOTICE](NOTICE)。
