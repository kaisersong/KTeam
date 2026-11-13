<p align="center">
  <img src="desktop/assets/icon.svg" alt="KTeam" width="120" height="120" />
</p>

# KTeam

> Build your AI team and keep work moving. KTeam is a local multi-Bot collaboration desktop app: several AI members discuss, split up and deliver work in a group chat, while you make the calls and accept the results.

KTeam's collaboration is built on **AIMP (Agent Intent Messaging Protocol)**. This is KTeam's main technical difference from other multi-agent tools: chat text is not authorization, and a discussion reply is not proof that the work was done.

[English](README.md) | [简体中文](README.zh-CN.md)

**Current version: 0.5.0.** Get the installer from [GitHub Releases](https://github.com/kaisersong/KTeam/releases/latest). 0.4 adds Windows (x64) alongside macOS on Apple silicon (arm64), with auto-update on both. See [Version History](#version-history) for changes.

---

## Why AIMP

Most multi-agent tools treat collaboration as a chain of function calls or as free-form chat. The first is too rigid for people to follow; the second leaves it unclear whether anything said actually counts. AIMP takes a different approach:

- **IM conversations at the top.** Contacts, group chats, threads, @mentions, quoted replies and approval cards map directly onto the protocol's rooms, threads and event chain, so people and agents negotiate, delegate, deliver and accept work in the same conversation.
- **Human-readable first, structure added progressively.** With the structured parts removed, a person can still read what happened. Casual chat can be plain language; the riskier and less reversible an action, the more structure it requires.
- **State comes only from the structured event chain.** Collaboration state is derived from ordered, signed structured events. Natural-language text is evidence only and never takes protocol effect by itself.
- **Commitments are explicit, and humans have the final say.** Accepting, delivering and approving work need explicit events. Human messages outrank agents for priority, interruption and veto. Execution rights come only from capability tokens that can expire and be revoked.
- **No new transport.** AIMP is a collaboration layer that complements MCP (tools) and A2A (calls) and runs on existing messaging channels.

Full specification: **[AIMP Design Specification v3.1](spec/aimp/aimp-design-spec-v3.1.en.md)** (English translation; the [Chinese original](spec/aimp/aimp-design-spec-v3.1.md) is authoritative), with its [JSON Schemas](spec/aimp/aimp-v3.1-schemas.json) and [signature test vectors](spec/aimp/aimp-v3.1-test-vectors.json).

### What KTeam implements today

- The envelope wire version is `aimp: "1.0"`, corresponding to spec 3.1 ([`src/protocol/aimp.ts`](src/protocol/aimp.ts)).
- Passes the spec's official test vectors for all four signature domains: canonical bytes, hashes and Ed25519 signatures ([`tests/protocol.test.ts`](tests/protocol.test.ts); vector copy in [`tests/fixtures/aimp-v3.1-test-vectors.json`](tests/fixtures/aimp-v3.1-test-vectors.json)).
- The canonical JSON subset rejects duplicate keys, invalid Unicode, unsafe numbers and excessive nesting.
- The L0 preview never treats text such as "accept", "approve" or a tool call as authorization.
- The experimental discussion lifecycle in intent-broker is wired up.

**KTeam does not yet claim full AIMP v3.1 compliance or Core-L2 certification.** A production identity root, receipt activation, complete state transitions and side-effect registration are still to be done. The verification script `verify_v31_vectors.py` mentioned in the spec is not shipped in this repository. The v3.1 specification remains the reference for incremental implementation.

---

## What's in 0.5

- **A ready-to-use xiaoK assistant.** Connecting or selecting a default model completes assistant setup automatically. Existing models no longer trigger another setup prompt. The assistant can prepare Bot and group creation proposals for your confirmation.
- **Natural follow-up messages.** Send normally; the assistant decides how your message continues ongoing work. The composer no longer asks you to choose new work, append or queue. Approvals and unknown-result checks remain separate.
- **Files, images and Skills.** Select, drop or paste files and images. Use `/` to choose a Skill in a Bot direct chat; groups direct you to that chat. Successful file receipts survive interruptions, and the file shortcut appears only when a file was actually generated.
- **Durable work and permissions.** Questions and approvals can resume the original task after a host restart. Revocable directory grants cover ordinary file access; sensitive files still need separate confirmation. Review member Skills, memory and tool scopes.
- **Desktop collaboration.** Conversation previews, rename/delete/unread actions, reply and reaction shortcuts, avatar presets, scheduled work, work notifications, bounded history and verified original tool output.
- **Connectors and computer access.** Bundled Yunzhijia CLI and enterprise CLI connections; Mac CUA driver installation and system permission shortcuts. Email supports IMAP/SMTP; Gmail/Outlook OAuth is deferred to 0.5.1.
- **A2UI and Windows.** A2UI accepts `"1.0"` and numeric `1`, with working surface deletion. Windows private hosts, native helpers and local Agent detection are included in builds. Windows installers remain unsigned.

## What's in 0.4

- **Windows (x64).** An installer (`KTeam-setup-0.4.0.exe`) and a portable build (`KTeam-portable-0.4.0.exe`). Process management and credential storage (Windows Credential Manager) work on Windows.
- **Auto-update on Windows.** The installer build updates the same way as the Mac build: official releases only, and an update whose package fails verification is rejected. The portable build does not auto-update; "检查更新" (Check for Updates) points you to Releases instead.
- **Check for updates in Settings.** Settings ▸ 数据与关于 (Data & About) shows the current version and lets you check manually.
- **Clean exit on Windows.** Closing the window fully exits KTeam with nothing left running in the background.

## What's in 0.3

- **Fully decoupled from xiaoK.** KTeam has its own app name, bundle ID (`com.kteam.desktop`) and data directory `~/.kteam/`. Its built-in services use ports assigned by the system and recorded in `~/.kteam/service-endpoints.json`, so they never clash with xiaoK. Credentials are stored by default in KTeam's own private file; if you switch to the Mac keychain, KTeam uses only its own entries. Startup and background work never read any xiaoK file.
- **Import models from xiaoK.** If you already set up models in xiaoK, click "从小K导入" (Import from xiaoK) in model settings. Only when you click it does KTeam read xiaoK's config and keychain, once, and copy them into KTeam's own credentials; it never writes to xiaoK. macOS asks for permission the first time xiaoK's keychain is read. If you choose "Deny", the import stops and tells you to enter the key manually or try again; it doesn't prompt repeatedly or leave a half-finished import.
- **Mac auto-update.** Updates come only from [KTeam's GitHub Releases](https://github.com/kaisersong/KTeam/releases) (official releases only, no pre-releases, no downgrades). They download in the background, and KTeam asks whether to restart when ready; choose "Later" to install on next quit. You can also check manually from KTeam ▸ 检查更新… (Check for Updates).
- **0.2 upgrade notice.** Service data that 0.2 shared with xiaoK is not carried over to 0.3. If KTeam finds that old setting, it shows a one-time notice at the top with a "去设置" (Go to Settings) button; once closed, it doesn't come back.
- **Signed and notarized.** The 0.3 macOS build is signed and notarized by Apple.

## Features

- Create long-lived Bot members by name, each with its own role, initiative and model.
- Start group chats where several members discuss; KTeam picks the members relevant to the topic (or none), and the agreed points are kept in shared notes.
- One-to-one chats with a member, team proposal cards, pause / resume and user acceptance. On macOS, background work continues after the window is closed; on Windows, closing the window exits KTeam.
- Connect agents already on your Mac: KTeam detects installed xiaok CLI, Codex, Kimi and ZCode and uses their own config and sign-in.

---

## Install

### Download

Open [KTeam Releases](https://github.com/kaisersong/KTeam/releases/latest) and download the file for your system from Assets.

**macOS (Apple silicon)**

1. Download the macOS arm64 `.dmg`.
2. Open the dmg and drag `KTeam.app` into Applications.
3. The first time you open it, macOS says it was downloaded from the internet; click "Open".

Intel Macs are not supported yet. If you already have 0.3.x, KTeam updates to 0.4 automatically.

**Windows (x64)**

- **Installer (recommended):** download `KTeam-setup-0.5.0.exe` and run it. It supports auto-update.
- **Portable:** download `KTeam-portable-0.5.0.exe` and run it directly. It does not auto-update; download new versions from Releases.

The Windows builds are not code-signed yet. The first time you run one, Windows shows "Windows protected your PC"; click "More info", then "Run anyway". Signing will come in a later 0.4.x release.

Known limitation on Windows: local agents such as Codex can't yet be linked as collaborators (they are still detected). This is planned for 0.5.

Optional check: put the release's `SHA256SUMS` in the same folder as the installer and run `shasum -a 256 -c SHA256SUMS`. On Windows, run `Get-FileHash <file> -Algorithm SHA256` in PowerShell and compare the value with `SHA256SUMS`.

### Upgrading from 0.2

0.2 has no auto-update, so **download and install 0.3 manually once**, replacing your existing KTeam. Later versions update automatically.

After upgrading, service data that 0.2 shared with xiaoK is not carried over; follow the notice to set up the service again in Settings. To bring over models you configured in xiaoK, click "从小K导入".

---

## Architecture

| Part | Responsibility |
|---|---|
| KTeam desktop app | UI, settings, work queue, budgets, execution bindings; data lives in `~/.kteam/` |
| `runtime-core/` | KTeam's own agent runtime, a one-time copy of [xiaok-cli](https://github.com/kaisersong/xiaok-cli) `f8728a34`, no longer synced; see [NOTICE](NOTICE) |
| [KSwarm](https://github.com/kaisersong/kswarm) | Sole owner of agents and projects |
| [intent-broker](https://github.com/kaisersong/intent-broker) | Sole owner of rooms, members and group messages; carries the AIMP discussion lifecycle |

KSwarm and intent-broker ship inside the app at fixed versions pinned in [sources.lock.json](sources.lock.json); you don't install them separately. The UI process can only use allow-listed semantic IPC; it cannot read credentials or call arbitrary files, commands or network requests.

## Build and Check

Requires Node >= 22.22.0. Place `kswarm` and `intent-broker` next to the KTeam checkout.

```sh
npm ci --ignore-scripts
npm run check
npm run pack:desktop
```

`pack:desktop` produces a locally ad-hoc-signed development build. Official signing, notarization and publishing are done by the GitHub Actions release workflow.

## CLI

```sh
node dist/src/cli.js --help
node dist/src/cli.js doctor
node dist/src/cli.js bots
node dist/src/cli.js teams
```

Never put credentials in command arguments or commit them to Git.

---

## Version History

### v0.5.0

Automatic assistant setup and message handling, file/image input, direct-chat Skills, durable approvals, directory permissions, enterprise connectors, A2UI compatibility and Windows host hardening. Email uses IMAP/SMTP; OAuth is deferred to 0.5.1.

### v0.4.0

- Windows x64 support: installer and portable builds (not code-signed yet).
- Auto-update on Windows (installer build only).
- Current version and "检查更新" (Check for Updates) in Settings.
- Closing the window on Windows fully exits KTeam.
- Spacing tweaks for dropdowns, inputs and buttons across desktop flows.

### v0.3.1

See the [v0.3.1 release](https://github.com/kaisersong/KTeam/releases/tag/v0.3.1).

### v0.3.0

- Fully decoupled from xiaoK: separate data directory, ports and credentials.
- "Import from xiaoK" kept, reading once and only when the user clicks.
- Mac auto-update from KTeam's own Releases only.
- One-time upgrade notice for 0.2 users of the shared service.
- macOS build signed and notarized by Apple.

### v0.2.0

First official release (macOS arm64, ad-hoc signed, not notarized). See the [v0.2.0 release](https://github.com/kaisersong/KTeam/releases/tag/v0.2.0).

## Feedback

Report problems in [Issues](https://github.com/kaisersong/KTeam/issues) with your OS version (macOS or Windows) and screenshots.

## License

[Apache-2.0](LICENSE). Third-party sources are listed in [NOTICE](NOTICE).
