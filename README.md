<p align="center">
  <img src="desktop/assets/icon.svg" alt="KTeam" width="120" height="120" />
</p>

# KTeam

> Build your AI team and keep work moving. KTeam is a local multi-Bot collaboration desktop app: several AI members discuss, split up and deliver work in a group chat, while you make the calls and accept the results.

KTeam's collaboration is built on **AIMP (Agent Intent Messaging Protocol)**. This is KTeam's main technical difference from other multi-agent tools: chat text is not authorization, and a discussion reply is not proof that the work was done.

[English](README.md) | [简体中文](README.zh-CN.md)

**Current version: 0.10.3.** Get the installer from [GitHub Releases](https://github.com/kaisersong/KTeam/releases/latest). Available for macOS on Apple silicon (arm64) and Windows (x64). Mac and Windows installer builds support auto-update; the portable build updates manually. See [Version History](#version-history) for changes.

---

## Why AIMP

Most multi-agent tools treat collaboration as a chain of function calls or as free-form chat. The first is too rigid for people to follow; the second leaves it unclear whether anything said actually counts. AIMP takes a different approach:

- **IM conversations at the top.** Contacts, group chats, threads, @mentions, quoted replies and approval cards map directly onto the protocol's rooms, threads and event chain, so people and agents negotiate, delegate, deliver and accept work in the same conversation.
- **Human-readable first, structure added progressively.** With the structured parts removed, a person can still read what happened. Casual chat can be plain language; the riskier and less reversible an action, the more structure it requires.
- **State comes only from the structured event chain.** Collaboration state is derived from ordered, signed structured events. Natural-language text is evidence only and never takes protocol effect by itself.
- **Commitments are explicit, and humans have the final say.** Accepting, delivering and approving work need explicit events. Human messages outrank agents for priority, interruption and veto. Execution rights come only from capability tokens that can expire and be revoked.
- **No new transport.** AIMP is a collaboration layer that complements MCP (tools) and A2A (calls) and runs on existing messaging channels.

Current reference: **[AIMP Design Specification v3.2](spec/aimp/aimp-design-spec-v3.2.md)** (Chinese original). The retained [v3.1 English translation](spec/aimp/aimp-design-spec-v3.1.en.md), [v3.1 schemas](spec/aimp/aimp-v3.1-schemas.json) and [signature vectors](spec/aimp/aimp-v3.1-test-vectors.json) describe the previous version; they are not v3.2 handshake conformance evidence.

### What KTeam implements today

- The envelope wire version is `aimp: "1.0"`, unchanged in spec 3.2 ([`src/protocol/aimp.ts`](src/protocol/aimp.ts)).
- Passes the spec's official test vectors for all four signature domains: canonical bytes, hashes and Ed25519 signatures ([`tests/protocol.test.ts`](tests/protocol.test.ts); vector copy in [`tests/fixtures/aimp-v3.1-test-vectors.json`](tests/fixtures/aimp-v3.1-test-vectors.json)).
- The canonical JSON subset rejects duplicate keys, invalid Unicode, unsafe numbers and excessive nesting.
- The L0 preview never treats text such as "accept", "approve" or a tool call as authorization.
- The experimental discussion lifecycle in intent-broker is wired up.

**KTeam does not yet claim full AIMP v3.2 compliance or Core-L2 certification.** A production identity root, receipt activation and complete state transitions are still unavailable. This release adds scoped effect observation and verified host receipts for typed HTML and mail paths; these do not certify every tool or replace business acceptance. The verification script `verify_v31_vectors.py` mentioned in the spec is not shipped in this repository. The v3.2 specification is the reference for incremental implementation. Standard session negotiation, Templates and FastJoin are currently unavailable; existing local discussion remains experimental.

---

## What's in 0.10.3

- Little K sends actionable briefings in its private chat. Select recent Yunzhijia or Feishu direct chats separately from group sources.
- Meeting invitations show verified calendar conflicts and copyable reply suggestions. Desktop and paired phones share the same briefing and source coverage.
- Conversation errors distinguish a failed request from a disconnected computer and preserve unsent drafts.

## What's in 0.10.2

- In the assistant's Today view, record a follow-up or a commitment with a check time and a stopping condition. Due entries stay on your private workbench. Pause, reschedule, or close each one yourself.
- On the desktop and a paired phone, open a linked message only while its source can be rechecked. Source coverage and missed checkpoints are shown explicitly.

## What's in 0.10.1

- Pick a briefing schedule directly in Little K. Review the schedule and choose which sources it can read before applying it.
- See upcoming routines, follow-ups, and the next briefing at the top of desktop conversation details. Pause or resume routines from the list.
- Read compact reply quotes and open the original message. Follow active work, stage evidence, and message references from the conversation.

## What's in 0.10.0

- Set up and revise Little K's daily work in chat. Confirm the plan, choose briefing times, or run a one-time check.
- Open Today to see briefings, calendar conflicts, items that need attention, and what each connected source could read. Reply suggestions are editable drafts.
- A paired phone can manage the same plan and see the same Today view as the desktop.

## What's in 0.9.6

- Pause all work from the desktop. New work stays queued, and the pause survives a restart. Resuming keeps individual conversation pauses in place.
- Work history shows why a task stopped, its last recorded progress, and whether the stop was confirmed.
- Mobile approval decisions recheck the paired device's access before saving.

## What's in 0.9.5

- **Follow group work from the conversation.** The compact status opens the original request, the member's assignment and receipt, or the exact approval card.
- **See why an operation needs confirmation.** Approval cards identify the triggering command segment when available. Approval decisions and actual execution results have separate records.
- **Use the composer with a keyboard.** The member picker scrolls with selection in both themes, respects input method composition, and pastes copied directories as paths.
- **Read Git metadata through a scoped tool.** Bots can inspect refs, commit history, branches containing a commit, and fetch refspecs in an ordinary local repository under the current workspace.
- **Keep phone connections and approvals in sync.** Pairing checks the selected desktop identity, and the companion uses published connection routes and redacted approval data.

## What's in 0.9.4

- **Group work resumes after an interrupted review.** When the previous execution has stopped and member results are available, KTeam can retry coordinator review once and continue queued work after delivery.
- **Pending messages survive pause and resume.** Unstarted work keeps its place when only the pause state changes.
- **The @ member menu follows the current theme.** Names, borders, and selection highlights are readable in dark mode.

## What's in 0.9.3

- **Group work can recover from invalid plans.** A correction request gets the exact validation error. A second failure leaves a group status and a Continue action.
- **Directory grants cover routine queries.** Timed Git remote-ref queries reuse authorized directories. Inline awk filters no longer appear as directory targets.
- **Approval cards are easier to scan.** Key targets remain visible, command metadata expands on demand, and authorization management sits in the footer. Mixed inspection and deletion requests show an explicit rejection action.

## What's in 0.8.0

- **Independent group replies run concurrently.** Members can respond together; only explicit result dependencies serialize their replies. Private work stages and coordinator review remain separate from public discussion.
- **Actual request attempts are counted.** Verified transport witnesses distinguish SDK retries and auxiliary requests, retain durable quota reservations and avoid charging the same attempt twice. Adapter wiring does not certify every third-party SDK bridge.
- **Context survives compaction.** Hosted work can recover its frozen requirements and source material. A context checkpoint proves inclusion, not that a model understood or completed the request.
- **Verified HTML and mail outcomes.** HTML is validated in a private candidate before publication; mail uses stable intents and original approvals. Unknown outcomes are checked instead of blindly repeated, and structural validation does not mean business acceptance.
- **Reports open inside KTeam.** Receipt-backed HTML/Markdown links and file buttons remain available beyond the recent tool-output window. Opening checks the current conversation, host and file digest.
- **Evidence-based experience.** Reward Memory uses explicit human acceptance and verified delivery evidence, with expiry and revocation. It never grants tool permissions.

The reviewed [combined optimization roadmap](https://github.com/kaisersong/mydocs/blob/master/kteam/design/desktop/2026-11-16-grok-bot-combined-optimization-plan.md) also contains future work; this version's implemented features are listed above. Full Mac sleep/wake recovery and every third-party SDK bridge remain separately qualified.

## What's in 0.7.2

- **Voice input.** Microphone input with Doubao and Qwen ASR configuration, recording status and editable transcription.
- **Team participation and delivery.** Relevant members can reply publicly while work continues and acknowledge user validation feedback; private member stages return actual results for coordinator review. Add and remove group members from conversation details.
- **Continuous work.** New messages steer or queue existing work. Durable handoffs, approval recovery and deadline-based execution leases preserve progress across interruptions.
- **Reusable permissions.** Existing directory grants cover routine scripts, interpreter pipelines, Shell eval and remote commands; actual dangerous actions retain separate confirmation. Recent cancelled or expired approvals remain inspectable.
- **Conversation improvements.** Image previews, resolved receipt cleanup, automatic history paging and jump-to-latest navigation. Analysis cards are enabled by default; Yunzhijia rich-text preparation still requires approval before sending.
- **AIMP 3.2 reference.** Updated specification, schemas, templates and test vectors; the implementation remains an experimental subset, with standard negotiation, Templates and FastJoin explicitly unavailable.

## What's in 0.6

- **Electron 45 and Node 24.** Updated desktop runtime, including asynchronous file and image clipboard support.
- **Targeted group replies.** Type `@` to search and select a group member. Stable member identities travel with text and attachment messages, so the selected Agent responds even when display names overlap.
- **Clearer approvals.** Human-readable summaries, collapsed technical details and lightweight system notices. Terminal grants apply to the actual command directory and survive recovery; deletion, reset and outbound operations still require separate confirmation.
- **Reliable continuation.** Verified stale approval waits and interrupted scheduled work can continue without replaying completed or unknown operations.
- **Skills and local spaces.** Left-aligned `/` Skill choices in direct chats. The desktop composer lists `/space` to open a local pages workbench and `/space create <name>` to create a named draft.
- **Mail connections.** Gmail/Outlook OAuth joins QQ, 163 and generic IMAP/SMTP. OAuth requires your own client ID; credentials are encrypted and sending requires approval. Live provider account acceptance remains separate from the verified local callback and TLS flows.

## What's in 0.5

- **A ready-to-use xiaoK assistant.** Connecting or selecting a default model completes assistant setup automatically. Existing models no longer trigger another setup prompt. The assistant can prepare Bot and group creation proposals for your confirmation.
- **Daily work in the assistant chat.** Confirm the sources and briefing times in chat, then open Today from the assistant on desktop or a paired phone. You can adjust the plan in a later message or ask for one check.
- **Natural follow-up messages.** Send normally; the assistant decides how your message continues ongoing work. The composer no longer asks you to choose new work, append or queue. Approvals and unknown-result checks remain separate.
- **Files, images and Skills.** Select, drop or paste files and images. Use `/` to choose a Skill in a Bot direct chat; groups direct you to that chat. Successful file receipts survive interruptions, and the file shortcut appears only when a file was actually generated.
- **Durable work and permissions.** Questions and approvals can resume the original task after a host restart. Revocable directory grants cover ordinary file access; sensitive files still need separate confirmation. Review member Skills, memory and tool scopes.
- **Desktop collaboration.** Conversation previews, rename/delete/unread actions, reply and reaction shortcuts, avatar presets, scheduled work, work notifications, bounded history and verified original tool output.
- **Complete settings.** Manage models by provider, discover model IDs, import MCP configuration, enable tools and edit their descriptions, select voice profiles, and browse memory by member and conversation.
- **Connectors and computer access.** Bundled Yunzhijia CLI and enterprise CLI connections; Mac CUA driver installation and system permission shortcuts. Email supports IMAP/SMTP; Gmail/Outlook OAuth was added in 0.6.
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

Intel Macs are not supported yet. Existing Mac installations can update to the latest official release from KTeam's own update channel.

**Windows (x64)**

- **Installer (recommended):** download `KTeam-setup-0.10.3.exe` and run it. It supports auto-update.
- **Portable:** download `KTeam-portable-0.10.3.exe` and run it directly. It does not auto-update; download new versions from Releases.

The Windows builds are not code-signed yet. The first time you run one, Windows shows "Windows protected your PC"; click "More info", then "Run anyway".

Windows detects local Agents through native executable and npm shim paths. Use the connection test before linking an installed CLI; its supported protocol and login determine availability.

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

To switch a locally ad-hoc-signed Mac build to official releases, install the official DMG once, replacing the existing app. Squirrel cannot auto-update across that signature change. Keep the official app signature intact for subsequent automatic updates.

## CLI

```sh
node dist/src/cli.js --help
node dist/src/cli.js doctor
node dist/src/cli.js bots
node dist/src/cli.js teams
```

Never put credentials in command arguments or commit them to Git.

---

Official releases are published automatically by GitHub Actions after Mac and Windows builds, cross-platform checks and artifact verification pass. Failed builds remain drafts.

## Version History

### v0.9.9

- Fix a race that could leave a pending approval visible after pausing work.

### v0.9.8

- On macOS, grant a Codex CLI member write access to a parent directory and enable writes for an explicitly assigned group task. Ordinary messages keep read-only sessions.
- Record proactive reminder decisions and recheck whether the source is current before delivery.
- Use verified delivery references when resuming work to preserve completed results.
- Review specific versions of delivered files on desktop and deduplicate mobile inbox items.

### v0.9.7

The pause-all control is available in group details. Chats show a compact status while work is paused.

### v0.9.6

Adds a persistent pause for all work, task stop details, and a final access check for mobile approvals. See the [0.9.6 release notes](release-notes/0.9.6.md).

### v0.9.5

Adds scoped Git inspection, direct links to member work and approvals, a keyboard-friendly composer, and mobile pairing and approval recovery. See the [0.9.5 release notes](release-notes/0.9.5.md).

### v0.9.4

Fixes group review recovery, processing of messages queued during a pause, and dark-mode colors in the @ member menu. See the [0.9.4 release](https://github.com/kaisersong/KTeam/releases/tag/v0.9.4).

### v0.9.3

Group planning now preserves recovery after validation failures. Timed Git queries and inline awk filters retain the intended directory scope, and approval cards separate decisions from technical details. See the [0.9.3 release](https://github.com/kaisersong/KTeam/releases/tag/v0.9.3).

### v0.9.2

Copying a folder from Finder now inserts its directory path into the composer instead of uploading a broken attachment. File upload permissions still apply to regular files and images. Model failures appear directly in the conversation with the affected member, model, cause, and a shortcut to model settings, including failures before group replies are assigned. Read-only research ignores unused execution stages, and the latest tool-free followup planning format failure gets one bounded recovery attempt. Mentioned recipients stay scoped during recovery, invalid plans receive one guarded format correction, and research that exhausts observation steps can deliver a tool-free summary from preserved read receipts. Group waiting cards expose blocked members and pending confirmations. K3 keeps its selected model through durable tool approval and restart: restored work uses bounded public history and completed tool receipts, without persisting or replaying private reasoning. Each complete tool boundary derives a fresh public request view from the canonical session rather than nesting summaries. Already completed tools are not replayed; malformed provider control output is reported as a failure. Sequential group stages receive separate time windows plus coordinator review time. Member handoffs follow the original task deadline unless a shorter wait is explicitly requested; individual executions remain bounded to one hour instead of being stopped after thirty minutes. A compact status line at the top of the conversation shows collaboration progress; details, deadlines and pause controls expand on demand. New requests follow the current work instead of being trapped behind an obsolete queued followup. Release checks enforce the declared test-count floor, verify complete Windows shard coverage, and compare packaged source identity and dependency fingerprints. Build details remain available to copy in Settings, including for official releases. Directory approvals for group work appear in the originating group, including work delegated privately. The approval card defaults to granting the displayed directory scope to all current group Bots; you can uncheck it to grant only the requesting member. One-time approvals remain individual, new members do not inherit grants, and member tool restrictions still apply. GitHub CLI login-status and read-only API queries no longer require repeated confirmation, including quoted variables and pipelines.

See the [0.9.2 release](https://github.com/kaisersong/KTeam/releases/tag/v0.9.2).

### v0.9.0

Consolidates mobile pairing, persistent history, artifact navigation and connection recovery. Shared notes can cite selected messages and preserve creation provenance; approval cards explain confirmation reasons. Repeated file saves show the latest entry, and local artifacts survive hostname changes. Update checks retry transient connection failures without bypassing signature verification.

See the [0.9.0 release](https://github.com/kaisersong/KTeam/releases/tag/v0.9.0).

### v0.8.8

Includes the mobile preview: pair from the desktop sidebar using a timed QR code, desktop confirmation and device revocation. Android/iOS previews support encrypted conversations, attachments and approvals. Relay deployment, push notifications and full physical-device qualification remain incomplete; no app-store release is included.

Quoted group replies prioritize the addressed member. Source and GitHub fact checks use bounded read-only tools and require an actual read receipt before delivering a verified conclusion. Blocked work no longer reduces fresh research to tool-free chat, and public replies do not lock the whole room out of work.

Updates use a persistent bottom-left entry: click to download, then restart to install, without an update modal. Redirected `git ls-remote` queries reuse routine directory grants. See the [0.8.8 release](https://github.com/kaisersong/KTeam/releases/tag/v0.8.8).

Inherited Windows file scopes work across drives while file access set to none still denies every drive. Accepted notarization tickets use bounded download retries with validation preserved.

### v0.8.4

An ended approval wait no longer leaves a later independent request stuck as session busy. Recovery verifies the saved approval and exclusive storage lock, preserves the new request origin, and never replays cancelled tool actions. See the [0.8.4 release](https://github.com/kaisersong/KTeam/releases/tag/v0.8.4).

Windows directory grants now recognize `cd /d` and compound cmd queries, and normal directory activity no longer produces false configuration permission errors. Explicit routine directory grants also cover new report writes during recovery. Newly created team members automatically receive a private conversation with the user.

Git risk checks distinguish global options from subcommand arguments. Count queries such as `git grep -c` and routine fetch/query sequences reuse existing grants without being mistaken for configuration overrides.

### v0.8.1

Windows first-run recovery now checks process birth when a stale state-lock PID is reused. Explicit model imports allow inherited read-only access while rejecting foreign writes; startup waits for local services before showing model setup, and recovered service errors clear. Native update validation failures show an actionable download path. See the [0.8.1 release](https://github.com/kaisersong/KTeam/releases/tag/v0.8.1).

### v0.8.0

Concurrent independent group replies, durable physical-request accounting, frozen-context recovery, verified HTML/mail outcomes, persistent report links and evidence-based experience. See the [0.8.0 release](https://github.com/kaisersong/KTeam/releases/tag/v0.8.0).

### v0.7.2

Voice input, public group participation with private execution stages, continuous work and reusable permissions, image previews, conversation paging, default analysis cards and approval history. See the [0.7.2 release](https://github.com/kaisersong/KTeam/releases/tag/v0.7.2).

### v0.6.0

Electron 45.3.2 / Node 24.22.2, identity-based group mentions, lightweight approval notices, readable approval cards, effective-directory terminal grants, scheduled-work recovery, local `/space` pages and mail OAuth. See the [0.6.0 release](https://github.com/kaisersong/KTeam/releases/tag/v0.6.0).

### v0.5.0

Automatic assistant setup and message handling, file/image input, direct-chat Skills, durable approvals, directory permissions, enterprise connectors, A2UI compatibility and Windows host hardening. Email uses IMAP/SMTP; OAuth was added in 0.6.

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
