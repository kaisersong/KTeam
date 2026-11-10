<p align="center">
  <img src="desktop/assets/icon.svg" alt="KTeam" width="120" height="120" />
</p>

# KTeam

> Build your AI team and keep work moving. KTeam is a local multi-Bot collaboration desktop app: several AI members discuss, split up and deliver work in a group chat, while you make the calls and accept the results.

KTeam's collaboration is built on **AIMP (Agent Intent Messaging Protocol)**. This is KTeam's main technical difference from other multi-agent tools: chat text is not authorization, and a discussion reply is not proof that the work was done.

[English](README.md) | [简体中文](README.zh-CN.md)

**Current version: 0.3.0.** Get the installer from [GitHub Releases](https://github.com/kaisersong/KTeam/releases/latest). 0.3 is the first build signed and notarized by Apple. It supports macOS on Apple silicon (arm64) only and includes auto-update. See [Version History](#version-history) for changes.

---

## Why AIMP

Most multi-agent tools treat collaboration as a chain of function calls or as free-form chat. The first is too rigid for people to follow; the second leaves it unclear whether anything said actually counts. AIMP takes a different approach:

- **IM conversations at the top.** Contacts, group chats, threads, @mentions, quoted replies and approval cards map directly onto the protocol's rooms, threads and event chain, so people and agents negotiate, delegate, deliver and accept work in the same conversation.
- **Human-readable first, structure added progressively.** With the structured parts removed, a person can still read what happened. Casual chat can be plain language; the riskier and less reversible an action, the more structure it requires.
- **State comes only from the structured event chain.** Collaboration state is derived from ordered, signed structured events. Natural-language text is evidence only and never takes protocol effect by itself.
- **Commitments are explicit, and humans have the final say.** Accepting, delivering and approving work need explicit events. Human messages outrank agents for priority, interruption and veto. Execution rights come only from capability tokens that can expire and be revoked.
- **No new transport.** AIMP is a collaboration layer that complements MCP (tools) and A2A (calls) and runs on existing messaging channels.

Full specification: **[AIMP Design Specification v3.1](spec/aimp/aimp-design-spec-v3.1.md)** (Chinese), with its [JSON Schemas](spec/aimp/aimp-v3.1-schemas.json) and [signature test vectors](spec/aimp/aimp-v3.1-test-vectors.json).

### What KTeam implements today

- The envelope wire version is `aimp: "1.0"`, corresponding to spec 3.1 ([`src/protocol/aimp.ts`](src/protocol/aimp.ts)).
- Passes the spec's official test vectors for all four signature domains: canonical bytes, hashes and Ed25519 signatures ([`tests/protocol.test.ts`](tests/protocol.test.ts); vector copy in [`tests/fixtures/aimp-v3.1-test-vectors.json`](tests/fixtures/aimp-v3.1-test-vectors.json)).
- The canonical JSON subset rejects duplicate keys, invalid Unicode, unsafe numbers and excessive nesting.
- The L0 preview never treats text such as "accept", "approve" or a tool call as authorization.
- The experimental discussion lifecycle in intent-broker is wired up.

**KTeam does not yet claim full AIMP v3.1 compliance or Core-L2 certification.** A production identity root, receipt activation, complete state transitions and side-effect registration are still to be done. The verification script `verify_v31_vectors.py` mentioned in the spec is not shipped in this repository. 0.4 will check the implementation against the v3.1 spec item by item.

---

## What's in 0.3

- **Fully decoupled from xiaoK.** KTeam has its own app name, bundle ID (`com.kteam.desktop`) and data directory `~/.kteam/`. Its built-in services use ports assigned by the system and recorded in `~/.kteam/service-endpoints.json`, so they never clash with xiaoK. Credentials are stored by default in KTeam's own private file; if you switch to the Mac keychain, KTeam uses only its own entries. Startup and background work never read any xiaoK file.
- **Import models from xiaoK.** If you already set up models in xiaoK, click "从小K导入" (Import from xiaoK) in model settings. Only when you click it does KTeam read xiaoK's config and keychain, once, and copy them into KTeam's own credentials; it never writes to xiaoK. macOS asks for permission the first time xiaoK's keychain is read. If you choose "Deny", the import stops and tells you to enter the key manually or try again; it doesn't prompt repeatedly or leave a half-finished import.
- **Mac auto-update.** Updates come only from [KTeam's GitHub Releases](https://github.com/kaisersong/KTeam/releases) (official releases only, no pre-releases, no downgrades). They download in the background, and KTeam asks whether to restart when ready; choose "Later" to install on next quit. You can also check manually from KTeam ▸ 检查更新… (Check for Updates).
- **0.2 upgrade notice.** Service data that 0.2 shared with xiaoK is not carried over to 0.3. If KTeam finds that old setting, it shows a one-time notice at the top with a "去设置" (Go to Settings) button; once closed, it doesn't come back.
- **Signed and notarized.** The 0.3 macOS build is signed and notarized by Apple.

## Features

- Create long-lived Bot members by name, each with its own role, initiative and model.
- Start group chats where several members discuss; KTeam picks the members relevant to the topic (or none), and the agreed points are kept in shared notes.
- One-to-one chats with a member, team proposal cards, pause / resume and user acceptance. Background work continues after the window is closed.
- Connect agents already on your Mac: KTeam detects installed xiaok CLI, Codex, Kimi and ZCode and uses their own config and sign-in.

---

## Install

### Download

1. Open [KTeam Releases](https://github.com/kaisersong/KTeam/releases/latest) and download the 0.3.0 macOS arm64 `.dmg` from Assets.
2. Open the dmg and drag `KTeam.app` into Applications.
3. The first time you open it, macOS says it was downloaded from the internet; click "Open".

Only Apple silicon (M-series) Macs are supported; Intel Macs are not supported yet. There is no official Windows build in 0.3; Windows is planned for 0.4.

Optional check: put the release's `SHA256SUMS` in the same folder as the installer and run `shasum -a 256 -c SHA256SUMS`.

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

### v0.3.0

- Fully decoupled from xiaoK: separate data directory, ports and credentials.
- "Import from xiaoK" kept, reading once and only when the user clicks.
- Mac auto-update from KTeam's own Releases only.
- One-time upgrade notice for 0.2 users of the shared service.
- macOS build signed and notarized by Apple.

### v0.2.0

First official release (macOS arm64, ad-hoc signed, not notarized). See the [v0.2.0 release](https://github.com/kaisersong/KTeam/releases/tag/v0.2.0).

## Feedback

Report problems in [Issues](https://github.com/kaisersong/KTeam/issues) with your macOS version and screenshots.

## License

[Apache-2.0](LICENSE). Third-party sources are listed in [NOTICE](NOTICE).
