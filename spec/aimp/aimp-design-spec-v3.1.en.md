# AIMP Protocol Design Specification v3.1

> This is an English translation of the [Chinese original](aimp-design-spec-v3.1.md). If the two differ, the Chinese version is authoritative. Field names, identifiers and the test vectors are unchanged; natural-language example values inside sample messages are translated.

**AIMP — Agent Intent Messaging Protocol**

AIMP is a collaboration communication protocol for the Agent era: it uses the conversational model of instant messaging (IM) as its top-level structure and embeds a progressively structured intent kernel within message envelopes, enabling humans and Agents, as well as Agents and Agents, to negotiate, delegate, deliver, and accept deliverables in the same conversational space. AIMP defines the collaboration layer **within a trust domain**; trust domains are connected through opaque gateways.

> Version note: v3.1 builds on v3 and incorporates decisions D01–D39 and the final confirmations from the adversarial reviews conducted by codex, xiaok, and kiro on 2026-11-07. The original draft and review history are retained; v3 is not overwritten. See Appendix D for document revision notes and Appendix B for test vectors with real signatures.
>
> Normative terminology: **MUST / MUST NOT** indicate conformance requirements; **SHOULD** indicates a strong recommendation, and deviations MUST be declared; **MAY** indicates an option. Profile restrictions take precedence over event registration status: registration does not authorize execution across profiles. This document remains a design specification; the accompanying signature vectors do not constitute a complete implementation or comprehensive conformance certification.

---

## 1. Positioning and Scope

### 1.1 Positioning

- AIMP is a **collaboration profile** built on existing messaging transports (Matrix, XMPP, proprietary IM systems, etc.): it does not invent a new transport layer; it specifies identity, envelopes, speech acts, commitment state machines, and the security model.
- AIMP supports multiparty collaboration **within a trust domain**: the same organization, product, or billing entity, or a group of participants that have established trust through a handshake. Processes within the domain are visible by default, but visibility is tiered (for restrictions such as private-chat negotiation, historical access, and classification-based redaction, see §13.5 and §14.4); indiscriminate full transparency is not guaranteed.
- **Cross-trust-domain** collaboration does not use transparent sessions: domain boundary gateways connect domains in opaque mode (see §16), exchanging only load-bearing messages and structured payloads; processes within a domain remain within that domain.

### 1.2 Division of Responsibilities with Existing Protocols

| Protocol | Layer | Relationship to AIMP |
|---|---|---|
| MCP | Tool layer | Unchanged: manages connections between an individual Agent and tools/data; the tool side / MCP gateway MUST validate capability tokens (§14.1) |
| A2A | Invocation layer | Within a domain: serves as one type of invocation handle within an AIMP commitment; across domains: serves as an integration mechanism for boundary gateways. **The sole source of truth for commitment state is the AIMP event chain**; A2A Task state is written back through the adaptation contract (§17.6) and does not constitute a second state machine |
| ANP / AGNTCY | Identity and discovery | Their decentralized identity approaches may serve as long-term options for cross-domain identity; identity within a domain uses the simplified scheme in §5 |
| FIPA ACL | Historical reference | AIMP reuses its speech act type system while discarding its formal ontology and mental-state semantics (see §3.3) |
| Matrix / XMPP | Transport layer | Preferred underlying transports: rooms, federation, and event models correspond directly to AIMP's concepts of rooms, threads, and event chains |
| IM platform Bot APIs | Access layer | Serve only as human entry points and notification channels (see the ingress bridges in §17.2 and §17.5), not as the primary channel for inter-Agent collaboration |

### 1.3 Non-Goals

- Define new transport protocols, codecs, or network topologies.
- Provide cross-domain arbitration: cross-domain disputes are handled through contractual and legal channels; the protocol guarantees only the integrity and verifiability of evidence (signature chains, metering receipts, state chains, and gateway evidence packages).
- Prescribe Agent internals (models, memory, tools); only their observable behavior in sessions is specified.

---

## 2. Design Principles

1. **Human readability first**: After all structured blocks are removed from any message, a human reader SHOULD be able to fully understand what happened from the body text. Auditing, observation, and retrospectives all depend on this principle.
2. **Progressive structure**: The degree of structure is tied to risk, monetary value, and irreversibility; no uniform, rigid schema is imposed. Casual conversation can consist solely of natural language; payments MUST include a complete contract block.
3. **The structured event chain is the state**: Collaboration state is derived deterministically solely from sequenced structured events; natural-language body text and attachments never participate in state folding and serve only as evidence. Summaries MAY serve as caches, but MUST specify their coverage range and hash; in the event of a conflict, the event chain is authoritative.
4. **Commitments MUST be explicit**: Casual conversation is nonbinding; once a commitment is entered into (accepting an order, quoting a price, delivering, or paying), an explicit registry event (§8.2) MUST serve as its record.
5. **Human sovereignty**: Messages from human participants take precedence over those from Agents in priority, interruption rights, and veto rights; approval is a protocol message, not a UI feature of a particular product. The path by which human speech acquires protocol effect is governed by §13.7.
6. **Least privilege by default**: Execution permissions come solely from capability tokens (which can expire, be revoked, and be attenuated), and are granted for conversations and tasks, not to "this Agent" as a whole.
7. **Transport independence**: The envelope and state machine are defined independently of the transport layer and can operate over any channel that provides rooms, threads, and reliable delivery.
8. **Permissive reception, strict effect**: Accept any message permissively (it can be received and understood), but grant protocol effect strictly (if the conditions are insufficient, no effect is granted). Messages that do not meet the conditions for effect are "accepted but have no effect" and receive a receipt, rather than triggering an error; **hard failures that reject reception are limited to the exhaustive list in §15.1**. Rigidity applies only at the commitment layer.
9. **Attention is a scarce resource**: Human attention is managed through budgets (§13.6). Any mechanism that introduces an additional point requiring human action MUST document mitigation measures (consolidation, batching, standing authorization, spot checks) in its subsection and MUST be included in reporting of per-task human-action metrics (§13.6); **mitigation MUST NOT be achieved by lowering approval requirements**.

---

## 3. Why IM Is the Top-Level Model

### 3.1 Isomorphism of Primitives

| IM Primitive | Role in AIMP |
|---|---|
| Contacts / Address Book | Persistent Agent relationships and discovery (distinct from one-time service discovery; see §5.3 for coordination between discovery paths and enumeration prevention) |
| Presence | Availability, load, and task acceptance status (see §6 for extension definitions) |
| Direct Chat | Point-to-point channels for human↔Agent and Agent↔Agent communication (including private negotiation; see §13.5) |
| Group Chat / Room | A multiparty collaboration space with built-in social mechanisms for speaking, observing, and making final decisions |
| Thread | The presentation boundary for task context and audit trails; the unit of commitment truth is task_ref (§10.2) |
| @Mention | Explicit addressing and assignment of responsibility; strictly distinct from "delivery to" |
| Quoted Reply | Message causality chains; results can be traced back to the originating request |
| Emoji Reaction | Zero-cost acknowledgment without invoking full reasoning; MUST NOT carry safety-critical decisions. Emoji reactions do not enter the AIMP envelope layer: they are carried by native transport-layer reactions, generate no AIMP messages, consume no sequence numbers, and do not enter the state chain. Any acknowledgment requiring protocol effect MUST use an explicit message instead |
| File / Image Attachment | Deliverables and evidence (elevated to versioned Artifacts; see §7) |
| Draft / Approval Card | Human-in-the-loop veto and authorization points (see §13 for protocol formalization) |

These primitives are designed for "multiple parties collaborating over time with incomplete intent," which is the actual form of collaboration; protocols in the RPC family are designed for "a one-time invocation between two parties with complete parameters," which is only a single moment in collaboration. AIMP therefore places conversations at the top level, with invocations as one type of message within them.

### 3.2 Late Binding Enabled by Semantic Understanding

- **Late binding**: Messages can arrive before their structure is supplied—intent is first expressed in natural language, and the executing party asks follow-up questions or structures it independently when needed.
- **Fault tolerance**: When fields are missing or wording is ambiguous, the other party seeks clarification instead of exiting with an error; the failure mode shifts from "throw an exception" to "ask a question."
- **Low-cost evolution**: New collaboration patterns are first validated at the natural-language layer, then formalized as structured types once they become frequent and stable, without requiring both parties to upgrade their schemas simultaneously.

Late binding applies only to **understanding**, not to **effect**: inferred structure never produces protocol effect (§8.2).

### 3.3 Design Choices Relative to FIPA ACL

FIPA ACL failed for four reasons: closed ontologies required prior alignment, every message required classification, semantics were defined in terms of unverifiable beliefs/intentions, and there was no natural-language fallback. AIMP takes the opposite approach on each point:

- Semantics are defined by **observable effects** and strictly limited to machine-decidable predicates and state transitions (see §8.3);
- Speech acts are soft annotations: when undeclared, they MAY be inferred for display and prompting; classification failure does not constitute communication failure;
- The natural-language body always serves as the fallback channel;
- Rigidity is retained only for events listed in the authoritative event registry (see §8.2).

---

## 4. Architecture Overview

```
┌──────────────────────────────────────────────────────┐
│ Session Layer (AIMP)  Identity · Rooms · Threads · Message Streams · Human Presence │
├──────────────────────────────────────────────────────┤
│ Commitment Layer (AIMP)  Proposal → Acceptance → Execution → Verification → Settlement │
├──────────────────────────────────────────────────────┤
│ Invocation Layer (A2A)   Delegation and Lifecycle of Well-Defined Tasks │
├──────────────────────────────────────────────────────┤
│ Tool Layer (MCP)   Individual Agent Connections to Tools and Data │
└──────────────────────────────────────────────────────┘
   Cross-cutting: Identity and Keys · Capability Tokens · Metering and Quota Ledger · Reputation · Anti-spam · Audit Chain
   Domain Boundary: Opaque Gateway (§16)—processes remain within the domain; only load-bearing messages cross
```

Core concepts:

- **Trust Domain**: A set of participants sharing the same identity root, audit framework, and accountable entity. All Agents belonging to a user/team/organization typically constitute a single domain.
- **Room**: The boundary for membership and permissions. **Thread**: The boundary for member visibility and presentation.
- **Commitment Instance (task_ref)**: The sole unit of truth for commitment state; one task_ref carries one commitment state chain (§10.2). Subtasks may be placed in child threads (recommended) or in the same thread.
- **Sequencer**: The unique ordering and commit point for each thread; seq, term, prev_hash, fencing, and checkpoints are all scoped to the thread. A task_ref is permanently bound to the authoritative thread containing its creation event (§10.2), and its state is derived from the subsequence of events in that thread.
- **Session Profile**: Session-level parameters locked during the handshake and modifiable through versioned changes (§5.5).

---

## 5. Identity, Contact Cards, and Reputation

### 5.1 Addressing and Identity Roots

- Unified participant addressing: `human://<domain>/<name>`, `agent://<domain>/<name>`.
- Identity roots within a domain use a simplified scheme: domain name + WebPKI + `/.well-known/` bindings for endpoints and public keys. Cross-domain identity mechanisms (DIDs, etc.) are future options outside the core specification.
- Every Agent MUST declare an owner (`owner`): the human or organization on whose behalf it acts. An Agent without an owner MUST NOT send L2+ messages.
- Each principal has a unique **principal anchor** (`principal_anchor`): reputation, exposure, quotas, and allowlists/blocklists all use the principal anchor as their attribution key, rather than an instance, alias, or pseudonym (§14.4).
- **Two independent dimensions that MUST NOT be conflated**: a message's structural level (L0–L3, see §9) describes the degree of structure in an individual message; a principal's speaking capability describes the highest level that principal is permitted to use in a conversation, as determined by the handshake state and session contract (see §5.5). Throughout this specification, "treat as L0" means **process an individual message with L0 effect only**, rather than downgrade the principal.

### 5.2 Keys, Rotation, Revocation, and Ownership Transfer

- Session keys are issued by the principal and bind the principal anchor, Agent, permissions, and validity period; the Bot does not hold the principal's long-term keys. Key hierarchy, rotation, revocation, and recovery records are entered into the identity control log and referenced by affected task threads.
- **Rotation** does not extend a message's exp or an authorization period. Old public keys and evidence of their validity at the relevant time are retained until the audit retention period in §5.5 expires; newly issued messages use the new key. In-flight messages signed before rotation MAY be submitted within both their own exp and the rotation grace period; the default grace period is `max(2 × contractual maximum message validity period, 15 minutes)`. Suspected compromise triggers immediate revocation without a rotation grace period.
- **Revocation** takes effect immediately at the identity authority's effective revocation record, and actions not yet initiated stop; deployments using caches MUST declare the maximum revocation propagation delay and MUST NOT claim zero-delay blocking at the execution side. This declaration does not relax the fail-closed requirement in §14.1. Revocation and consumption of an execution permit MUST be arbitrated within the same authorization order; a consumed permit is treated as "initiated, pending reconciliation" and does not establish that the external call has physically succeeded.
- Affected threads submit `sys.revoked`, referencing authoritative proof of revocation: active states enter blocked, preserving previous_state and the blocking reason; performance-concluded states and terminal states do not transition, and the relevant execution eligibility is revoked and frozen under §10.1. Existing side effects continue to be reconciled; a revoked executor is not required to regain execution eligibility to report historical results.
- Old-key events newly submitted after revocation are invalid and do not take effect retroactively based on the sender's self-reported time; historically valid submissions continue to be verified against the evidence applicable at that time. Revocation and recovery credentials are issued by different roles recognized by the existing identity root and are each recorded in the chain; recovery requires a new key under the same principal anchor and a newly granted epoch.
- **Ownership transfer** first establishes a candidate: an assumption declaration from the new owner, a transfer credential from the original owner or an authorized governance root, and a binding to the new owner's unique principal anchor. After verifying all three components, the identity authority records the complete set together with `owner.changed` in the same commit; its sequence number is the sole point at which the transfer takes effect. Partial recording in the chain does not change the owner; an expired candidate is aborted.
  - When the transfer takes effect, the Agent's old session keys and old epoch are revoked; the invalidation scope is generally limited to relevant references for that Agent. If the transfer is initiated by a governance root or accompanies a governance takeover or suspected compromise, whether other references of the old principal are also invalidated is assessed independently under the existing revocation rules; collateral revocation requires separate authorization, evidence, and records. A transfer does not automatically invalidate the entire principal.
  - For reconciliation, settlement of obligations, and objections concerning existing tasks, the original principal MUST hold a restricted closeout credential recognized by an authorized governance root/contract controller and recorded in the chain: it binds the holder's public key, old principal anchor, task set, closeout-only actions, validity period, and revocation identifier. Its scope and duration are bounded by the effective owner.changed record, and reissuance MUST NOT exceed that record's bounds. The identity key verifies only the holder's signature and does not authorize a new execution identity. Before closeout, verify issuance authority, proof of possession, task/action matching, validity period, and revocation/governance status satisfying freshness requirements; fail closed if any element is missing. A governance transfer or suspected compromise requires an independent assessment of collateral effects; this cannot be skipped solely because "no revocation record exists." Historical reconciliation does not require a new performance epoch; actual transfer of settlement funds still requires L3 approval, dedicated action eligibility, and effect registration.
  - Affected active states enter blocked through `sys.owner_changed`; performance-concluded states and terminal states only have their execution eligibility frozen and continue reconciliation, without changing commitment state. Configuration invalidation covers only references associated with that Agent's authorizations, trust roots, adjudicators, and receipt endpoints; it does not automatically invalidate other tasks of the old principal.
  - **In-flight commitments remain attributable to the originally locked parties and principal anchors**. Responsibility MAY be transferred only after the required parties sign task.amend and the corresponding reservations are atomically validated and migrated; a unilateral assumption declaration by the new owner is insufficient to change an existing commitment. Until assumption is completed, the task is frozen and the original principal remains the backstop. Negative records MUST NOT be rewritten, cleared, or converted into credit for the new owner; outstanding exposure MUST NOT be evaded by changing the owner. When the same principal merely changes its name, the identity root issues proof of identity continuity, and the original principal anchor remains in use.
- **Retirement handover**: unresolved commitments require termination through stop/cancel, replacement of the responsible party through task.amend (with the new responsible party signing acceptance), or explicit assumption by the principal. delegate can only derive subtasks and does not transfer responsibility for the parent task. Normal retirement MUST NOT occur before handover; the principal remains the backstop for emergency security revocation.
- Cloning does not copy keys; new keys are requested, and instance lineage is declared in the contact card.

### 5.3 Contact Cards

Contact cards are exchanged when establishing contact or joining a group, with the following fields:

| Field | Description |
|---|---|
| Identity and owner | Address, `owner`, principal anchor, signature method (see §13.2) |
| Capability list | Task types the Agent can undertake, with corresponding payload kinds and versions (field mappings to A2A AgentCard are recommended, §17.6) |
| Supported profiles and levels | Claimed profile (§17.4), supported event set, highest structural level, downgrade mapping table version, token encoding bindings, and resolution endpoints (see §14.1) |
| Rates and metering | Pricing method (priced only in fiat currency; token counts are reference fields only). The contact card is the sole source of rates; Presence does not publish rates |
| Reputation summary | Computed by the platform within the domain under §5.4; self-reporting is prohibited |
| Authorization ceiling | Maximum scope that can be granted (resource × action) |
| Contracting authority boundaries | Monetary/action limits within which the Agent is authorized to make commitments independently; exceeding them requires escalation |
| Capability boundary declaration | An Agent claiming Core-L2 MUST declare that it "does not execute the four categories of actions in §9.2" (§17.4) |

The contact card directory does not permit bulk enumeration by default: queries require authentication and rate limiting; addressing supports separation of public aliases from real addresses. Public aliases can be abandoned at any time, and real addresses are exchanged only after the handshake. Enumeration prevention constrains real addresses and bulk exports without blocking targeted discovery—discovery follows three controlled paths: **public alias directory** (exposes only aliases and broad capability categories; queries require authentication and rate limiting), **invitation-based lookup** (locates the other party using an invitation credential issued by a room owner or member), and **intra-domain directory** (members of the same domain query by name through the domain owner's directory, available only to authenticated members within that domain).

### 5.4 Reputation: Three Anchors and Responsibility

Purely count-based reputation can be inflated through self-dealing, reset by abandoning an identity, or cashed out in a one-time abuse; the core specification therefore requires:

- **Anchor to the principal**: reputation is bound to the principal anchor (a verified human/organizational identity or deposit account), not an Agent instance; changing instances does not change reputation, and deregistration does not erase negative records.
- **Anchor to actual settlement**: economic reputation weight is based solely on actual escrow settlement; unsettled tasks MUST NOT be represented as records of economic performance. Valid events produce objective statistics (also applicable to Core-L2); subjective conclusions MUST go through the dispute procedure. Economic weight increases with the settlement amount and counterparty independence, while the marginal contribution of self-dealing and transactions within small circles approaches zero.
- **Anchor to exposure**: a principal's **total outstanding in-flight exposure** (aggregated across tasks, rooms, and aliases by principal anchor) MUST NOT exceed its credit limit, as enforced by the shared credit ledger (§10.9); per-transaction limits are supplementary constraints and do not replace the aggregate constraint. Credit sources can include deposits, guarantees, and historical actual settlement amounts; a low-value entry path MUST exist for new principals.
- **Responsibility rule**: events that pass signature verification, applicable authorization checks, and submission validation are attributed to their principal under the locked contract; "the Agent was subjected to prompt injection" does not by itself exempt responsibility within the scope of valid authorization; invalid or forged events MUST NOT create performance obligations, settlement, or reputation penalties solely on the basis of signature bytes.
- **Backstop declaration**: implementations enabling AIMP/L3 execution of §9.2(a) fund expenditures or (c) irreversible actions MUST declare their default backstop mechanism (deposits, insurance, credit, etc.); without a backstop declaration, they MUST NOT execute such actions.

Reputation has two tracks: the **objective track** (mechanically computable statistics such as timeliness, format compliance, metering consistency, timeouts, and cancellations) is computed automatically without depending on anyone's subjective judgment; the **subjective track** (authenticity and quality) can be included only after adjudication through the dispute procedure (§10.5). Across domains, reputation scores are not mutually recognized; only the bit indicating "whether a domain vouches for this principal" is exchanged (see §16 for endorsement credentials).

**Numerical parameters**, including reputation score composition, independence coefficients, deposit leverage, and entry credit limits, belong to 〔Profile: Governance〕; reference conventions appear in Appendix C. This profile MUST provide a risk model explaining why, under its parameters, the expected net gain from malicious default within the deposit-backed tier is nonpositive. The core specification does not fix these numerical values.

### 5.5 Handshake and Session Contract

Establishing contact or joining a group follows a three-stage handshake: **discovery (read the contact card) → scope negotiation (what can be viewed and acted upon within this room) → room owner/user confirmation**. Members who have not completed the handshake remain in an uncontracted state and can send only L0/L1 messages.

The handshake result is locked as a **session contract**, containing at least:

| Contract item | Description |
|---|---|
| Profiles and capabilities | Profiles claimed by both parties, supported levels, event sets, payload kind sets and versions, and downgrade mapping table version |
| Ordering authority | Sequencer identity, backup sequencer, maximum ordering time `T_order`, and failover rules (§10.3) |
| Time limits and bounds | clarify count and cumulative pause limit, maximum blocked duration, lease duration, hop limit (default 8), whether participant revisits are enabled and their maximum count (§10.2) |
| Disputes | `dispute_resolver`, substitute in case of a conflict of interest, adjudication deadline, and consequences of no ruling (§10.5) |
| Security parameters | Maximum age of revocation and token status information (default ≤5 minutes and no later than token exp, §14.1), verifiable triggers and cumulative limits for exemptions and extensions (§10.3, §15.3) |
| Escalation recipients | Recipients for excessive clarify requests, excessive blocking, acceptance timeouts, and results that cannot be reconciled |
| Role matrix | Roles, permitted events, highest levels, bounded task scopes, authorization sources, validity periods, and revocation rules; includes clarify permissions during the initial part of the session |
| stop scope | Holder, task or bounded set, authorization source, and validity period; a room role alone does not grant forced stop authority |
| Receipt endpoints | Endpoints signed by the principal, sequencer identifiers, and independence declarations; these can be inherited from a signed domain policy |
| Acceptance and objections | review deadline, rework objection period, verifiable extensions, and handling of nonresponse |
| Retention period | Event chains, idempotency records, effects, schemas, checkpoints, and input and artifact bodies; by default, at least 24 months after conclusion, and MUST NOT be shorter than the applicable dispute and contractual evidence retention periods |
| Revocation-related extensions | Verifiable triggers for sys.revoked and cumulative limit on deadline extensions; does not extend an expired epoch or lease |

For handling messages that fall below the contracted profile level during a session, see the decision order in §15.4.

#### 5.5.1 Session Contract Versions and Changes

- Each change to the session contract generates a new version `contract_version{hash, seq, effective_at, parties[]}` and records it in the chain; all parties MUST sign at their respective signature levels.
- Session contract changes apply only to task_ref instances established after effective_at; established tasks retain their original contract version and minimum required effect. Changes to task business terms require task.amend signed by the required parties; the old terms remain effective until the amendment takes effect, and locked effect requirements MUST NOT be lowered.
- **Explicit exception**: a change of ordering authority MAY apply to established tasks under failover rules previously locked in the old contract, or after explicit consent from the parties required for that task is recorded in the chain—this applies only to the ordering principal and read-only operation during handover, includes no downgrade of effect, and MUST satisfy the fencing requirements in §10.3.
- A payload kind version upgrade MUST declare a parallel support window in the contract; locked schemas and validation rules MUST be retained until the relevant tasks have concluded and the audit retention period has expired, and their valid events MUST NOT be invalidated solely because the window has ended. Approval requests are executed using the schema version locked at rendering time; if another version is needed, they MUST be rendered again and approved again (§13.1).

---

## 6. Presence: Availability Status

Presence extends "online/offline" into states usable for routing, but is published at tiered disclosure levels:

```json
{
  "agent": "agent://relay.example/data-bot",
  "presence": "accepting",
  "current": { "thread": "thr_…", "task_alias": "Routine data retrieval", "since": "…" },
  "load": { "queue": 2, "eta_free_min": 15 }
}
```

- `presence` enumeration: `accepting` / `busy` / `blocked` (waiting for human or external input) / `quiet` (receives only messages that @-mention the agent itself) / `offline`.
- **Fields not published**: Internal implementation details such as context utilization (capability fingerprints with no interoperability semantics) and rates (for which the agent card is the sole source) are not part of standard Presence and MAY be provided as access-controlled vendor extensions.
- **Visibility tiers**: The public tier exposes only three coarse-grained buckets (accepting / busy / offline); `current`, `load.queue`, and `eta_free_min` are visible only to parties with an established commitment; task names MAY use aliases to conceal sensitive information. The **mapping rules** from five states to three buckets are fixed: accepting → accepting; busy → busy; blocked → busy; quiet → busy; offline → offline. This mapping occurs only when publishing at the public tier; the parties' tier continues to expose the original five-state values.
- **Request acceptance rules for quiet**: A `quiet` member does not respond to a `request` that does not explicitly name it; when explicitly @-mentioned, it MAY be awakened to receive the request and MAY `accept` a request explicitly assigned to it (after accept, presence SHOULD immediately transition to accepting or busy); messages that do not explicitly name it are received without a response.
- **Declaration, not fact**: Presence is a declaration rather than telemetry. Routing decisions that carry operational responsibility MUST NOT rely solely on Presence and MUST instead use platform-side queue data or **signed telemetry**—forgeable fields MUST NOT bear operational responsibility.
- **Signed telemetry**: A structured availability credential issued by the platform or an independent telemetry service, with the following minimum fields: subject address, presence value, queue depth, issuance time, validity period, and issuer signature. If neither signed telemetry nor platform queue data exists in a deployment, Presence serves only for display and advisory hints that do not carry operational responsibility.
- **Routing requests without explicit addressees**: A `request` in a group that does not explicitly name an addressee is eligible only when the room **explicitly enables routing for public request acceptance**. The sender SHOULD provide `to`/`mentions` or `payload.required_kinds`; the platform performs deterministic, non-LLM filtering using the capability list in agent cards + trusted queue data, selects a bounded set of candidates (≤K, counted against the room's wake-up budget, §14.3), and only then allows candidates to perform semantic evaluation; only candidates in the `accepting` state MAY `accept`; actual claiming follows sequenced atomic claiming (§10.2). Presence does not determine ultimate responsibility.

---

## 7. Message Envelope

### 7.1 Structure

Each message = envelope header (protocol metadata) + body (natural language) + structured block (as required by level) + attachment references + signature; effect-bearing messages additionally carry a **sequencing record** appended by the sequencer (two signature layers, §10.4).

```json
{
  "aimp": "1.0",
  "id": "msg_9f2c…（random ≥128 bits）",
  "thread_id": "thr_sub_…（subthread）",
  "room_id": "room_…",
  "task_ref": "task_T2…",
  "target_event": { "id": "msg_51aa…（accept event of parent task T1）", "hash": "…" },
  "from": "agent://relay.example/data-bot",
  "to": ["agent://relay.example/report-bot"],
  "mentions": ["agent://relay.example/report-bot"],
  "audience": ["agent://relay.example/report-bot", "room_…"],
  "exp": "2026-11-03T05:25:00Z",
  "key_id": "k_…",
  "reply_to": "msg_77ab…",
  "ts": "2026-11-03T05:20:00Z",

  "act": "delegate",
  "source_level": "peer",
  "classification": "internal",
  "body": "@ReportBot Please take over writing the weekly report: use last week's template; figures must be traceable to the attached csv and attribution draft; deliver by 9 a.m. tomorrow.",
  "locale": "zh-CN",

  "payload": {
    "kind": "task.delegate@1",
    "must_understand": true,
    "parent_task": "task_T1…",
    "expires": "2026-11-03T05:24:00Z",
    "assignee": "agent://relay.example/report-bot",
    "reviewer": "agent://relay.example/review-bot",
    "lineage": [
      { "task_ref": "task_T1…", "assignee": "agent://relay.example/data-bot", "hop": 0 }
    ],
    "deadline": "2026-11-04T01:00:00Z",
    "budget": "none",
    "inputs": [
      "artifact://…/retention-2026w44.csv@v3",
      "artifact://…/attribution.md@v1"
    ],
    "acceptance": {
      "predicates": ["Figures are traceable to inputs", "Measurement definitions = next-day/7-day/30-day tiers, broken down by channel"],
      "subjective": "Produce according to template://weekly-report/v2",
      "trust_root": "agent://relay.example/review-bot"
    }
  },

  "capability_token": { "ref": "cap_ref:…（derived from the chain-head hash and this message's id）", "chain_head": "…" },
  "intent_origin": [ { "id": "msg_51de…", "content_hash": "…" } ],

  "sig": "…（lowercase hex of the 64-byte Ed25519 sender signature）",

  "sequencing": {
    "intent_hash": "…（SHA-256 of the sender intent signature input）",
    "sender_sig": "…（lowercase hex of the sender signature bytes）",
    "seq": 1042, "term": 3,
    "recorded_at": "2026-11-03T05:20:01Z",
    "prev_hash": "…（hash of the preceding committed record in the same thread）",
    "verdict": "sequenced",
    "sig": "…（lowercase hex of the 64-byte Ed25519 sequencer signature）"
  }
}
```

This example is delegation only: inputs are referenced through `inputs` and **do not constitute delivery**; the data Bot's delivery is recorded by a separate `deliver` event on its root task (§10.1, §18).

### 7.2 Field Table

| Field | Required | Description |
|---|---|---|
| `aimp` | Yes | Protocol version |
| `id` | Yes | Globally unique and unpredictable (random ≥128 bits). Used as the deduplication key; the same id with different intent hashes constitutes evidence of a conflict and MUST raise an alert rather than be silently discarded (§7.3) |
| `thread_id` | Yes | Containing thread; for a one-to-one conversation, MAY be derived from both parties' addresses |
| `room_id` | Required for group conversations | Containing room |
| `task_ref` | Required for task events | Associated commitment instance, bound to a unique authoritative thread; preliminary conversational clarify events and independent control-log events MUST NOT fabricate a task_ref (§8.2) |
| `target_event` | Required for effect-bearing events | id and intent hash; null for root creation; delegate references a committed event in the parent chain. A preliminary conversational clarify MAY reference an unsequenced message in the same thread's transport receipt records, and MUST bind its content hash at that time |
| `from` / `to` | Yes | Sender and delivery set |
| `mentions` | No | Explicitly named responsible parties. Strictly separate from `to`: receiving a message ≠ being assigned responsibility |
| `audience` | Required for effect-bearing messages | Signed set of intended verifiers (participant addresses or room/domain scope identifiers). A verifier outside `audience` MUST refuse signature verification—to prevent signatures from being replayed across contexts |
| `exp` | Required for effect-bearing messages | Signature expiration time, evaluated against the sequencing authority's receipt time; SHOULD be no more than 5 minutes away. Expired signatures confer no effect |
| `key_id` | Required for L2+ | Signing-key identifier, used to evaluate revocation and rotation (§5.2) |
| `reply_to` | No | Causal chain. Results, acceptance reviews, and follow-up questions MUST link back to the source message |
| `ts` | Yes | Sender timestamp, for display only; all time-limit determinations use the sequencing authority's receipt time |
| `act` | Yes | Speech act (§8). Treated as `chat` if unspecified by the sender |
| `source_level` | Yes | Primary source level of this message's content (§12): `principal` / `peer` / `environment`. For mixed sources, use the least trusted level and annotate each segment in `payload.body_segments`. Only legitimate producers under §13.7 MAY designate `principal` |
| `classification` | No | Classification label: `public` / `internal` / `confidential`; defaults to the domain's default classification. Members with a lower classification clearance see only a redacted summary of higher-classification messages (§14.4) |
| `body` | Yes | Natural-language body, prioritizing human readability |
| `locale` | No | Body language |
| `payload` | By level | Structured block. `kind` includes a version; see §9.3 for `must_understand` and §7.5 for core schemas |
| `payload.lineage` | Required for delegate | Immutable ancestor list `{task_ref, assignee, hop}`, with the root task first (§10.2) |
| `capability_token` | Required for execution actions | Core-L2 uses an inline single-hop root token; L3 uses a complete chain. The authorization ceiling in a profile card does not constitute actual authorization; the envelope MUST NOT supply its own scope |
| `intent_origin` | Required for L3 | Chain of principal messages that triggered this action, with `{id, content_hash}` at each hop (§12); see §16 for the cross-domain form |
| `artifacts` | As required by act | Versioned deliverable references (content addressing + hash). Required for `deliver`; otherwise defined by the payload kind. Actual objects are not embedded in the message body; group handoffs pass references, while direct queries return actual objects |
| `sig` | Required for L2+ | Sender signature covering the **sender intent** (§7.4). Signing method depends on the profile: in Core-L2, a session key issued by the principal applies the signature, proving only provenance and integrity and **not constituting execution authorization**; from L3 onward, a signing gateway applies it (§14.2). **Fields outside the signature coverage MUST NOT carry effect** |
| `sequencing` | Appended by the sequencer for effect-bearing messages | Intent hash, sender signature, thread seq/term/prev_hash, recorded_at, verdict, and sequencer signature. Not supplied by the sender; see §10.2 for the unique authoritative thread rule |
| `control_ref` | Applicable to control-log events | Object identifier for an independent identity, contract, or receipt log; MUST NOT be treated as a task_ref under which a separate commitment can be created |

Effect-bearing messages cover state, authorization, timing, side-effect events, and registered control events: they MUST be signed, sequenced, and incorporated into the chain; labels alone confer no effect.

### 7.3 Delivery Semantics and Idempotency

- Delivery uses **at-least-once + a bounded deduplication window** (the transport-layer deduplication cache retains entries for at least 24 hours). AIMP **does not claim exactly-once**; side-effect registration (§11) ensures that consistency of effects outside the protocol can be reconciled.
- **Two record layers with separate responsibilities**:
  - **Transport deduplication cache**: intercepts duplicate deliveries by `id` within the window.
  - **Protocol idempotency records**: effect-bearing events are compared by their **canonical sender intent hash** (§7.4), which is persisted throughout the task audit retention period. The same id with the same hash returns the original commit receipt; the same id with a different hash reports a conflict; old messages beyond the retention period enter only the archival verification process. **Historical replay MUST NOT trigger execution or notifications.**
- effect, idempotency, historical schema, and event evidence all follow the retention periods in §5.5 and MUST NOT be destroyed while obligations remain outstanding or disputes remain unresolved; beyond the deduplication window, reconciliation still uses the original effect_id, and execution MUST NOT be repeated.
- Transport redelivery metadata, sender signature bytes, and sequencing wrappers do not participate in determining the "same intent"; changing the expiration time, key identifier, or authorization material constitutes a different intent.

### 7.4 Signature Format, Projection, and Canonicalization

Signatures cover an **explicit field projection**, rather than “the complete envelope with sig removed.” Executable projection algorithms and JSON Schemas for the four object types are provided in the accompanying `aimp-v3.1-schemas.json` and `verify_v31_vectors.py`; actual test inputs and signatures are in `aimp-v3.1-test-vectors.json` (Appendix B).

| Object | Projection and bytes |
|---|---|
| Sender intent I | Copy only the aimp, id, thread_id, room_id, task_ref, control_ref, target_event, from, to, mentions, audience, exp, key_id, reply_to, act, source_level, classification, capability_token, and intent_origin fields that are present; append body_hash, payload_hash (if payload is present), and a ref/version/sha256/media_type projection of artifacts (if artifacts is present) |
| Sequencing record R | intent_hash, sender_sig, seq, term, recorded_at, prev_hash, verdict; sender_sig is the original sender signature bytes in lowercase hex |
| System intent S | id, thread_id, task_ref or control_ref, target_event, act, source_level, key_id, payload; signed by an authorized system issuer, then incorporated into a thread sequencing record |
| Approval object A | schema_version, task_ref, action_type, target, amount, irreversibility, artifacts, payload, constraints; actual expanded targets and constraints MUST be complete, and targets MUST NOT be hidden through additional fields |

- body_hash = SHA-256(raw UTF-8 bytes of the body string), without Unicode normalization; payload_hash = SHA-256(JCS(payload)). Artifact hashes cover the original object bytes, and ciphertext hashes cover ciphertext bytes; the schema distinguishes business plaintext hashes from ciphertext transport hashes, which MUST NOT be used interchangeably.
- The four signature/digest inputs are respectively `UTF8("AIMP/1/intent") || 0x00 || JCS(I)`, with record, system, and approval following the same form. intent_hash is the SHA-256 of the intent signature input; the record-chain hash is the SHA-256 of the record signature input (including sender_sig, excluding the sequencer's own sig). The genesis predecessor is 64 zero characters; thereafter, prev_hash references the preceding record-chain hash in the same thread.
- Signatures use Ed25519; digests use SHA-256, both represented in lowercase hex. This version does not permit arbitrary algorithm substitutions while claiming the same signature profile. Approval normally references the digest of A through approve; the signature vectors in the appendix demonstrate the same domain-separation bytes and do not replace the complete event signature for approve.
- Use RFC 8785 JCS, rejecting duplicate keys and invalid Unicode; keys are sorted by UTF-16 code units, with no whitespace. Monetary amounts use decimal strings plus a currency, not floating-point numbers; UTC timestamps use RFC 3339 Z notation. An absent optional field is not equivalent to null; defaults MUST NOT be inserted without authorization. sig, sequencing, ts, and locale are excluded from I, and the latter two MUST NOT be used as criteria for determining effect.
- Each payload version defines a closed field set; additional side-effect object fields MUST NOT be ignored. Resolving audience is part of signature semantics: room/domain scope identifiers include a domain and version, and effect validation uses the membership and role snapshot at commit time; historical auditing does not reacquire execution permissions. approve/standing authorization MUST explicitly list the sequencer and the gateways/executors that need to validate effect and consume permission, rather than listing only the room.
- The accompanying vectors cover only the safe-integer subset of JCS and are not a complete floating-point serialization implementation; full JCS, state transitions, and profile certification also require passing the scenario tests in Appendix B. Passing four signature vectors alone is insufficient to claim protocol implementation.

### 7.5 Core Schemas and Effect Determination Procedure

Initial versioned core payload kinds (all effect-bearing kinds, with `must_understand: true`):

| kind | Key fields |
|---|---|
| `task.request@1` / `task.propose@1` | Task description, `deadline`, `budget`, `acceptance`, proposed executor / acceptance reviewer, `expires` |
| `task.accept@1` | Proposal version locked by target_event, caveats[]; only options permitted in advance by the proposal or verifiable restrictions that do not expand obligations are allowed; changes to scope/price/deadline/artifacts/acceptance require counter or task.amend, and accept MUST NOT unilaterally add work |
| `task.delegate@1` | `lineage`, `deadline`, `budget`, `inputs`, `acceptance` |
| `task.deliver@1` | `draft` (Boolean, §13.4), `caveats[]` (declared gaps), artifacts |
| `task.review@1` | `decision` (pass / rework / dispute_hint), `findings[]` (mapped individually to locked predicates or criteria), `trust_root` |
| `aimp.receipt@1` | `chain_head`, `covered_seq`, `signer` |
| `aimp.commit-summary@1` | `parties`, `budget`, `deadline`, `chain_root`, `status`, `commitment_hash` |
| `aimp.approval-request@1` | action_type, target, amount, irreversibility, normalized_hash, exp, schema_version; must_render is specified by the trusted schema and cannot be overridden by the requester |
| Other effect-bearing kinds | The per-event table in §8.2 defines the complete required fields and permissions; unregistered implementation-private events MUST NOT be treated as standard events |

Field rules:

- **`acceptance`**: required for L2 commitments, with two sections—`predicates` (a set of machine-evaluable predicates) + `subjective` (subjective acceptance criteria); MAY contain only the subjective section. Also includes `trust_root` (the adjudicator for the subjective section).
- **Basic predicates**: the following predicates are considered locked with every `accept`, without needing to be included in acceptance—artifact hashes match their references; references in the body to existing numeric values in inputs or attachments are consistent; calculated, converted, aggregated, or inferred results conform to the locked measurement definitions and are traceable to inputs (equality with the original values is not required); all schema-required fields are present.
- **`budget`**: required for L2 commitments; MAY be `none` (declaring no metered budget, in which case the over-budget rules in §10.2 do not apply, and cost control follows domain policy). **For commitments involving monetary expenditure, budget MUST specify an amount and currency**; commitments involving only external side effects without monetary expenditure MAY use `none`, but domain policy MUST declare their side-effect quotas; otherwise, `none` is not valid and the commitment is invalid. Commitments with `budget: none` do not create quota reservations (§10.9). If the field is missing, the receiver responds with `clarify` to request it.

**Effect determination procedure** (both sequencers and execution entry points follow this order, stopping if any step fails):

1. Perform bounded parsing and minimum structural validation; after completing the necessary identity verification for the query, first query persistent idempotency records: if a terminal result already exists for the same id and intent hash, return the original verdict without revising the historical decision based on current expiration or revocation status, and without re-executing; report a conflict for a different hash. The original receipt MUST NOT be disclosed to unauthorized queriers;
2. Verify the signature (sender intent signature, `audience`, `exp`, and `key_id` revocation status);
3. Check authorization (permission to speak follows the conversation contract and role matrix; execution permission follows capability tokens, §14.1);
4. Validate the schema (effect-bearing kind, required fields, `additionalProperties`);
5. Check preconditions (transition-table preconditions, including quota reservation checks under §10.9);
6. Commit (sequence, persist, and issue a commit receipt).

Results fall into four categories: committed/invalid/pending verification/negotiable downgrade. pending (pending verification) is a nonterminal receipt that ultimately becomes sequenced or rejected; rejected does not mean the task is declined. The terminal receipt signature binds the intent hash, task_ref/control_ref, term, verdict, seq, and chain head, without granting execution effect again. Only the cases listed in §15.1 constitute hard failures that reject receipt.

---

## 8. Speech Acts (Act)

### 8.1 Vocabulary

| act | Semantics | Effect category (§8.2) |
|---|---|---|
| `chat` | Casual conversation / discussion | Label |
| `inform` | Report facts, progress, or result summaries | Label (the asserting party is responsible for truthfulness; input to subjective-track disputes) |
| `request` | Ask another party to do something (contract not yet established) | State event: creates proposed; does not itself create a performance obligation |
| `clarify` | Ask follow-up questions / request additional information | Timing event: pauses the source request's soft timer (does not pause the hard deadline, §8.4) |
| `propose` | Propose a plan / quote / division of work | State event (binding): binds the proposer until expiration or rejection; binding tiers are specified in §9.1 |
| `counter` | Counteroffer / modify a proposal | State event (binding): same as propose, and automatically invalidates the original proposal being countered |
| `accept` | Accept a proposal or request | State event (binding): creates a performance obligation only upon direct commitment to committed or successful activation; pending_activation only retains a candidate |
| `reject` | Reject (reason provided in the body) | State event (binding): terminates the corresponding proposal / request |
| `delegate` | Delegate a task (including decomposition into subtasks) | State event: a creation event in the child chain; records only an association in the parent chain without transitioning it; the original delegator retains an oversight obligation |
| `cancel` | Cancel an order (by a party or its principal, with a reason) | State event: → cancelled; whether this constitutes a breach is determined by the locked contract, initiating party, and reason (§10.2) |
| `progress` | Report progress | Label: no new obligations; default heartbeat for long-running tasks |
| `deliver` | Deliver results (with artifacts) | State event (binding): → delivered, starts the acceptance timer; with `draft:true`, an authorization event (registration of an approval object, §13.4) |
| `review` | Convey an acceptance decision: pass / rework | State event (binding): pass → accepted; rework → working (§10.5) |
| `approve` | Human (or authorized party) authorization of a sensitive action | Authorization event: bound to the approval object hash, atomically consumed and valid for one use (§13.1); does not transition commitment state |
| `escalate` | Escalate: beyond capability / beyond authority / requires human judgment | State event: → blocked, pauses work and transfers decision authority |
| `resume` | Clear a blockage | State event: blocked → state before entry |
| `stop` | Stop ongoing work | State event (binding): mandatory tier → halted + obligation to report effectiveness (§10.6); effect matrix in §8.4 |
| `dispute` | Initiate a dispute (over truthfulness / quality / measurement) | State event: → disputed, freezes related settlement and reputation deductions (§10.5) |
| `ruling` | Convey a dispute ruling | State event: disputed → state determined by the ruling (§10.5) |
| `subscribe` / `unsubscribe` | Subscribe / unsubscribe to notifications | 〔Profile: Display extension〕Label; controls only the local party's receipt and display, does not trigger wake-ups, and does not serve as a cost-control boundary |

There are also **system events** (in the `sys.` namespace, issued by the sequencer, §10.3): timeouts, lease and execution eligibility changes, claim receipts, activation, result reconciliation timeouts, revocation effects, settlement accounting, etc.

### 8.2 Authoritative Event Registry

Binding acts (a subset of obligation events) ⊂ state events ⊂ binding messages; the scope of strict validation is determined by binding messages, not merely by the seven obligation terms. Categories are state, authorization, timing, side effect, and control; pure labels chat/inform/progress are excluded from effect folding. The table below registers events individually; §10.1 is the authoritative definition of task state transitions. Each payload MUST contain the closed set of fields in the table, plus kind and must_understand:true; the kind for request/propose/delegate/counter/accept/reject/cancel/deliver/review/dispute/ruling/stop/escalate/resume is task.<event-name>@1, for clarify/approve it is aimp.<event-name>@1, and for all other events with dotted namespaces it is directly <event-name>@1; common source/target and signature/time fields follow §7.2. Where a combined row contains multiple event names, each name is registered independently; arbitrary sys suffixes are not accepted.

C = Core-L2 and higher layers; L = L3; S = Sandbox-Settlement. All roles in the table require authorization from the contract or governance root; room identity does not confer authority by default. Ordinary events require at least an L2/account or session-key signature; events involving §9.2 MUST use L3 and the required approve, and high-risk events require human-attested. System/control records require a signature from the identity or sequencing authority. Registration does not imply enablement across profiles.

| Event / @1 kind | Category / object | Required business fields | Role / profile | Preconditions and effects / failure receipt |
|---|---|---|---|---|
| request, propose | State / task_ref | description, deadline, expires, budget, acceptance, assignee, reviewer | Initiator/proposer / C | New task, valid contract and schema; creates proposed; rejected if invalid |
| delegate | State / child task_ref | parent_task, lineage, deadline, expires, budget, inputs, acceptance, assignee, reviewer | Parent owner authorized to decompose tasks / C | Valid parent-chain reference, ancestors do not include the current task, budget allocated within a closed envelope; creates child proposed without transferring parent responsibility |
| counter | State / task_ref | old_terms_hash, terms, terms_hash | Proposal counterparty / C | Current version is proposed; new version replaces the old version; rejected if expired/conflicting |
| accept | State / task_ref | terms_hash, caveats | Counterparty / C | Current proposal, consistent caveats; directly committed or candidate pending_activation; pending/rejected if quota or other conditions are unmet |
| reject, cancel | State / task_ref | reason | Counterparty/contract party / C | Terminates according to §10.1; rejected if unauthorized; does not automatically establish breach |
| task.amend | State/terms / task_ref | old_terms_hash, terms, terms_hash, signatures | All required parties / C | Old version matches; old terms remain valid until effectiveness; changing terms does not change the thread or reduce effect; replacing the owner requires acceptance by the new party and revocation of the old epoch |
| deliver（draft:false） | State / task_ref | draft, caveats | Current performing executor / C | artifacts required in the envelope; working→delivered, revokes the epoch for that stage |
| deliver（draft:true） | Authorization object registration / task_ref | draft, caveats, approval_object | Action applicant / L | Complete approval object; does not transition the task or directly authorize execution |
| review | State / task_ref | decision, findings, trust_root | Locked acceptance reviewer / C | delivered; pass after machine predicates succeed; rework MUST reference locked criteria; a bare subjective pass does not bypass machine prerequisites |
| dispute | State / task_ref | reason, claim | Party / C | During the objection period for delivery/performance termination or rework; references the disputed event; saves the restoration point and freezes unsettled obligations |
| ruling | State / task_ref | decision, findings, resolver, restore_state | Authorized adjudicator satisfying recusal requirements / C | disputed, according to §10.5; restoring working requires a new epoch |
| stop | State/eligibility freeze / task_ref | reason | principal/controller/holder of governance stop scope / C | In-progress state→halted; other states only freeze uninitiated actions and require reporting; advisory stop does not transition state |
| escalate | State / task_ref | reason_code, evidence, mandatory | Party/authorized gateway / C | In-progress state→blocked; mandatory designation verified against evidence; self-reporting is not accepted |
| resume | State / task_ref | resolved_causes, authorization | principal/contract controller/authorized escalation recipient / C | All blocking causes resolved; restores previous_state; allocates a new epoch for working |
| clarify | Timing / task_ref or thread | question, pause_until, default (optional) | Party; in the preliminary phase, a contract-authorized participant / C | Pauses soft timers; references a message hash; does not pause the hard deadline; without a task, does not establish SLA/funding timers |
| approve | Authorization / task_ref | mode, object_hash, schema_version, token_id (for standing) | Human or gateway with standing authorization / L | Object, token, and permissions match; single-use consumption; does not transition the task |
| governance.grant, governance.revoke | Authorization / control log | subject, scope, issuer, valid_until, evidence | Grantor traceable to a principal/governance root / C | Governance authorization such as stop; operates only under rules locked when the task was established; version upgrades do not retroactively expand authority |
| effect.register | Side effect / task_ref | effect_id, logical_action, clause_version, state, epoch, external_idempotency_key | Current executor / C (L for high risk) | state=registered, stable logical action identifier; valid execution credentials; retries with the original token return the original result |
| effect.update | Side effect / task_ref | effect_id, state, epoch, external_receipt_hash, evidence | Current executor/authorized reconciler / C (L for high risk) | Valid edge under §11; entering executing validates current eligibility; historical reconciliation does not require a new epoch |
| sys.epoch, sys.lease_renewed, sys.action_epoch | Eligibility control / task_ref | execution_epoch, lease_until, purpose, action_hash (for action) | Sequencer / C | Initial authorization/lease renewal/wrap-up action; progress cannot renew a lease |
| sys.timeout, sys.activation_timeout, sys.deadline | State / task_ref | reason, deadline, trigger_hash | Sequencer / C | Triggered by valid authoritative time; enters expired while retaining reconciliation of in-flight side effects |
| sys.lease_expired, sys.effect_unknown | State/eligibility / task_ref | execution_epoch, effect_ids, reason | Sequencer / C | working→committed or result_unknown; revokes the old epoch without automatic reassignment |
| sys.reconciled, sys.reconcile_timeout | State / task_ref | effect_ids, result, evidence | Sequencer/trusted reconciler / C | Confirmed not to have occurred→committed; confirmed to have occurred→restore according to result; unresolved at timeout→blocked |
| sys.block_timeout, sys.review_timeout, sys.ruling_timeout | State / task_ref | reason, deadline, trigger_hash | Sequencer / C | Saves restoration point and escalates evidence; no default acceptance or payment |
| sys.activated | State / task_ref | accept_hash, terms_hash, contract_hash, receipt_proof | Source-thread sequencer / C | Fixed candidate matches receipt proof; committed after atomic reservation; failure does not consume the proof |
| sys.not_selected | Claim receipt / task_ref | accept_hash, winner_hash | Sequencer / C | Already atomically claimed; does not transition the task or count as a declined order/against reputation |
| sys.revoked, sys.owner_changed | State/eligibility / task_ref | identity_proof, affected_key, reason | Source-thread sequencer / C | References identity control records; blocks or only freezes eligibility according to state category; does not alter historical attribution |
| owner.changed | Identity control / control_ref | agent, old_owner, new_owner, old_anchor, new_anchor, transfer_bundle | Identity authority / C | Complete candidate triplet takes effect atomically, §5.2 |
| identity.revoked, identity.restored | Identity control / control_ref | subject, key_id, effective_seq, authority_proof | Separate roles recognized by the identity root / C | Initiates revocation/restoration; effects on tasks require corresponding thread events |
| aimp.receipt-ack | Receipt control / control_ref | accept_hash, task_ref, terms_hash, contract_hash, recipient, valid_until | Independent receiving endpoint designated by the principal / C | Notification durably recorded by the authority; creates no source-task obligation and does not replace approval |
| aimp.receipt, aimp.commit-summary | Evidence control / control_ref | chain_head, covered_seq, source_task, commitment_hash, parties, budget, deadline, status | Authorized receipt issuer / C | References source authoritative records; does not write the same task_ref in a second thread |
| session.changed | Contract control / control_ref | old_contract_hash, contract, effective_at, signatures | All parties/contract authority / C | §5.5.1; does not retroactively downgrade established tasks |
| sys.settled | State / task_ref | effect_ids, settlement_receipts, amount, currency, parties | Sequencer using trusted escrow receipts / L or S | accepted→settled; does not release funds based on the executor's unilateral report |

**Preliminary-session clarify**: No fabricated task is required. Submitted by a participant authorized by the contract role matrix; target_event MAY reference an unsequenced message in the same thread's transport receipt records, binding its id and content hash at that time; pauses only existing session soft timers and does not constitute a timing basis for tasks, billing, assessment, or SLAs. Preliminary-phase counts/pauses are recorded separately per session.

**task.amend** changes only task terms; it does not change the authoritative thread. Changes to scope, budget, deadlines, or acceptance criteria require consent from the corresponding parties; a new owner MUST sign acceptance, and the old eligibility becomes invalid in the same commit. Unregistered effect-bearing events MUST NOT be executed; pure labels MAY only be displayed or used as prompts and are excluded from state folding.

### 8.3 Boundaries of Effect Semantics

The semantics of registry events are defined by **observable effects**: for example, the semantics of a valid acceptance are "transition to committed after direct commitment or successful activation, creating a performance obligation attributable under the contract; pending_activation does not create that obligation," rather than "the sender internally agrees." This definition is strictly limited to two kinds of effects: state transitions themselves and machine-decidable predicates (hash equality, schema compliance, passing tests, comparable numeric values, etc.).

**Delivery quality is outside effect semantics**: subjective quality acceptance is an adjudication outside the protocol—made by the trust root locked by the contract (the principal personally or a trusted third party designated by the principal); `review` is only the channel for conveying the decision. Any transition involving quality judgment (delivered → accepted) MUST specify `trust_root` in `task.review`.

### 8.4 Authorization Matrix

- **stop effect matrix**:

| Issuer | Effect |
|---|---|
| The commitment's principal, contract-designated controller, or holder of governance stop scope | **Mandatory**: in-progress state → halted; performance-completed states and terminal states retain their state, only freezing relevant execution eligibility, preventing uninitiated actions, and requiring reporting |
| Other room members (including humans and room owners without governance scope) | **Advisory**: converted to an escalate notification; does not change state, execution eligibility, or timers |
| Non-member | Invalid |

  A mandatory stop issued by a human has the highest processing priority within its valid stop scope (§10.6); this does not automatically grant stopping authority to all room owners or all humans. A stop MUST include a reason; if subsequently adjudicated abusive, it is counted against the issuer's reputation.
- Within a task, clarify/dispute are restricted to authorized parties, and review to the locked acceptance reviewer. The preliminary-session clarify exception follows the role matrix in §8.2 without fabricating commitment parties. stop scope derives from authorization traceable to a principal/governance root; a domain governance root MAY grant a room owner bounded granting authority; an unauthorized party cannot create permissions for itself. Governance grants/revocations are recorded separately on-chain and operate only under governance rules locked when the target task was established; exceeding those rules requires explicit consent from the parties; contract version upgrades cannot retroactively expand authority.
- **clarify constraints**: The count limit, cumulative pause duration, timer resumption rules, and escalation recipient are locked in the session contract. After a limit is exceeded, the default is "resume soft timers; the hard deadline continues," with an escalate to the contract-designated escalation recipient; upon deadline expiry, follow the expired path, with attribution adjudicated according to the contract and evidence (executor breach is not presumed; missing inputs may be attributable to the delegator). clarify counts and pause durations are recorded in the sender's objective track; "no new information provided" is automatically recorded as a violation only when a locked machine-decidable predicate holds; otherwise, it requires adjudication through the dispute procedure.
- **escalate quota**: Non-mandatory items exceeding the quota are queued; mandatory MUST include a versioned reason_code and triggering evidence: a committed matching event, or a rejection receipt/verification proof issued by a contract-recognized sequencer/execution gateway/trusted verifier. Signature issuance authority, task-action binding, validity, and type correspondence are verified mechanically; the sequencer need not understand the body, bare self-reporting is not accepted, and a valid safety escalation is not rejected merely because it is not recorded on-chain. Unknown risks use alerts pending verification with anti-abuse limits. Verified mandatory items bypass do-not-disturb.
- **Sealed proposals**〔Profile: Sealed-Propose〕: propose MAY use commit-reveal mode. The proposer first sends `propose`, with a payload containing only the commitment value commitment = H(canonicalized hash of proposal content ‖ random salt) and a reveal deadline (based on sequencing-authority time); before the deadline, revelation is completed with a message disclosing the plaintext and salt, which anyone can recompute and verify; proposals not revealed by the deadline are automatically invalidated and recorded in the proposer's objective track; revealed content inconsistent with the commitment is treated as forgery; before revelation is complete, no party MUST assert effect based on the sealed content. This mode is not included in any core profile. Sensitive commercial negotiations SHOULD take place in a direct thread between the parties, with only status summaries retained in the group thread.

### 8.5 Extensions and Registration

- Custom acts and payload kinds use the `x.<domain>.<name>` namespace; the first segment MUST be a domain name controlled by the registrant (ownership is determined through domain verification).
- **Protected list** = all semantics of state events, authorization events, and timing events in the registry: no extension MUST reuse their roots or claim equivalent effect; changes require the public revision process (§17.3).
- Extension acts are pure labels by default; to produce any of the first three categories of effect, an extension MUST be registered as a new registry row (including a transition-table row and conformance tests) and declared through a profile.
- The registration threshold is "a public description exists"; committee approval is not required; new collaboration patterns operate in natural language first and are registered and codified once frequent and stable.

---

## 9. Structure Levels

### 9.1 Four Levels

| Level | Form | Applicability | Constraints |
|---|---|---|---|
| L0 Plain Conversation | `act=chat/inform` + body | Discussion, notifications, brainstorming | No commitment effect |
| L1 Soft Annotation | Declared act, no payload | Clarification requests, expressions of position, conversational proposals | Conversational effect (may be cited), no performance obligation |
| L2 Structured | act + payload (including budget / acceptance), with artifacts attached as required by the act | Delegation, delivery, acceptance | Enters the commitment state machine; MUST be signed (§7.2) |
| L3 Contractual | L2 + capability token + signature gateway signature + intent_origin + approval hash binding | Payments, external sending, irreversible operations, cross-domain delegation | MUST NOT execute without a signature or token; acceptance and settlement are governed by the envelope; available only in 〔Profile: L3〕 |

Regarding L1 `propose`: its constraints are solely **conversational constraints**—the proposer MUST NOT deny having made the proposal and MUST NOT make a contradictory opposing claim without first withdrawing it. Noncompliant claims serve only as evidence; penalties MUST be attributable and follow due process, and unverified text cannot be used to penalize an impersonated party. It creates no performance obligation and MUST NOT be directly established as an L2 commitment by `accept`. To establish a commitment based on an L1 propose, the other party MUST first restate the proposal at L2 (with a payload), after which the L2 version is subject to `accept`.

### 9.2 Level Upgrade Triggers

Whenever a message would cause any of the following consequences, the sender MUST upgrade to L3, and the recipient of such a request below L3 MUST first reply with `clarify` to request the missing elements and MUST NOT execute it directly:

- (a) Expenditure of funds;
- (b) External sending on behalf of a human or organization;
- (c) An irreversible or difficult-to-revoke action;
- (d) Delegation across trust domains.

An implementation claiming AIMP/Core-L2 does not support L3. Upon receiving such a request, it MUST `escalate` (mandatory) to a human for handling outside the protocol and retain an audit trail, or hand it off to an L3 implementation (§17.4).

**Precedence relative to trust handling**: When message authenticity is in doubt (no signature, unverifiable signature, invalid token), trust handling takes precedence over this rule—the recipient MUST NOT execute the request and MUST treat the message as having only L0 effect; no clarify obligation applies in this case. clarify is an action that requests missing elements from a **trusted** sender; the clarify obligation under this rule is triggered only when the message is trusted but its level is insufficient.

### 9.3 must_understand

`payload.must_understand` indicates whether the recipient MUST understand the structured block to process the message. Load-bearing kinds default to true: an unrecognized load-bearing kind **MUST** be rejected (§15.1 item 3)—this is the only case in which "failure to understand" constitutes a hard failure (permissive admission for casual conversation; strict admission and strict effect for contracts). The reply format is fixed: a `clarify` message carrying structured reason fields (`reason = "unsupported_kind"`, identifying the unrecognized kind and version); this reply itself causes no state transition. Registered older versions within the parallel support window declared by the session contract do not trigger this rule (§5.5.1). Unknown non-load-bearing kinds MAY be handled through fallback under §15, but MUST NOT be handled silently.

---

## 10. Commitment State Machine

### 10.1 States, Eligibility, and Transitions

State truth is scoped by task_ref; ordering, chains, and fencing are scoped by thread. States fall into three categories:

- **Active states**: proposed, pending_activation, committed, working, blocked, delivered, result_unknown, disputed.
- **Fulfillment-complete states**: accepted, settled. The specified dispute, settlement, authorization, and liability closure events are permitted; they do not restart ordinary fulfillment. The contract may lock a dispute period; if none is specified, no period is invented.
- **Terminal states**: declined, expired, halted, cancelled, with no outgoing commitment-state transitions; reconciliation of existing side effects, stop reports, and independently authorized handling of outstanding liabilities may continue. Expiration of a period does not erase outstanding liabilities.

Moving a task out of working MUST atomically revoke the fulfillment epoch for that phase; restoring working MUST grant a new epoch/lease. Eligibility for closure actions is bound to the specific action and MUST NOT permit continued ordinary fulfillment. Task termination, blocking, and whether external outcomes have been settled are independent. The following task transition table is exhaustive; see §8.2 for effect classes and business fields. Illegal transitions are rejected (invalid) rather than modifying state.

| # | Current state | Event | Authorized role / Preconditions | Next state | Effects that MUST be recorded atomically | profile |
|---|---|---|---|---|---|---|
| 1 | — | request/propose | Proposer; valid contract/schema | proposed | Fix the task's authoritative thread, terms hash, and assignee | C |
| 2 | — | delegate | Parent owner authorized to decompose the task; valid ancestors; budget allocated within the parent budget | proposed (child) | Parent chain links tasks without transferring liability; count the budget only once | C |
| 3 | proposed | counter | Counterparty; current version matches | proposed | Replace the terms version and invalidate the old proposal | C |
| 4 | proposed | accept (receipt required) | Counterparty; valid caveats; pending limit not reached | pending_activation | Candidate only; creates no fulfillment obligation and adds no principal exposure | C |
| 5 | proposed | accept (direct/waived) | Valid confirmation by the principal personally or a signed waiver policy; successful reservation | committed | Create obligations; other candidates receive not_selected | C |
| 6 | pending_activation | sys.activated | Source sequencer; fixed candidate/terms/contract match independent receipt evidence; successful reservation | committed | Activate obligations; reservation and activation share one commit; consume evidence once | C |
| 7 | proposed | reject | Counterparty | declined | Reclaim allocations that have not taken effect; invalid accept receipts do not trigger reclamation | C |
| 8 | proposed/pending_activation | sys.timeout/sys.activation_timeout | Sequencer; expires/activation period elapsed | expired | Release internal allocations with no remaining liability; late evidence does not revive the task | C |
| 9 | committed | sys.epoch | Claim by the locked executor; valid authorization; before funding arrives, only a separate escrow-funding action_epoch MAY be granted | working | No existing epoch required for the initial grant; allocate a new epoch/lease | C |
| 10 | working | sys.lease_renewed | Request by the current executor; valid authorization/epoch/new expiry | working | Record renewal in the chain; progress does not change the lease | C |
| 11 | working | deliver (draft:false) | Current fulfillment executor; complete artifacts | delivered | Revoke the fulfillment epoch and start the locked acceptance timer | C |
| 12 | working | sys.lease_expired | Sequencer; lease elapsed; no uncertain side effects in execution | committed | Invalidate old eligibility; do not return to proposed or automatically reassign | C |
| 13 | working | sys.effect_unknown | Sequencer; unresolved side effects in execution | result_unknown | Revoke old eligibility, freeze retries, and associate effect_id | C |
| 14 | result_unknown | sys.reconciled (occurred) | Authorized reconciler; trusted receipt | committed | Record the effect; continued fulfillment requires a separate epoch grant, followed by delivery through deliver | C |
| 15 | result_unknown | sys.reconciled (did not occur) | Authorized reconciler; confirmation that the effect did not occur and will not take effect late | committed | Retain the original effect_id; retries MUST use a new epoch | C |
| 16 | result_unknown | sys.reconcile_timeout | Sequencer; reconciliation timed out | blocked | Preserve the recovery point; mandatory escalate | C |
| 17 | committed/working/delivered/result_unknown/blocked | escalate | Party / authorized evidence; §8.4 | blocked | Preserve the first previous_state and the set of blocking reasons; do not overwrite old reasons | C |
| 18 | delivered | sys.review_timeout | Sequencer; acceptance period elapsed | blocked | previous_state=delivered; escalation does not imply acceptance/payment | C |
| 19 | blocked | resume | Authorized controller; all blocking reasons resolved | previous_state | working requires a new epoch grant; terminal states cannot be revived | C |
| 20 | blocked | sys.block_timeout | Sequencer; limit exceeded | blocked | Preserve reasons/recovery point; escalate to the designated recipient | C |
| 21 | committed/working/blocked/pending_activation | cancel | Authorized party; valid reason | cancelled | Revoke/freeze execution eligibility; continue reconciling in-flight effects | C |
| 22 | committed/working/blocked | sys.deadline | Sequencer; hard deadline elapsed with no valid extension; not delivered | expired | Stop actions not yet initiated; record timeout causes separately without presuming fault | C |
| 23 | delivered | review (pass) | Locked reviewer; machine/base predicates pass; valid subjective trust root | accepted | Complete fulfillment; release only balances with no outstanding liability | C |
| 24 | delivered | review (rework) | Locked reviewer; findings correspond to locked criteria | working | Free rework; commit the new epoch/lease with the transition; defer execution if the grant cannot be made | C |
| 25 | accepted | sys.settled | Sequencer; trusted escrow effect receipt binds payer/payee, currency, and amount | settled | Record settlement; do not roll back historical payments | L/S |
| 26 | delivered/accepted/settled | dispute | Party; valid objection period/reference | disputed | Preserve previous_state; freeze outstanding amounts and disputed reputation items | C |
| 27 | working/committed/blocked (rework phase) | dispute | Reference to the latest valid review{rework}; within the objection period | disputed | Preserve rework/blocking reasons and outstanding facts; lease invalidation does not remove the right to object | C |
| 28 | disputed | ruling | Valid locked adjudicator and recusal rules | previous_state/working/accepted/settled/cancelled | working MUST use a new epoch; compensation requires independent authorization | C |
| 29 | disputed | sys.ruling_timeout | Sequencer | disputed | Dispose of only determinable escrow tranches; freeze and escalate the remainder | C |
| 30 | Any active state | stop (mandatory) | Valid control authority under §8.4 | halted | Atomically freeze eligibility and report effects; do not automatically release in-flight reservations | C |
| 31 | accepted/settled/terminal state | stop (mandatory) | Applicable stop scope | Same state | Freeze eligibility within its scope and prevent closure actions not yet initiated; reclaiming eligibility requires explicit controller authorization | C |
| 32 | Any active state | sys.revoked/sys.owner_changed | Source sequencer references identity-authority evidence | blocked | Preserve recovery point/reasons; invalidate old epoch; extend deadline only under the contract | C |
| 33 | accepted/settled/terminal state | sys.revoked/sys.owner_changed | Source sequencer; valid identity evidence | Same state | Do not change historical attribution of liability; freeze eligibility and continue reconciliation | C |
| 34 | Active state | task.amend | Required signatures; old terms hash matches; no reduction in effect | Same state | Increment terms version / atomically adjust reservations; changing the owner invalidates the old epoch; MUST NOT modify locked obligations of a fulfillment-complete task | C |

C=Core-L2 and higher layers, L=L3, S=Sandbox-Settlement. Effect reconciliation for registered/executing/unknown does not disappear when a task reaches a terminal state. draft:true, approve, and effect events do not themselves transition the commitment state; other system records MUST NOT bypass this table to create hidden transitions. Approximate A2A mappings are for adaptation only and cannot become a second state authority.

### 10.2 Threads, Tasks, Delegation, and Execution Eligibility

- A task_ref is permanently bound to the **single authoritative thread** containing its creation event; v3.1 does not support relocate, and task.amend does not move the authoritative thread. Other threads may only display/reference the task and cannot submit effect-bearing events for the same task. Sequencer failover that continues writing the same thread is not thread migration.
- The thread is the sole scope for seq, term, prev_hash, genesis, checkpoints, and fencing; task_ref is the scope for state projection, idempotency, execution eligibility, and limits. State consumes only events for that task in that thread; cross-task associations use explicit references, and aggregated UI order does not determine state. Projection completeness is verified using the thread's total order or trusted evidence covering skipped records; filtered prev_hash values cannot be required to connect directly.
- delegate only creates a child task; the child's accept determines its owner and does not discharge the original owner's obligations for the parent task. Changing the owner of the same task uses task.amend, signed acceptance by the new owner, and atomic invalidation of old eligibility. Multiple child tasks each have an independent task_ref.
- lineage contains only ancestors. Append the parent task record to the verified parent lineage; root tasks have no ancestors, and the current task_ref MUST NOT appear in the list. Aliases or redeclaring a root task cannot reset hop. Revisits require explicit contractual enablement and a bounded count; exceeding hop (default 8) or forming a cycle is invalid and cannot be made effective through a downgrade.
- Multiple candidate accept events use atomic first-arrival claiming; losing candidates receive not_selected receipts, do not transition the task, and incur no rejection or reputation count. A rejected submission receipt differs from a reject state event.
- The initial sys.epoch claim checks only prerequisites such as the locked owner and tokens; it does not require existing eligibility. progress is only a heartbeat; lease renewal MUST use sys.lease_renewed. The default lease is “the lesser of 1/4 of the remaining task period and 30 minutes”; the contract may override it. Moving out of working atomically revokes the fulfillment epoch; rework, resume, and ruling that restore working require a new epoch/lease grant.
- Actions after fulfillment completion, such as sending, escrow funding, and refunds, use sys.action_epoch, bound to a specific action_hash, and cannot continue ordinary fulfillment. A freeze imposed by mandatory stop permits eligibility claims only after explicit reauthorization by the controller.
- Task stopping, lease expiry, and revocation revoke eligibility only; they do not clear external effects that have occurred or remain uncertain. Reporting/reconciling old effects does not require new execution eligibility and does not authorize retries.
- A proposed timeout does not count as breach; other timeouts/cancellations record objective occurrences and causes, with liability determined by the contract. Delays caused by revocation blocking are recorded separately and are not unconditionally counted toward the executor's timeout rate. Preparation costs before accept depend on the proposal and existing valid authorization; pending adds no fulfillment-payment obligation for the delegating principal. After activation, budget applies; none means no metered budget, not exemption from other quotas.

### 10.3 Sequencing and Consistency

- **Explicit designation**: The sequencing authority is explicitly designated in the session contract and accepted by the parties (it MAY be inherited from an accepted domain policy; domain policies typically designate the thread's home server). There is no silently defaulted sequencer.
- **Serializable commit**: In **the same serializable commit**, the sequencer MUST determine effect (§7.5) from the latest committed state, allocate `seq`, persist {event, seq, authoritative receipt time, verdict}, perform limit-reservation checks and deductions (§10.9), and update state, and only then issue a submission receipt. If the sequencer does not hold the limit ledger, it MUST write the reservation intent in the same commit and complete it through two-phase confirmation; **before the reservation is confirmed, it MUST NOT transition to committed or initiate side effects**; if atomicity cannot be achieved across services, fail-closed, reject commitment activation, and return a negotiable receipt.
- **Submission receipts**: Executors MAY act only on successful submission receipts that explicitly grant the corresponding effect, and MUST still pass authorization and execution-eligibility checks at execution time (§14.1).
- **Time limits**: All time limits (deadline, expires, timeout determinations) use the sequencing authority's receipt time; the envelope's `ts` is not effect-bearing. Time disputes are adjudicated using evidence and tolerances agreed in advance in the session contract; a sender's self-signed time cannot unilaterally override authoritative time.
- **System messages**: The sequencer issues signed system messages (the `sys.` namespace), carrying only sequencing facts and transition results, not content; system messages consume `seq` and enter the audit chain. Their signer is the sequencer, which is responsible for the transition results.
- **Terms and fencing**: term and single-writer fencing are scoped by thread; each thread has only one committer. If write authority cannot be proven, freeze; an old term cannot commit after the takeover point of a new term.
- **Failure freeze and takeover**: Takeover follows only rules locked in the existing contract or explicit consent of the required parties; a room owner cannot unilaterally designate a bypass. The new authority MUST first restore the entire committed prefix, idempotency records, limit reservations, and execution eligibility, and provide recovery evidence; the last receipt received by any particular client cannot serve as a truncation point. If completeness cannot be proven, remain frozen; an empty ledger cannot be restarted to claim tasks again. After fencing is complete, continue writing the same thread; resubmissions use the original id/intent to reconcile history. Planned takeover follows §5.5.1, with read-only operation during handover.

- **Explicit limitations**: A submission receipt proves only what the sequencer declared, not ordering fairness or the truth of receipt times. This model sacrifices availability during partitions to ensure that state always has a single truth. Cross-domain threads do not share a sequencing authority; cross-domain collaboration uses the §16 gateway, and the gateway evidence package provides cross-anchoring of the two domains' sequencing results.

#### 10.3.1 Sequencing Liveness

- The sequencer MAY initially return a nonfinal pending response; every submission MUST eventually receive a signed sequenced or rejected response binding the intent hash, task_ref/control_ref, term, verdict, seq, and chain head. pending cannot be treated as a final failure that blocks subsequent submissions.
- The session contract locks the maximum sequencing period `T_order`, backup sequencers, and verifiable triggers, scope, and cumulative caps for exemption / extension.
- K consecutive submissions without a final receipt (**including silence**: neither sequenced nor rejected) **trigger only the query and switchover procedure for “suspected unreachability”**; they do not independently prove that the sequencer is unreachable or independently establish exemption. The backup MUST complete fencing and continue processing after recovery through the §7.3 idempotency records and §11 reconciliation.
- Exemptions, pauses of soft timers, and extensions of hard deadlines **take effect only under the verifiable triggers, scope, and cumulative caps locked in advance by the contract**, and MUST NOT be triggered repeatedly by resubmission or another switchover.
- A sequencer's refusal without legitimate reason to sequence events of the same class for the same task_ref constitutes evidence for attribution of fault and enters the dispute procedure.

### 10.4 Audit Chain

- **Two-layer signatures**: The sender signs the immutable intent (§7.4); at commit time, the sequencer appends {seq, term, recorded_at, prev_hash, verdict}, computes the canonical record hash, and signs it. The sequencer links prev_hash, which is **outside the sender's signature**—allowing concurrent senders to operate without knowing the ordering in advance. Verification of an effect-bearing message requires both the sender signature and the sequencing-record signature; neither alone produces effect.
- **Genesis and checkpoints**: Each thread has a genesis record; the sequencer periodically issues **checkpoints** (covered interval + chain-head hash). Parties may optionally co-sign; absence of co-signatures does not affect chain validity. Co-signature records and unsigned status are both visible on the chain; third-party witnessing is optional.
- **Limits of completeness**: A trusted checkpoint allows verification of the historical prefix it covers and detection of records conflicting with that prefix; **tail truncation or forks after the checkpoint can be detected only with party chain heads, witnesses, or cross-comparison evidence covering the relevant interval**. The protocol makes no unconditional guarantee that “concealment always leaves a gap.”
- **Editing/withdrawal and immutability**: Once an effect-bearing message is sequenced and effective, it cannot be edited or withdrawn; reversal requires a new registry event performing the reverse operation (such as stop, cancel, dispute), with the original and reversal messages recorded in the same chain. Editing/withdrawal applies only to non-effect-bearing messages (§17.1).

### 10.5 Metering, Rework, and Disputes

- **Metering**: Usage receipts are issued by the inference gateway/service provider, bound to task_ref, and entered into the thread; consumption figures self-reported by the executor are not a settlement basis. budget means “a cap + settlement based on verified actual usage (through staged escrow releases, §10.7).”
- **Metering for self-hosted deployments**: When the executor operates its own inference gateway, self-signed receipts are equivalent to self-reporting and MUST NOT serve as the sole settlement basis; in this scenario, receipts are instead centrally metered and issued by the domain owner's gateway, or bilateral reconciliation is used—executor receipts are reconciled item by item against counts on the delegating party's side, and inconsistent items MAY be settled only after entering the dispute procedure.
- **Three-way classification of review returns**: The findings in `review` MUST correspond item by item to locked criteria:
  1. Violation of locked machine predicates, locked caveats, or base predicates (§7.5) → `review{rework}`, entering working for **free rework**;
  2. Matters involving locked subjective acceptance criteria → adjudication by the trust root locked in the contract; executor objections enter `dispute`, and **do not automatically become requests for additional payment merely because the predicates are not machine-evaluable**; if the trust root is absent or is a party to the dispute, apply the recusal rules below;
  3. New requirements outside all locked acceptance criteria → a separate `propose` and a new quote.
- **Disputes**: Objections concerning authenticity, quality, or metering use `dispute`; related settlement and reputation deductions are frozen pending a ruling.
- **Adjudicators and recusal**:
  - Before a commitment is established, conflicts of interest involving `dispute_resolver` and its substitutes MUST be disclosed, and both parties MUST explicitly accept their adjudicative authority, evidence rules, time limits, and consequences of no ruling.
  - When the adjudicator is a party to the dispute (for example, when the entrusted party disputes unfair rework demands or refusal to pay, the delegating principal is the disputed party), a substitute (a predesignated third party or domain owner) MUST adjudicate. An adjudicator with interests linked to either party, such as common ownership or reciprocal settlements within the last 90 days, SHOULD recuse and disclose the conflict.
  - If no qualified substitute exists, a ruling by a party to the dispute takes effect only within the scope in which both parties explicitly accepted this non-neutral arrangement in advance, and is marked “non-neutral”; in this case, **the complainant MUST NOT be found to have made a false accusation, its reputation MUST NOT be reduced, and its stake MUST NOT be forfeited**. The dispute conclusion is recorded only, and the complainant retains the right to obtain further evidence through contractual or cross-domain channels.
  - Reverse penalties for false accusations are limited to cases in which machine-decidable predicates clearly establish that the complaint is unfounded, and are capped.
  - The ruling and its reasons enter the thread as `ruling`, identifying the adjudicator (trust root).
- **Overdue rulings**: When `disputed` exceeds the ruling period, only escrow tranches with locked evidence sources, predicates, amount allocations, and escrow execution authority, and whose outcomes are determinable, are mechanically released or returned according to predicate results; portions with conflicting evidence or indeterminate outcomes remain frozen and escalate to the domain owner.

### 10.6 Semantics of stop

`stop` is best-effort, not a physical law: delivery may occur after deliver, and effects outside the protocol cannot be recalled. The protocol specifies an **obligation to report the stop's effect**: a party receiving a mandatory stop MUST report the step at which it stopped, which side effects occurred (with corresponding effect-token), and which were reversed. A human-issued mandatory stop has the highest processing priority within its valid stop scope.

### 10.7 Escrow〔Profile: L3 / Sandbox-Settlement〕

Several mechanisms depend on escrow (reputation accounting §5.4, actual-usage settlement §10.5, first-contact staking §16.1, post-settlement compensation §10.8):

- **Escrow provider**: An in-domain platform or an escrow institution designated by the domain owner; it MUST NOT be either party to the transaction or share an owner with either party. Sandbox-Settlement replaces an independent escrow provider with a platform sandbox ledger and involves no real funds.
- **Funding escrow**: accept/activation only reserves internal limits and does not trigger actual transfers. Actual escrow funding is a separate pay action after activation, requiring a token, a matching approve, an action_epoch limited to that action, and effect registration; before confirmation by a trusted escrow receipt, a fulfillment epoch MUST NOT be granted for tasks requiring advance funding. Lock tranche amounts according to machine predicates and subjective portions, and enter escrow receipts into the chain. The sandbox performs no actual pay but still records the corresponding simulated effect.
- **Release**: After accepted, release funds to the executor in tranches based on verified actual usage, returning the difference to the delegating party; each release is a side effect with a registered effect-token, and its receipt enters the thread; after all releases are complete, `sys.settled` transitions the task to settled.
- **Freeze**: Initiating `dispute` immediately freezes the unreleased portion.
- **Disposition after ruling**: Transfer or return funds according to the ruling; the escrow provider executes rulings and does not adjudicate.

### 10.8 Compensation and Recovery for Post-Settlement Disputes

`settled` is not the end of disputes: delivered / accepted / settled can all enter disputed. **Disputes concerning settled tasks do not roll back completed payment facts**; when a ruling upholds a dispute, refunds, recovery, and compensation are executed as **independent, authorized, and reconcilable side effects** (each registering an effect-token) in the following order:

1. Apply unreleased escrow balances first against the amount to be returned;
2. The party ruled against returns the released portion within the period specified by the ruling; overdue amounts are deducted transaction by transaction from its deposit and subsequent escrow credits;
3. If a shortfall remains, reduce its credit limit to zero (§5.4) and record the shortfall in the objective track; in cross-domain scenarios, pursue recovery through contractual channels, using the gateway evidence package for evidence (§16);
4. If effects outside the protocol have occurred and are irreversible, substitute equivalent compensation determined by the ruling for reversal in kind.

If the ruling rejects the dispute, unfreeze escrow and restore `previous_state`, also reversing reputation deductions imposed during the freeze.

### 10.9 Shared Limit Ledger

- Per-action amounts, task budgets, cumulative spending within time windows, and in-flight outstanding exposure are accounted for separately, with different periods and release semantics. At execution time, the same serializable consumption operation checks all applicable tokens and their ancestors for cumulative/count balances, principal exposure, and task balances; any insufficiency causes rejection. Attenuated child tokens share ancestor counters, which do not reset through copying; releasing exposure through settlement cannot restore amounts already consumed within a time window.
- Reserve upon direct entry into committed; pending_activation adds no principal exposure, and activation and reservation share one commit. Internal child allocations of a parent are covered by the original parent reservation; pending allocations cannot be consumed or reserved again. Cross-ledger operations require two-phase confirmation; before confirmation, they neither take effect nor execute, and fail-closed if atomicity cannot be achieved.
- delegate creation and internal parent-child allocation share one commit: reduce the parent's available amount and increase child line items, counting the principal's total only once; preserve used, in-flight, and releasable tranches. If a child reaches declined/expired before its commitment takes effect, reclaim its allocation atomically; invalid accept or rejected receipts do not trigger reclamation. Actual child consumption is aggregated into the parent budget.
- Entering a terminal or fulfillment-complete state releases only balances with no outstanding liability. Corresponding reservations attached to registered/executing/unknown remain frozen until registrations for uninitiated actions are cancelled or reconciliation is completed using trusted evidence; stopping/revocation/lease invalidation does not automatically release them. In Core-L2, an accepted sequencing event may serve as the basis for release review, without requiring actual settlement.
- When budget:none is determined to be inapplicable, the commit record retains “no funds reservation required” and the rule version; an empty ledger service is not required. Quotas declared by domain policy, such as side-effect counts, MUST still be checked.
- The ledger aggregates across tasks, rooms, and aliases by principal anchor; ownership transfer cannot clear old liabilities. Tests SHOULD cover concurrent contention for the last available limit, conservation of parent-child allocations, continued reservation for unknown outcomes, shared cumulative counters across ancestor tokens, and release of only liability-free balances at termination.


---

## 11. Registration and Reconciliation of Out-of-Protocol Side Effects

External actions (including reversible writes within a trust domain, tool/API calls, sending, escrow deposits, releases, and refunds) MUST first submit effect.register, then submit effect.update to transition to executing; external calls reuse a stable effect_id/external idempotency key. inform provides summaries only and cannot serve as the side-effect ledger. A logical action is bound to `(task_ref, logical_action, clause_version)`; retries and takeovers MUST NOT generate a second token.

| Current effect state | New state | Evidence and authority |
|---|---|---|
| — | registered | effect.register, currently valid action eligibility and authorization; if the same logical action is already registered, return the original record |
| registered | executing | Current epoch, token, approve (if required), and successful serializable consumption of quota/usage count |
| registered | failed | Confirmation that initiation has not occurred and that subsequent initiation has been blocked; no new execution eligibility is required |
| executing | completed | Trusted external success receipt; an unsupported self-report by the executor is not accepted as a basis for settlement |
| executing | failed | Confirmation that the action did not occur and cannot succeed later; otherwise, only unknown is permitted |
| executing | unknown | The outcome cannot be confirmed; the corresponding reservation remains held |
| unknown | completed/failed | Trusted reconciliation evidence; no new execution epoch is required, and no retry permission is granted |
| failed | executing | Confirmation that the action did not occur, acquisition of a new valid epoch, reuse of the original effect_id and external idempotency key, and renewed authorization consumption |

- Registration/transitions to executing validate current execution eligibility; closure registrations and reconciliation updates after a stop are signed by the party currently authorized to report/reconcile, validating the original effect_id, its association with the original epoch, and the evidence, without requiring restoration of revoked eligibility.
- Actions executed but not reported are backfilled through completed reconciliation; automatic retries are prohibited when reconciliation is impossible and the external operation is not idempotent, and a timeout triggers submission of sys.reconcile_timeout/mandatory escalate. Reconciliation of in-flight execution MUST NOT be abandoned even if the task has reached a terminal state.
- Permission consumption is the protocol boundary for “initiated”; a crash after consumption but before the actual call still requires conservative reconciliation, and exactly-once is not claimed. A stop report MUST reference the relevant effect records.
- All evidence, artifacts, and idempotency records follow the unified retention period in §5.5.


---

## 12. Instruction Provenance

Signatures and authority levels prevent "lower-authority actors impersonating higher-authority actors," but do not prevent "injection exploiting a higher-authority Agent's own legitimate identity to execute actions" (the confused deputy problem). Therefore, **all text entering an Agent's context MUST carry a source level**—

| Source Level | Definition | Effect |
|---|---|---|
| `principal` | A message from the principal itself generated by a legitimate producer under §13.7, or an authorization record traceable through the principal's capability token chain | The only permitted source of instructions |
| `peer` | Statements by other Agents / members, and any Agent's semantic inferences about human utterances | Data and proposals, not commands; content requesting high-risk actions takes effect only when traced back to principal authorization |
| `environment` | Artifact content, web pages, tool responses, file bodies | Always data; imperative sentences within it do not constitute instructions |

Source-level carriage and accountability:

- **Envelope carriage**: The source level is indicated by the envelope's `source_level` field; mixed-source content is labeled segment by segment in `payload.body_segments`. When relaying environment / peer content between Agents, Agents MUST faithfully preserve its source level—relay through an Agent does not constitute promotion.
- **Labels are claims, not proof**: A `principal` label MUST be verifiable through a signature and the producer evidence specified in §13.7; an unverifiable principal label is treated as forged. A verified discrepancy between a label and the actual source is recorded in the labeling party's objective track and reduces its reputation.
- **Implementation obligations**: When assembling context, Agents MUST mark partitions by source level and thread; environment / peer text MUST NOT be promoted into the instruction channel.

**Status and verification of `intent_origin`**:

- **intent_origin grants no permissions**. Execution authority derives solely from the capability token chain (§14.1); intent_origin serves audit presentation and "existence / consistency" checks.
- L3 messages MUST carry intent_origin, with `{id, content_hash}` at each hop, and it MUST fall within the sender's signature coverage (§7.4). Verification proceeds link by link: every message in the chain MUST be traceable to its own signature and content hash, and the chain head MUST be a principal message generated by a legitimate producer under §13.7, or an authorization record traceable through the principal's capability token chain; if any link fails verification, the signing gateway refuses to sign.
- **Authorization summary when resolution is unavailable**: If the auditor lacks permission to read the chain-head message or its content is encrypted, an **authorization summary** signed by the principal MUST be attached, binding the action, object, constraints, and original message hash, with its signature covering `{task_ref, target_event, exp}`; at execution time, the gateway checks that the summary has not expired and matches the current task_ref / target_event individually. A mismatch is treated as **invalid (accepted for processing but without effect)**, and execution is refused (preventing cross-task replay).
- **Dynamic objects** (such as "pay this invoice"): A **structured authorization record**, generated by a legitimate producer under §13.7 and signed by the principal, fixes the specific object or action hash; the gateway mechanically verifies that it is ⊆ the token scope. **A model's interpretation of natural language never creates authorization.**
- Approval interfaces and audits use this chain to show "who originally requested this action." For the form of the intent chain across trust domains, see §16 (gateway intent attestation credentials).

---

## 13. Human in the Loop

### 13.1 Approval

- **General rule**: Sensitive actions are first presented as L3 messages; `approve` is the sole execution authorization, is consumed atomically, is valid for one use, and MAY have an expiration time; emoji reactions do not carry security-critical decisions. **Attention budgets change only presentation, batching, and queuing, and MUST NOT reduce any approval requirements** (§13.6).
- **Per-action approval and standing authorization**:
  - **(c) Irreversible or difficult-to-reverse actions require per-action approve regardless of amount**; **(a) expenditures exceeding the large-amount threshold (§13.2) require per-action approve**; both MUST be `human-attested` and MUST NOT be covered by any standing authorization.
  - **(b) External sending** MUST NOT be covered by standing authorization in the core profile and requires per-action approve; only 〔Profile: Standing-Send〕 MAY permit standing authorization under the conditions of "a closed enumeration of recipients + restricted content templates + a revocation window." The token itself MUST be issued with human-attested confirmation, and this profile is excluded from core conformance.
  - **(d) Cross-domain delegation** requires per-action approve.
  - Other sensitive actions MAY be covered by a **standing authorization** (a capability token) issued by the principal: bounded by action type × object allowlist × per-action and cumulative amount limits × time window × revocation conditions × sampling rate. For each action authorized this way, the signing gateway records an `approve{mode: standing, token_id, action_hash}` in the thread, consumed atomically and valid for one use. Testable predicate: every action permitted without per-action approval MUST be traceable to a standing authorization valid at that time; sampling does not replace authorization before execution.
- **Approval object = displayed object = execution object**:
  - `approve` references the canonical hash of the approval object (§7.4); the execution endpoint rejects any mismatch and requires renewed approval to prevent artifact substitution after approval.
  - The **trusted, version-pinned schema** for each load-bearing payload kind declares the set of fields that MUST be rendered; approval requests MUST NOT remove fields from that set. Any field affecting the target of side effects outside the protocol (recipients, CC recipients, URLs/callbacks, accounts, default tool targets) MUST be included in that set; undeclared fields are handled under §9.3.
  - The approval hash and display MUST cover **the actual execution object and its constraints**: default-value population, alias or group expansion, redirects, and tool adaptation results that affect the target, content, cost, or authorization MUST be incorporated into that object or explicitly approved constraints; exceeding those constraints MUST trigger renewed authorization checks and approval before side effects are initiated.
  - The approval interface and execution gateway MUST use the same schema version; approval requests are executed using the version locked at rendering time. Switching to another version MUST require re-rendering and renewed approval.
- **Risk fields**: Approval requests MUST carry structured risk fields (`aimp.approval-request@1`), rendered by the client in a uniform, fixed layout that the requester's body text MUST NOT override or downplay: action type, target, amount, and **irreversibility** (with the enumeration fixed as `reversible` / `costly-reversible` / `irreversible`).
- **Step-up authentication**: Irreversible / large-amount actions use step-up authentication: secondary confirmation, a delayed-effect window, and optional two-person approval; specific requirements are defined by risk profile, and high-risk requirements are not waived based on enterprise size.
- **Approval queue**: Default concurrency is 5. Items not yet presented retain queue metadata; approval requests with an absolute exp are generated/refreshed only immediately before first presentation; an already signed exp cannot be paused. Expired objects are explicitly marked, retain their queue positions, and are regenerated without requiring humans to initiate them again; previous confirmations are not automatically renewed. Each item in a batch has an independent hash/expiration, but the confirmed set is not rewritten unilaterally.
- Conformance tests: Approval requests containing hidden target fields MUST be rejected; execution of an approval across schema versions MUST be rejected.

### 13.2 Proof of Human Presence

Envelope signatures distinguish three levels: `human-attested` (hardware-bound confirmation: a key protected by a device security chip / unlocked through biometrics, isolated from the Agent runtime and inaccessible to the Agent) / `human-account` (authenticated login session) / `agent-on-behalf` (sent by an Agent on behalf of a human). Ordinary approve MAY be completed through an authenticated login session; irreversible / large-amount actions require human-attested. All messages sent on behalf of a human by an Agent running in its owner's environment are marked agent-on-behalf and MUST NOT impersonate human-attested.

The "large-amount" threshold is the minimum of the following three values: the contractual authority boundary in the Agent's card (§5.3), the presence-attestation threshold set by the principal in domain policy, and the value agreed in the session contract; it **MUST NOT exceed the per-action authorization limit corresponding to that principal's signature level**. If none of the three is set, any expenditure is treated as a large-amount action.

### 13.3 Interruption and Redirection

Direct messages from humans take priority over group messages and background work and can redirect the current task at any time; this priority rule is a protocol conformance requirement, not a matter of product discretion. If redirection changes the scope, budget, deadline, or acceptance criteria, it MUST go through a new sequenced change event and obtain the required consent (§15.3).

### 13.4 Draft by Default

Content sent externally on behalf of a human is, by default, first returned to the delegator's thread as `deliver{draft:true}` and actually sent only after `approve`. `deliver{draft:true}` is an **approval-object registration event** in the registry (an authorization event): it only records the draft and version as the object bound to an approval-request, and **does not transition commitment state, start the acceptance timer, enter delivered, or establish settlement eligibility**. Action offset: combine the draft and approval into a single "preview and authorize" operation.

### 13.5 Tiered Visibility, Independent Receipts, and Activation

Private negotiations MAY proceed without pushing notifications to humans, but their full text is logged and accessible according to permissions. The activation gate is **durable recording of notification**, not human approval: pending stores only a candidate, creates no performance obligation or additional exposure for any party, and MUST NOT produce external effects.

1. The principal specifies a receipt endpoint in the contract. If the first accept is not confirmed by the principal through a legitimate producer under §13.7, and that endpoint has no notification record for this commitment, it enters pending_activation. Subtasks are evaluated independently and do not automatically inherit parent activation; a bounded standard exemption template MAY be signed once (a closed subset of the budget, no §9.2, no new entrustment); an unsigned template does not constitute consent.
2. An Agent delegator MAY have its principal designate the Agent's own thread as the endpoint once, or inherit a signed domain policy, without adding a human action. The endpoint sequencer's identity is fixed in the contract, and the principal signs an independence declaration stating that it is not controlled by the executing party being activated; if the declaration is absent or the identities are identical, the endpoint falls back to the principal's endpoint. The fallback MUST also satisfy the conditions; otherwise, the task remains pending. A sequencing service governed by a public domain is not automatically deemed controlled by the executing party merely because it is in the same domain; the declaration is a trust-root commitment, not cryptographic proof of actual independence. If the declaration is found to be false, the receipt evidence fails to satisfy the activation conditions, MUST NOT be used for activation, and is handled as attributable evidence. The fallback endpoint MUST also satisfy the independence conditions.
3. A receipt is an independent control object `control_ref`, not a rewriting of the source task_ref in another thread. The endpoint submits aimp.receipt-ack, immutably bound to the source accept intent hash, task_ref, terms hash, receiving party, contract version, and validity period. Receipts MAY be submitted automatically; they do not mean that a human has read or consented, nor do they replace tokens, epoch, or approve.
4. After verifying issuance authority, signature, time, and matching against the current pending candidate/terms/contract version and hashes, the source sequencer submits sys.activated; quota reservation and the entry into force of obligations occur in the same serializable commit. Insufficient quota returns rejected{quota_insufficient} and triggers escalation based on that evidence; **the proof is not consumed**. Within the activation time limit, a new request uses a new event id, reuses the unconsumed proof, and revalidates the preconditions; it does not automatically retry in a loop.
5. The contract locks the concurrent pending limit (default: 20 per principal) and activation time limit (default: the earlier of 24 hours and deadline); candidates exceeding the limit are invalid. On timeout, sys.activation_timeout→expired; late proof does not revive the task. Resubmission of the same successful activation returns the original acknowledgment. Pending status does not entitle the executing party to claim performance payments from the delegator; preparation costs are handled according to prior valid authorization and internal agreements, and unauthorized execution creates no additional obligations for the delegator.
6. Activated tasks do not undergo activation again; changes to terms still follow task.amend. If a receipt conflicts with the source chain, the authoritative source chain prevails, and the correction is entered into the receiving log; receipts do not change the original thread binding. If the principal requires a human right of rejection, the contract MUST explicitly specify the events/time limits, rather than implicitly treating automatic notification as human approval.

### 13.6 Attention Budget

Each delegator has a daily limit on "messages requiring action," `attention_budget`: **default: 20 messages/day** (domain policy MAY adjust this within the range of 5–100). Protocol behavior when the limit is exceeded is deterministic: non-urgent items are consolidated into summary batches, similar approvals are presented in batches, non-urgent items are deferred until outside the do-not-disturb window, and only forced stop and mandatory escalate are allowed to break through during the do-not-disturb window.

- **Budgets do not expand authority**: Exceeding the limit changes only presentation and queuing; it does not trigger automatic authorization or expand the scope of standing authorizations. Actions covered by a standing authorization already require no per-action approval, regardless of whether the budget is exceeded.
- **Standing authorization and sampling**: The risk classification table and amount thresholds for standing authorizations are set and published by the principal; absent an issued standing authorization, no approval is waived by default. All actions permitted under standing authorizations are logged, with a default retrospective sampling rate of at least 10%; if sampling finds an improper authorization, the authorization is immediately tightened and the violation is recorded in the objective track.
- **Action offsets**: Step-up authentication is offset by presenting similar items in batches, draft-by-default by "preview and authorize," and standing authorization by sampling—mechanisms that add human action points MUST specify their offsets in the relevant subsection using this pattern (§2, Principle 9).
- **Reportable metrics**: A task without ancestors uses its own task_ref as the root; a task with ancestors uses the first entry in lineage. An operation is attributed to the root task accounting for the largest share of its bound event set, with ties broken by lexicographic order of root id; each confirmation, secondary confirmation, and authentication is counted separately. Batching does not collapse multiple actual operations into one; batch counts are reported separately. Governance operations not bound to tasks are reported separately. Numerators and denominators use the same set of root tasks and statistical cutoff; accepted/settled denominators are deduplicated, and nonterminal tasks are reported separately. New mechanisms report their net impact, without using a uniform operation-count cap to reduce security confirmations.
- **clarify defaults**: `clarify{default}` MAY carry a default assumption and timeout; the default MAY be adopted automatically on timeout only if the principal has authorized it in advance and it introduces no new commitment or high-risk permission.

### 13.7 Structured Normalization of Human Utterances

For human natural language to have protocol effect (as a state event or authorization event), there are only two classes of legitimate producers:

1. Events generated by confirmation / approval controls directly operated by a human in a **trusted in-domain client** (signed as `human-account` or `human-attested`);
2. Human intent records **signed with the principal's key**.

- Products of semantic inference by an Agent or ingress Bot over human utterances are always marked `source_level: peer`: they MUST NOT enter the principal channel, MUST NOT serve as the head of an intent_origin chain, and MUST NOT cause a commitment to enter committed.
- Normalization results MUST be echoed to the human for confirmation (batching is permitted; one confirmation MAY submit multiple events, each authorized separately—protocol event count does not equal human operation count). **A single human confirmation MUST bind the hash of the ordered set of canonical hashes of that batch's events**; only events belonging to that set MAY enter the principal channel. Events outside the set MUST NOT be submitted even if they reuse the same confirmation receipt; confirmation receipts have a short validity period and MUST NOT be reused across sessions or threads.
- Conformance tests: An accept produced solely by Bot inference MUST NOT enter committed; submissions of events outside the set using a reused confirmation receipt MUST be rejected.

---

## 14. Security Model

### 14.1 Authorization: Capability Tokens

- **Sole source of execution authority**: All actions outside the protocol are checked against capability tokens issued by the principal. Core-L2 uses the root-token subset below; L3 uses the full chain. Permission to speak is verified separately against the role matrix; profile-card limits, session-key signatures, and activation do not constitute execution authorization. approve/structured authorization can only narrow authorization within the applicable token scope and cannot expand caveats.
- **Core-L2 root-token subset**: The principal directly issues a single-hop token with delegation_depth=0 and no further delegation; the complete token is embedded in capability_token.inline, requiring no resolution endpoint. It binds the principal anchor, holder public key, audience, task/session, validity period, revocation identifier, and resource/actions/caveats, and follows the same token model. Proof of possession is provided by signing the intent with the session key pair. The tool entry point verifies root issuance authority/signature, scope, current epoch, and freshness; only read/write/execute within the revocable domain are permitted, and §9.2 remains prohibited. Negotiation-only deployments MAY omit execution entry points/token issuance; inlining does not eliminate authorization or revocation checks.
- **Minimum interoperable token model** (fixed by the core specification; the encoding MAY be bound to macaroon or UCAN, both of which MUST map losslessly to this model; a trust domain SHOULD standardize on one encoding and declare it in profile cards, with gateways reissuing tokens across encodings):
  - Fields: issuer, principal anchor, holder public key, audience, task or session scope, validity period (`nbf` / `exp`), revocation identifier, parent token hash, caveat list, signature.
  - Initial closed action set: `read` / `write` / `execute` / `send` / `pay`, each bound to an object type; extension actions use the domain-name namespace in §8.5.
  - Resource patterns: URI prefix matching, with explicit prefix boundaries (segmented by `/`, without substring matching) and path normalization (rejecting `..`, encoding bypasses, and case ambiguities).
  - Caveat predicates include at least: `time<`, `amount<=` (including currency), `cumulative_amount<=`, `recipient∈`, `max_uses<=`, `delegation_depth<=`.
  - Scopes form a finite lattice of (resource patterns × actions × caveats); implementations MUST provide a mechanically decidable `is_subscope(a, b)`; high-risk scopes are granted by **object**, rather than by category (specific recipients, repositories, accounts).
- **Chain verification**: Verify issuance authority, attenuation, holder intent signatures, and from/audience/scope at every hop; proof of possession is required even for root tokens. At execution, atomically check cumulative/use limits across all ancestors, the task balance, and principal exposure; reject if any is insufficient. Ancestor cumulative usage cannot restart from a child copy.
- **Execution time**: Use the authoritative receipt time at submission; at actual execution, use the current time t with the contractually accepted error bound ε. nbf MUST satisfy t−ε≥nbf, and exp MUST satisfy t+ε<exp; the authorization digest must also be valid at execution, and execution cannot be allowed merely because it had not expired at the historical receipt time. If this cannot be proven, fail-closed and escalate with evidence.
- **Token resolution**: Core-L2 inline root tokens require no resolution endpoint; L3 references retrieve the complete chain from the issuer and verify the chain head. Both payload forms bind the current intent. A recomputable reference identifier alone cannot replace proof of possession or authorization.
- **Freshness and fail-closed**: Tokens, approvals, epoch, and revocation status (including key revocation) MUST be revalidated at execution time. Revocation and token status MUST have a verifiable **freshness bound** (fixed by the session contract, no more than 5 minutes by default and not beyond the token exp; resolution caches MUST NOT exceed this bound). If a gateway cannot obtain status satisfying this bound, it **fails closed**—rejecting execution and returning a mandatory escalate receipt; it MUST NOT allow execution on the basis that "no revocation has been received." The message itself MAY be treated as having L0 effect.
- **Last mile**: The tool side / MCP gateway MUST verify the token chain and current epoch, rather than trusting message text—otherwise authorization disappears in the last mile.
- **Cross-domain**: Cross-domain chains are verified against the explicit trust roots and gateway reissuance rules in §16, without verifying the original intra-domain chain.
- Authorization levels can map to an organization's existing permission hierarchy (higher action levels require higher envelope levels and stricter approval requirements).
- Test vectors include at least: valid attenuation passes, amplification fails, expiration fails, objects outside the allowlist fail, cumulative-limit violations fail, cross-domain chains without a trust root fail, missing proof of possession fails, insufficient freshness fails closed.

### 14.2 Signatures: Separating Signing Authority from the Model〔Profile: L3〕

In Agent scenarios, the signer is a model that can be persuaded; if private-key use is left to model decisions, a signature proves only that "the runtime sent it." Therefore:

- Private keys are held by an independent **signing gateway** (HSM / TEE); the model can only request signatures, and the gateway signs only after its deterministic policy engine verifies every item:
  1. Action ⊆ token scope, with proof-of-possession and freshness checks passed (§14.1);
  2. Every side-effect object in the payload ∈ the object set fixed by the token caveats, or ∈ the object / action hashes fixed by structured authorization signed by the principal (§12);
  3. Amount ≤ per-operation limit, and reservation in the shared quota ledger succeeds (§10.9);
  4. The current `execution_epoch` is valid (§10.2);
  5. Actions requiring per-operation approval have a matching, unconsumed approve (§13.1);
  6. intent_origin is verifiable link by link or accompanied by a matching authorization digest (§12)—this is a consistency condition, **not a source of authority**.
- **Liability rule**: See §5.4—a signature makes the owner liable; "the Agent was injected" does not independently constitute grounds for exemption (analogous to an organization's liability for employee signatures); enabling high-risk actions requires declaring a backstop mechanism.
- **Explicit residual risk**: A signing gateway can confine the blast radius of injection to the scope and object allowlist, but cannot reduce it to zero—misuse within the allowlist may still pass verification. The protocol's position is to make every boundary violation attributable, subject to limits, and revocable, rather than claiming that injection has been eradicated.

### 14.3 Anti-Spam: Sender Costs

The marginal cost of waking an Agent is far higher than that of sending a message. This structural asymmetry MUST be eliminated through pricing and hard gates, rather than borne through filtering. Core intra-domain requirements:

- **Per-principal quotas**: Identity is anchored to the principal anchor (§5.1); rate and wake-up quotas are counted per principal, not per instance.
- **Deterministic prefiltering**: The receiver's first gate MUST be a non-LLM hard gate (length, attachments, rate limits); LLM classification serves only as the second tier.
- **Global wake-up budget**: Stranger relationships are determined from principal anchors and the recipient's relationship table; changing instances/aliases does not reset them. Source-principal quotas, the room-wide hard cap, and the recipient-wide hard cap are enforced simultaneously; the fair-scheduling subpool for new principals is included within the overall hard cap, and admission through a small credit allowance does not exempt wake-ups from limits. Stranger wake-ups exceeding N per hour are queued, without using an LLM to judge each message; members who are not @-mentioned do not perform semantic reply-eligibility checks by default. Public task acceptance requires explicit enablement by the room and counts toward the total budget (§6).
- Default-deny and allowlists for `subscribe` serve only as presentation-layer supplements, not as a cost defense.
- **First-contact staking / proof of computation** belongs to〔Profile: Cross-Domain〕and is mandatory for cross-domain first contact and first contact with unfamiliar principals; see §16.1 for the rules. It is not a prerequisite for intra-domain communication.

### 14.4 Encryption, Metadata, and Isolation

- **Tiered encryption**: L0/L1 MAY use end-to-end encryption; at L2+, envelope headers are visible to the intra-domain platform for routing, metering, and auditing, while bodies and attachments MAY be encrypted. This tradeoff is explicit: some privacy is sacrificed for governability.
- **Visibility contract**: The schema for each load-bearing payload kind labels fields by category—**fields required for sequencing**, **fields required for authorization verification**, **fields displayed for approval**, and **encryptable business content**—and identifies their respective recipients. When required plaintext is unavailable, an independent trusted verifier MAY submit a verification attestation: the attestation MUST bind the event hash, verification result, schema and policy versions, relevant state versions, and validity period, and define the attester's identity and trust boundary. An attestation **MUST NOT replace** the display of required-rendering fields to approvers, nor may it replace token, approval, epoch, and revocation checks at execution time. Without the required plaintext or a trusted attestation, the event is stored as "pending verification" and grants no execution effect; exported logs MUST identify which conclusions can be independently reverified.
- **Collaboration graph protection**: Envelope headers themselves form a collaboration graph of "who assigned what work package to whom, and when," which is a protected asset.〔Profile: Pseudonym〕Sensitive rooms MAY use pairwise pseudonyms (participants mapped to aliases per room);〔Extension〕batched, delayed anchoring of state transitions MUST separately define what is verifiable in real time, disclosure deadlines, and consequences of nondisclosure, and MUST NOT inherit unconditional integrity guarantees. Plaintext is the intra-domain default (prioritizing domain-owner auditing); the pseudonym profile is enabled by default at cross-domain gateways.
- **Pseudonyms do not apply to principal anchors**: Pseudonyms affect only the presentation of participant identifiers; internally, the platform still aggregates reputation, exposure, quotas, and blocklists/allowlists by `principal_anchor`. Aliases MUST have a controlled mapping to principal anchors (invisible to members, visible to domain-owner auditing); **aliases MUST NOT serve as the attribution key for any of the above**.
- **Thread history and memory isolation**:
  - New members **cannot access prior history** by default (visibility begins at joining); access to prior history requires explicit, recorded authorization from the room owner. Messages MAY carry classification labels (`classification`); members with lower clearance see only redacted summaries.
  - **Structural layer (normative)**: Context is partitioned by source/thread, and cross-thread artifacts MUST be authorized; input/artifact content follows a uniform retention period and MAY remain with the original holder, who guarantees authorized retrieval, without requiring centralized public storage. Storing hashes alone does not satisfy provenance requirements; if content cannot be retrieved, dependent predicates are unverifiable and MUST NOT be treated as satisfied. Attributable causes of missing content are handled according to the evidence. Retention does not expand confidential visibility.
  - **Detection layer (non-normative, optional)**: Platforms MAY use cross-thread leakage detection methods such as canary probes (inserting a unique marker into thread A and monitoring whether it appears in thread B). If used: insertion is restricted to the domain-owner platform, and the mechanism's existence and purpose MUST be disclosed in domain policy (specific markers are not disclosed); a hit provides only evidence pending verification, triggering human review and temporary context isolation, and **does not directly reduce reputation**—whether cross-thread leakage occurred MUST be adjudicated through the dispute procedure before being recorded in the subjective track; falsely flagged parties have an appeal path. Detection methods do not claim completeness and are not core consistency requirements. If enabled, probes bind the protected source and permitted propagation scope; a single string match does not prove cross-thread leakage. Isolation is minimized and records its basis/affected tasks/review deadline, without independently changing task state; when safe continuation is impossible, suspension occurs through a registered event, with liability/extensions governed by the contract and no presumption of breach.

---

## 15. Downgrade Mechanisms

### 15.1 General Principles and Exhaustive List of Hard Failures

**Permissive reception, strict effect**: downgrades reduce effect and fidelity, never reachability. Protocol outcomes fall into three distinct categories that MUST NOT be conflated:

- **Rejection (hard failure)**: refuse execution, raise an alert, and record the event in the objective track; do not enter downgrade handling. **Limited to the following three cases; this list is exhaustive**:
  1. A signature is forged or signature verification fails (including when a verifier outside `audience` is required to verify the signature), and the message claims L2+ effect;
  2. A capability token is forged or token-chain verification fails, and the message claims L3 effect;
  3. A load-bearing structured block cannot be recognized (§9.3).
- **Invalid (accepted but without effect)**: the message remains reachable, readable, and recorded, and a machine-readable receipt is returned, but it changes no state and grants no execution permission. Examples include illegal transitions, loops and hop-limit violations (§10.2), expired signatures, events using old keys after revocation (§5.2), authorization digests that do not match the current task (§12), and events within a contract that fail to satisfy the conditions for effect (§15.4).
- **Downgrade**: when protocol capabilities do not match, lower the level under §15.2 and explicitly state the actual effective level in the receipt.

The consequences of forgery are "refuse execution + raise an alert + record in the objective track", not a connection-layer error; the message itself remains reachable and readable. L0–L3 (§9) define the sender's rules for raising levels; this section defines both parties' rules for lowering levels.

### 15.2 Eight Downgrade Axes

| Downgrade Axis | Trigger | Downgrade Path |
|---|---|---|
| Structural downgrade | The other party does not support L3/L2, or a non-load-bearing payload kind is unknown | Descend one level at a time along L3→L2→L1→L0, leaving the body unchanged; effect decreases with the level, and the receipt explicitly states the actual effective level |
| act downgrade | An unknown / unsupported act is received | Map to the nearest act using the standard mapping table: `delegate→request` (only before a commitment is established, and the receipt MUST state that child-chain derivation semantics have been lost), `escalate→request`+@human, all other unknown acts→`chat`; the mapping MUST be recorded in the receipt, and meaning MUST NOT be changed silently. **`review` and `counter` are not in the mapping table**: their entire semantics consist of adjudicative effect and abrogating effect, respectively, and neither has an equivalent downgrade target (§15.3) |
| Modality downgrade | The other party cannot process attachments / voice / rich cards | Artifact→summary+reference; voice→transcribed text; card→plain-text version in the body. Semantics are preserved; only the experience is reduced (the sender already has an obligation to make the body independently comprehensible) |
| Capability downgrade | The recipient lacks tools / permissions / data | Deliver partially and explicitly declare gaps (deliver with caveats; caveats only report gaps and do not automatically discharge obligations), split the work and delegate to capable members, or escalate; MUST NOT pretend completion or fail silently |
| Trust downgrade | No signature, an unverifiable signature, or insufficient reputation | Treat the message as having only L0 effect (it creates no commitment effect and drives no state transition), regardless of its claimed level; reachability and readability are unaffected. Conversely, when performing the same action for a party with low reputation, the required level MAY be raised dynamically (required level = f(action risk, other party's reputation)) |
| Cost downgrade | The budget is exhausted or approaching its limit | First reduce progress frequency and response length (summary mode), then lower the model tier, and only as a last resort pause and perform mandatory escalate to request additional budget; MUST NOT silently overrun the budget |
| Transport downgrade | The real-time channel is interrupted | Real-time→asynchronous store-and-forward; deduplicate messages by id, and allow late messages to be replayed (replay does not trigger side effects, §7.3); the session remains valid, and long-running tasks resume from checkpoints using the structured event chain (for freezing and restoring the sequencing authority, see §10.3) |
| Attention downgrade | Pending action messages on the human side exceed the attention budget | Consolidate summary notifications, batch similar approvals, and defer non-urgent items until outside the do-not-disturb window. **MUST NOT reduce any approval requirements** (§13.6). This saves human attention, not tokens |

**There are two types of downgrade receipts**: when both parties can sign, both parties MUST sign off on the downgrade receipt; a downgrade without such sign-off has no effect on the sender. When the other party cannot sign or its signature cannot be verified (precisely the scenarios where downgrading is most needed), the downgrade takes effect when the recipient explicitly states the actual effective level in a **unilateral declaration receipt**; if the sender continues sending after becoming aware of the declaration, it is deemed to have accepted that level. Reachability takes precedence over the form of sign-off.

### 15.3 Downgrade Boundaries: Protocol Capability Downgrades and Execution-Time Adjustments

- **Protocol capability downgrades** (the structural, act, modality, and trust axes) MUST occur only **before a commitment is established**; capability downgrades do not change the effect of tasks that have already entered the state machine.
- **Execution-time adjustments** (cost, transport, attention, and capability gaps after commitment establishment) are not termed "downgrades": adjustments to transport, presentation, or internal resources MUST NOT change locked obligations; **changes to scope, budget, deadlines, or acceptance criteria MUST be made through a new sequenced change event with the consent of the required parties**; cost gap → escalate, capability gap → deliver+caveats or split through delegate.
- **Infrastructure failures** (such as an unavailable signing gateway) MUST be supported by retained, verifiable evidence, and attribution of responsibility, exemption from liability, and deadline extensions MUST be determined under the locked contract; proof of failure does not automatically discharge existing obligations. Adjustments to deadlines or obligations MUST follow rules agreed in advance in the contract or a sequenced change event approved by the required parties (§10.3.1).
- **Mapping fidelity**: mappings that lose essential effect **MUST NOT be used**. `review→inform` loses adjudicative effect, and `counter→propose` loses the effect of "automatically abrogating the original proposal"; neither is in the standard mapping table: if the other party does not support `review`, escalation MUST occur, with handling by a channel that supports conveying adjudications or by a human; if the other party does not support `counter`, the sender MUST either explicitly use two steps (first `reject` the original proposal, then send a new `propose`, stating the association in the body) or escalate.

### 15.4 Messages Within a Contract That Fail to Satisfy the Conditions for Effect

The session contract (§5.5) locks the minimum level of effect for the session. Events sent for tasks that have already entered the state machine but fail to satisfy their conditions for effect (insufficient level, missing fields, missing signatures, etc.) are handled in the following **decision order**:

1. **Check for security violations first**: reject events that match the rejection list in §15.1;
2. **The event itself**: the event is **invalid (accepted but without effect)**, changes no state, and receives an explicit receipt; **existing obligations remain in force**;
3. **Determine breach separately**: adjudicate based on evidence of attribution, deadlines, and the contract—if the sender can satisfy the conditions but fails to do so (or deliberately uses a lower level to evade the contract), record this in its objective-track compliance statistics; repeated occurrences within the same session trigger renegotiation of the session contract or removal from the room. Messages without signatures or with unverifiable signatures **MUST NOT be used as grounds to penalize the impersonated party**; proof of failure serves only as evidence for attribution and deadline extensions. Exemption from liability MUST satisfy the conditions locked in advance under §15.3 and is not automatic;
4. **Downgrade negotiation**: if the lower level results from lack of support on the recipient's side or capability differences between the parties, and no commitment has yet been established, follow §15.2 and explicitly state the downgrade in the receipt; this does not constitute a breach.

---

## 16. Cross-Domain Gateways (Opaque Mode)〔Profile: Cross-Domain〕

Gateways are deployed at trust domain boundaries; all cross-domain collaboration is opaque:

- **Messages permitted through gateways fall into two categories**: first, status events and authorization events, together with their payloads; second, **structured equivalents of lifecycle events**—`clarify` / `escalate` / `dispute` / `approve` are translated by gateways into structured events for transmission out of the domain. Signatures are added as each side commits, and one side is permitted to remain incomplete: these events carry only the event type, thread mapping, relevant message hashes, and necessary parameters, **without any domain-internal body content**. All other domain-internal process messages (discussion, progress, observation) remain within the domain; details transmitted out of the domain are recorded as summaries + hashes, with selective disclosure by the domain owner under its own rules when an audit is required.
- Opacity serves multiple purposes: protection of trade secrets, separation of liability, data minimization, and attack surface control—it is the proper form of a boundary, rather than a defect relative to transparent mode.
- **Field pruning for cross-domain L3**: the original `intent_origin` chain remains within the domain. After verifying the original domain-internal chain (§12), the egress gateway instead issues an **intent attestation credential** to accompany the message out of the domain, with the following fields: source domain identifier, principal pseudonymous identifier, intent summary hash, authorization scope, `task_ref` mapping, issuance time, validity period, and gateway signature. The receiving domain verifies only the gateway signature and authorization scope; it neither verifies nor has the means to verify the original domain-internal chain. Responsibility for intent authenticity rests with the egress gateway and its domain. The same applies to capability tokens: cross-domain verification covers only inter-domain tokens reissued by the gateway (which MUST still satisfy the token model and proof-of-possession requirements in §14.1), not the original chain of domain-internal tokens. Cross-domain reputation exchange is limited to endorsement bits (§5.4), carried in gateway-signed endorsement credentials (endorsed subject pseudonym, endorsing domain, validity period, gateway signature).
- **Translation and evidence preservation**: translation generates a new message, preserves the original intent hash and mapping version, and does not modify the original signed object; source commitment, transmission, destination acceptance or rejection, and evidence completion are recorded separately, and retransmissions reuse a stable mapping ID. The evidence package contains the message hashes obtained, signatures/sequencing records from each side, and a migration summary. It is permitted to explicitly mark one side as incomplete; signatures from both sides are not required before transmission. Commitments by both sides do not guarantee atomicity; compensation following rejection MUST be independently authorized under the pre-locked contract. Once both sides have completed, verification of both signatures and migration MAY be replayed; evidence admissibility is fixed in the connection-establishment agreement.
- Cross-domain identity recognizes only "whether a domain endorses the subject"; cross-domain metering exchanges only gateway-issued receipts; cross-domain messages default to the pseudonym profile at the gateway (§14.4, with exposure still aggregated by subject anchor) and the full L3 requirements (§9.2, subject to the pruning rules in this section); every cross-domain delegation requires a separate approve (§13.1).

### 16.1 First-Contact Cost

The first message from a cross-domain subject or an unfamiliar subject MUST include a refundable stake or proof of work:

- **Escrow**: all stakes are placed in third-party escrow (§10.7); the recipient has no authority to control them directly and MUST NOT lock funds indefinitely.
- **Amount**: the stake amount MAY be adjusted according to the risk level of the party being activated, but MUST NOT directly expose the boundaries of that party's contracting authority; proof of work serves only as an alternative for subjects providing no deposit.
- **Refund**: the stake is refunded as soon as the other party emits any status event; a reply consisting only of `clarify` triggers neither an immediate refund nor forfeiture; if the other party does not respond within the agreed time limit, the stake is automatically refunded upon expiry.
- **Forfeiture**: forfeiture for messages classified as spam MUST be based on decidable predicates and undergo an adjudication procedure within the domain (a summary procedure MAY apply: the recipient provides evidence, and the sender has an appeal period), and MUST NOT be determined unilaterally by the recipient; in the event of erroneous forfeiture, twice the stake is returned, and the erroneous determination is recorded in the recipient's objective track.

---

## 17. Transport and Deployment

### 17.1 Transport Requirements

The transport layer carrying AIMP MUST provide: room and membership management, threaded messaging, reliable delivery and offline store-and-forward, and trace-preserving semantics for message edits/retractions. The event models of Matrix and XMPP map directly to these requirements; proprietary IM systems meeting these requirements MAY also be used.

Edits/retractions apply only to non-load-bearing messages; load-bearing messages become immutable once sequenced and effective (§10.4), and can only be reversed through new registry events. The transport layer MUST reject and record requests to edit/retract load-bearing messages.

### 17.2 Deployment Sequence

1. **Start within the domain**: Deploy and validate the core mechanisms (Agent-to-Agent messaging, envelopes, state machines, sequencing, and signatures) only within a controlled domain—this is the only environment in which the actual mechanisms can be validated.
2. **Use platforms only as entry points**: Existing IM platforms (Feishu, Yunzhijia, Slack, WeChat, etc.) serve by default only as human entry points and notification channels (human invocation, receipt of summary receipts, draft previews), rather than the primary channel for Agent collaboration; conditions for entry points to carry confirmations / approvals are specified in §17.5. Before adopting any platform as an entry point, each item in the following table MUST be checked and documented:

| Check Item | Classification | Description |
|---|---|---|
| Mutual Bot visibility and @mentions | **Core** | Whether Bots on the entry platform can see and @mention each other |
| Message editing and backlinks | **Core** | Whether edit trails and reference backlinks are available (prerequisites for the audit chain) |
| Permission to add Bots to groups | **Core** | Whether Bots can be added to groups containing humans |
| Platform-signed events and operator identity | Core (when carrying confirmations) | Whether card callbacks can prove the originating platform and the actual operator (§17.5) |
| Card capacity limits | Non-core | Affect approval card presentation, but not the validity of the mechanisms |
| Current platform policies | Non-core | Affect compliance and listing approval, but not the validity of the mechanisms |

   A platform missing any core item serves only as an entry point (human invocation and notifications) and MUST NOT carry Agent collaboration.
3. **Mandatory portability criteria** (enforced from the first day of deployment to prevent path dependence): identities are portable, threads are exportable and cryptographically verifiable, and profile cards are not tied to platform IDs; entry channels MUST use only portable components.
4. **Defer federation**: Allocate engineering resources to cross-domain federation and open interoperability only after an implementation outside the domain actively requests interoperability; until then, all cross-domain interactions go through the §16 gateway.

### 17.3 Minimal Governance Structure

- The authoritative event registry and act / payload kind registries are publicly accessible, with namespaces allocated according to domain-name ownership (§8.5);
- Semantic changes to the protected list (§8.5) MUST follow a public revision process;
- Compatibility claims MUST include a profile name and pass that profile's conformance tests (Appendix B);
- The protocol establishes no arbitration body: intra-domain disputes are adjudicated under the domain owner's rules, and cross-domain disputes revert to contractual channels (§1.3).

### 17.4 Profile Tiers and Conformance Claims

**Claim rules**: All compatibility claims MUST take the form "AIMP/<profile> compatible" and pass the tests in the corresponding column of Appendix B; an "AIMP compatible" claim without a profile name is invalid. When a full implementation participates in a session with a lower-profile implementation, it MUST follow the downgrade negotiation in §15 and MUST NOT refuse the session on the basis of the other party's profile; the lower-profile party MUST explicitly state its profile and capability boundaries in its profile card.

**AIMP/Core-L2 (AIMP Minimal, the target tier for the first implementation)**

- Levels: L0 and L2.
- Events: The C profile row in §8.2 (including task.amend, effect.register/update, governance scope, session/identity/receipt controls, and lease_renewed/action_epoch/review_timeout/owner_changed). Implementations that do not enable an external execution entry point MAY omit root-token issuance; those that enable one MUST fully validate root tokens. An L3 signing gateway is not required. State, eligibility, and effects each cover suspension/resumption/failure/termination paths.
- States follow §10.1. Core-L2 does not include in-protocol funds settlement; accepted is the terminal state for fulfillment (disputes and authorized closeout remain possible), rather than an absolute terminal state that destroys all records; settled is included only in profiles with settlement capabilities.
- Signatures: L2 signatures are mandatory and are applied directly using hour-scale session keys issued by the principal. They **prove only origin and integrity and do not constitute execution authorization**; a signing gateway is not required. This distinction MUST be declared in the profile card.
- Security components enabled from day one: side-effect registration (§11), instruction provenance and normalization (§12, §13.7), summary receipt activation thresholds (§13.5), sequenced commits and idempotency records (§7.3, §10.3)—low-cost components that cannot be retrofitted after the fact.
- **Capability boundaries**: Core-L2 **does not include an effective approve** and MUST NOT execute any category of action in §9.2 (funds expenditure, external sending, irreversible actions, cross-domain delegation); such requests MUST undergo mandatory escalate for human handling outside the protocol with a recorded trail, or be handed over to an L3 implementation. This boundary MUST be explicitly stated in the profile card.

**〔Optional〕Sandbox-Settlement**: Layered on Core-L2, it uses a platform sandbox ledger to simulate escrow and settlement (involving no real funds and not constituting §9.2(a)), enabling exercises of accepted → settled, staged escrow, and post-settlement dispute compensation (§10.7, §10.8).

**AIMP/L3**: Introduces the following **as a complete package** on top of Core-L2: capability tokens (§14.1) + signing gateway (§14.2) + intent_origin (§12) + approval hash binding and mandatory rendering fields (§13.1) + attribution levels and step-up authentication (§13.2) + escrow and settlement (§10.7–§10.8) + fallback declarations (§5.4). **Indivisible**; a degraded L3 with "signatures + hashes only, no tokens" MUST NOT be used.

**AIMP/Full**: L3 + L1 + cross-domain gateway (§16).

**Other optional profiles**: Governance (reputation parameters and the subjective track, Appendix C), Standing-Send (§13.1), Bridge (§17.5), Pseudonym (§14.4), Sealed-Propose (§8.4), Display (subscribe / unsubscribe). Optional profiles do not count toward core compatibility, but claims for them MUST likewise pass the corresponding tests.

### 17.5 Enterprise IM Entry Bridge〔Profile: Bridge〕

- **Default**: Entry events do not produce approve effects or serve as the head of an intent_origin chain; all inferences by entry Bots from human utterances are classified as peer (§13.7).
- **Bridge authentication contract**: Only when an entry bridge simultaneously satisfies all of the following conditions can its confirmations produce `human-account`-level events, and only for actions that do not require human-attested:
  1. Verify the origin of platform-signed events;
  2. The actual operator = principal mapping is verifiable: **the "platform ID → principal identity root" binding MUST be established once by the principal through a human-attested procedure** (or established on the principal's behalf by the domain owner and then confirmed by the principal through a human-attested procedure); binding changes MUST be re-attested and recorded; **the bridge operator MUST NOT write the binding unilaterally**;
  3. Bind a one-time challenge to the hash of the approval object;
  4. Prevent forwarding and replay (the challenge is single-use and bound to the operator and session).
- **human-attested actions** MUST be completed through a challenge link in a trusted client within the domain.
- Do not infer capabilities from platform names; determine attribution levels from actual evidence.
- Conformance tests: forged / forwarded card receipts MUST NOT produce approve effects; mappings written unilaterally by the bridge operator MUST NOT produce any attribution effect.
- This profile does not block Core-L2.

### 17.6 A2A Adaptation Contract

The AIMP event chain is the sole source of truth for commitment states within the domain. When A2A is used as an invocation handle, the adaptation contract MUST bind the A2A invocation handle, task_ref, artifacts, and transition conditions:

| A2A Task State | Writeback to AIMP |
|---|---|
| Ordinary state changes (submitted / working, etc.) | `progress` (label, no effect) |
| completed | After delivery conditions are met and authorization checks pass, the executing party submits `deliver` (with artifacts); completion of internal steps only is written back as progress |
| input-required | `clarify` (request additional information from the delegating party) or `escalate` (human judgment required) |
| failed | `deliver` + caveats (partial delivery with declared gaps) or `escalate`, selected by the executing party according to the nature of the failure; **does not map directly to reject** |

A2A is only a source of execution observations; the executing party submits registered AIMP events in its own name. A2A has no authority to write state. The adapter's idempotency key includes the invocation handle, task_ref, stable callback identifier, and stage/artifact version. The same callback reuses the original id and returns the original receipt, without suppressing delivery of a new version resulting from rework. Sending unauthorized "state correction" write requests to A2A is not mandatory; reverse-direction display is read-only, and profile card/AgentCard mapping is optional.

### 17.7 Pilot Charter

The first deployment is not a "launch"; it is a pilot with defined boundaries, metrics, and exit conditions. If this charter cannot be signed, do not write the first line of code.

- **Scope**: Limited to one trust domain and one actual work group; no more than 5 participating Agents, with at least one delegation-chain scenario spanning Bots (delegate derives subtasks); human participants are limited to members of the domain owner's team. The pilot runs only **AIMP/Core-L2 + Sandbox-Settlement**; no cross-domain gateway is enabled; funds-related actions use the sandbox ledger without connecting to real funds; all §9.2 actions, including external sending, undergo escalate and are completed by humans outside the protocol.
- **Three metrics and acceptance thresholds** (checked individually at pilot acceptance):
  1. **Commitment-chain completeness rate**: Among L2 commitments during the pilot, the proportion whose state chains can be fully derived from the event chain and have no stuck states (entry into a nonterminal state followed by neither a subsequent transition nor timeout handling) is ≥ 95%;
  2. **Human action density**: Messages requiring action do not exceed the default `attention_budget` (20 messages/person-day, §13.6) and do not exceed the two-week pre-pilot baseline for the same group; also report the per-task distribution of human actions;
  3. **Dispute and failure exercises**: Complete at least 2 full-process `dispute` exercises (at least 1 covering compensation handling for a post-settled dispute, §10.8), at least 1 sequencer failover exercise, and at least 1 result_unknown reconciliation exercise following lease expiration, with successful verification of the event chain and preserved evidence.
- **Timebox**: The integration phase is gated by acceptance of the complete capabilities, rather than fixed at two weeks; the charter MUST set an integration time limit, after which the charter is revised rather than security components removed. The operating timebox after acceptance is 4 weeks; expiration automatically triggers acceptance review, without automatic renewal. Renewal MUST involve re-signing this charter and revising the metrics.
- **kill criteria**: If any of the following occurs during the pilot, immediately archive the pilot and conduct a retrospective:
  1. One incident in which a forged message, injected content, or Bot inference produces L2+ effects (including establishing a commitment, triggering settlement, or driving a state transition);
  2. One incident in which the same logical action is executed twice (double execution);
  3. Human action density exceeds the budget by 50% for 2 consecutive weeks, with no implemented mitigation;
  4. Data loss that makes a state chain impossible to derive and whose cause cannot be determined;
  5. Two or more of the three metrics fail to meet their thresholds at the end-of-term acceptance review.
- **Integration simplifications**: A single sequencer, daily signed checkpoints, and no third-party witnessing are permitted; security constraints are not removed. The takeover exercise checks both the logical effect_id and actual business effects: for idempotent external operations, evidence proves that key reuse produces only one effect; for non-idempotent operations with unknown outcomes, evidence MUST prove that no automatic retry occurred and escalation took place.
- **Archival handling**: After archival, stop further investment in the protocol form; the envelope and state-machine designs MAY be retained at a reduced scope as internal product event formats (internal formats produce no external compatibility claims). Retrospective conclusions are retained as the sole basis for deciding whether to restart the pilot.
- **Responsibility for compliance archiving**: Before the pilot starts, the domain owner MUST designate the party responsible for archiving and register a retention plan: the domain owner's platform is responsible for immutable archiving of the structured event chain, retention periods, and retrieval methods, integrated with the domain's existing recordkeeping/audit systems; the pilot MUST NOT start before archival registration is complete.

---

## 18. Complete Sequence Example

First demonstrate collaboration using **Core-L2, with all budget=none**; funding exercises or actual external sending use separate branches, and an L2 accept MUST NOT be covertly represented as an actual escrow deposit. The main room contract locks the roles, acceptance/objection deadlines, sequencer, tokens, and receipt receiver; the user has signed the Agent subtask receiver policy once, and the receiver is operated by a sequencing service governed by an independent domain.

| Step | Event / Object | Effective Facts |
|---|---|---|
| 1 | User chat; DataBot clarify in the pre-task portion of the conversation; user inform | Original wording: “Check retention, weekly report tomorrow morning”; clarify references the original message id/hash in the same thread and is recorded on-chain under pre-task permissions, without creating a task_ref or starting task timing |
| 2 | DataBot propose T1 (root) | budget=none; assignee=DataBot; locks requirements for traceable figures, three tiers of metric definitions broken down by channel, and “attribution accompanied by verifiable evidence”; acceptance party=ReviewBot |
| 3 | User accept T1 through the client | caveats reference only the locked evidence requirements and do not unilaterally add obligations; valid confirmation by the principal transitions directly to committed, without actual payment |
| 4 | sys.epoch T1 | Validates DataBot's root token and the responsible party, epoch=1→working; subsequent progress messages are heartbeats only |
| 5 | DataBot delegate T2 (child thread) | lineage=[T1/DataBot/hop0], excluding T2; input=csv@v3/attribution-draft@v1, budget=none; parent responsibility remains unchanged |
| 6 | ReportBot accept T2 | Atomic claiming enters pending_activation, as a candidate only; no external effects and no new principal exposure |
| 7 | Receiver aimp.receipt-ack (independent control_ref) | Permanently bound to the T2 accept/terms/contract hashes; durable recording of the notification does not require a human to have read it and does not replace approval |
| 8 | Source child thread sys.activated T2; sys.epoch T2 | Transitions to committed after verifying the proof, then validates ReportBot's root token and grants epoch1→working |
| 9 | ReportBot deliver T2 v1 | Revokes the performance epoch→delivered, starting the acceptance period |
| 10 | ReviewBot review{rework} T2 | References “4.1%” in v1, but the existing input value is 3.7% and evidence for the metric definition is absent, so the base predicates fail; rework is free of charge, and submission simultaneously grants a new epoch2 |
| 11 | ReportBot deliver T2 v2 | Provides retrievable source evidence for both metric definitions, making 3.7% for the full population/4.1% for new installations traceable; verification MUST NOT be evaded by changing only the body text |
| 12 | ReviewBot review{pass} T2 | Machine/base predicates and subjective criteria satisfied→accepted, revoking performance eligibility; the balance is released only after side-effect obligations have been discharged, and a summary is referenced back in the main thread |
| 13 | DataBot deliver T1; ReviewBot review{pass} | Root artifact consists of attribution and weekly report references→accepted; the main timeline displays only two task projections and does not create an additional ordering authority |
| 14 | Core-L2 encounters “Send to the operations group” | Does not execute and returns an evidence-backed mandatory escalate; the user sends outside the protocol and retains a record, with no valid approve or actual settlement |

**L3 sending branch**: After declaring L3 capabilities, step 14 instead registers a deliver{draft:true} approval object; the user issues approve for each action using human-account (human-attested for high-risk actions), specifying the sequencer/gateway audiences. DataBot requests a sys.action_epoch limited to that action; effect.register E1 and effect.update executing are recorded on-chain, and the executor revalidates the token/approval/time/revocation/quota before sending; a trusted platform receipt is recorded on-chain through effect.update completed, while inform provides only a summary. accepted does not re-enter general working; a mandatory stop can still freeze actions that have not been initiated.

**Funding branch**: When budget specifies an amount, direct accept or activation only reserves an internal allocation. An actual escrow deposit requires separate pay approval, a pay-specific epoch, and effect events; no general performance epoch is granted before receipt of a funds-arrival acknowledgment. After accepted, each escrow release also requires matching authorization and effect events; sys.settled occurs only after all trusted settlement receipts are complete. The sandbox branch is explicitly labeled Sandbox-Settlement and does not treat virtual amounts as real payment reputation. Internal parent-child allocations reduce the parent's available balance and increase the child's itemized allocation, while principal exposure is counted only once.

**Failure exercise**: A crash/stop/revocation after executing does not delete the effect or release its reservation. A successor first checks the original effect_id; if external idempotency is available, the key can be reused; if the outcome cannot be verified and the operation is not idempotent, it is not retried automatically. Expiration without activation does not permit revival; resubmission with a new application id is allowed only when pending failed without consuming the proof and the proof remains valid.


---

## Appendix A. Terminology

| Term | Meaning |
|---|---|
| trust domain | A set of participants sharing the same identity root, audit framework, and accountable entity |
| principal | The human or organizational entity that issues instructions and bears responsibility |
| subject anchor | The unique key to which reputation, exposure, quotas, and allowlists/blocklists are attributed (§5.1) |
| acting on behalf of another | An Agent acting in another party's name or under that party's authorized allowance (e.g., sending externally in a user's name or using another party's capability token) |
| task_ref | The identifier of a commitment instance and the sole unit of truth for commitment state (§10.2) |
| authoritative event registry | A registry listing all events that have protocol effect, together with their categories, authorization requirements, and transitions (§8.2) |
| load-bearing act | A state event that creates or extinguishes performance obligations: propose / counter / accept / reject / deliver / review / stop |
| load-bearing message | A message concerning state, authorization, timing, side effects, or registered control events: all such messages MUST be signed, sequenced, and incorporated into the chain; obligation-bearing acts are only a subset |
| sequencing authority / sequencing record | The thread's sole ordering and commit point; the signed record it attaches to each load-bearing message (§10.3–§10.4) |
| execution_epoch | A monotonically increasing identifier for execution eligibility, used to fence off previous executors (§10.2) |
| invalid (accepted for processing but without effect) | The message is deliverable, readable, and acknowledged, but does not change state or grant execution permission (§15.1) |
| effect-token | A registration identifier for side effects outside the protocol, used for reconciliation, deduplication, and takeover (§11) |
| standing authorization | A scope-limited token issued in advance by the principal that waives per-action approval (§13.1) |
| intent_origin | The chain of principal messages that triggered an action; used only for auditing and consistency checks, and grants no authority (§12) |
| authorization summary / structured authorization record | An authorization credential signed by the principal that fixes the action and its target (§12) |
| session contract | Session-level parameters fixed during the handshake and subject to versioned changes (§5.5) |
| summary receipt / activation threshold | A summary of a private-chat commitment sent back to the principal's thread; its authoritative commit is a prerequisite for the commitment to enter committed (§13.5) |
| shared quota ledger | The authoritative ledger that aggregates quota reservations and releases by subject anchor (§10.9) |
| escrow | A mechanism whereby a third party that is not a party to the transaction releases funds in stages according to rulings and state (§10.7) |
| intent attestation credential | An endorsement of intent issued by the egress gateway when crossing trust domains, replacing the original intent_origin chain (§16) |
| AIMP/Core-L2（AIMP Minimal） | The target profile for the initial implementation: L0+L2, without executing the actions in §9.2 (§17.4) |

## Appendix B. Conformance Requirements (by profile)

✔ = Required; ○ = Optional / scenario-dependent; — = Not applicable. Implementations MUST pass all test vectors in the corresponding column before claiming conformance to that profile.

| # | Requirement | Section | Core-L2 | L3 | Full |
|---|---|---|---|---|---|
| 1 | Required envelope fields; sender intent signature coverage; JCS canonicalization and byte-level test vectors | §7.2、§7.4 | ✔ | ✔ | ✔ |
| 2 | Two-layer signatures, serializable commits, terms and fencing, failure freezing and failover, sequencing liveness | §10.3、§10.4 | ✔ | ✔ | ✔ |
| 3 | Per-event registration, delegate/amend, lease/eligibility/effect/control logs; preliminary clarify; inferences have no effect | §8.2、§10.1 | ✔ | ✔ | ✔ |
| 4 | task_ref / target_event addressing; lineage, loop, revisit, and hop-count rules | §7.2、§10.2 | ✔ | ✔ | ✔ |
| 5 | Atomic claiming and not_selected receipts; execution_epoch; no reassignment upon lease expiry; result_unknown reconciliation | §10.1、§10.2 | ✔ | ✔ | ✔ |
| 6 | Separation of transport deduplication and protocol idempotency records; historical replay triggers no side effects | §7.3 | ✔ | ✔ | ✔ |
| 7 | Inclusion of effect events in the chain, valid transitions, continued reconciliation in terminal states, unchanged token upon crash takeover, and verification of both external paths | §11 | ✔ | ✔ | ✔ |
| 8 | Source-level partitioning; normalization of human utterances and binding of confirmation sets | §12、§13.7 | ✔ | ✔ | ✔ |
| 9 | Activation threshold for summary receipts | §13.5 | ✔ | ✔ | ✔ |
| 10 | Session contract contents and versioned changes | §5.5 | ✔ | ✔ | ✔ |
| 11 | Shared budget ledger and atomic reservations | §10.9 | ✔ (when budget is not none) | ✔ | ✔ |
| 12 | Three-way classification of returns for revision, recusal in disputes, and handling of adjudication timeouts | §10.5 | ✔ | ✔ | ✔ |
| 13 | Three layers: rejection / invalidity / degradation; degradation receipts; execution-time adjustment rules | §15 | ✔ | ✔ | ✔ |
| 14 | Key rotation, sequenced revocation events, and separation of credential roles | §5.2 | ✔ | ✔ | ✔ |
| 15 | Four action categories in §9.2: Core-L2 MUST refuse execution and perform mandatory escalation; L3 and above MUST satisfy all L3 requirements | §9.2、§17.4 | ✔ (refusal) | ✔ | ✔ |
| 16 | Capability tokens, proof of possession, authorization verification, and freshness | §14.1 | ✔ when the execution entry point is enabled (inline root token) | ✔ (complete chain) | ✔ |
| 17 | Deterministic policy engine for the signing gateway | §14.2 | — | ✔ | ✔ |
| 18 | Approval object = displayed object = execution object; fields that MUST be rendered; standing authorization; atomic consumption | §13.1 | — | ✔ | ✔ |
| 19 | Attribution tiers, high-value thresholds, and step-up authentication | §13.2 | — | ✔ | ✔ |
| 20 | Escrow, settlement, and post-settlement compensation | §10.7、§10.8 | ○ (Sandbox-Settlement) | ✔ | ✔ |
| 21 | Per-link verification of intent_origin; authorization digest binding to task_ref / target_event / exp | §12 | — | ✔ | ✔ |
| 22 | Fallback declaration | §5.4 | — | ✔ | ✔ |
| 23 | Cross-domain gateway: lifecycle event translation, intent attestation credentials, inter-domain tokens, evidence packages, first-contact cost | §16 | — | — | ✔ |
| 24 | Ingress bridge authentication contract | §17.5 | ○ (Bridge) | ○ (Bridge) | ○ (Bridge) |
| 25 | A2A adaptation contract | §17.6 | ○ (✔ when using A2A) | ○ | ○ |
| 26 | Conformance claims include the profile name; profile and capability boundaries declared in the agent card | §17.4、§5.3 | ✔ | ✔ | ✔ |

Test vectors cover at least: canonicalization and signature bytes; only one concurrent accept succeeds, with the losing party's reputation unchanged; the execution gateway rejects the old epoch after lease expiry; the same id with a different intent produces a conflict; a Bot-inferred accept MUST NOT become committed; submission of an event outside the confirmed set using a reused confirmation receipt is rejected; approval requests containing hidden object fields are rejected; approvals across schema versions are rejected; token amplification / expiry / missing proof of possession / insufficient freshness are rejected; only one concurrent attempt to reserve the last available budget succeeds; aggregate exposure of the same principal across pseudonymous rooms remains within the limit; forged or forwarded ingress card receipts have no approve effect.


### B.1 Reproducible Signature Vectors and Scope

The following tests use a public test seed from RFC 8032 solely for verification; it MUST NOT under any circumstances be used for real principals or authorizations. Input id values are simplified test values, not examples of production random id generation. The original envelopes, projections, hex, public keys, and signatures are all stored in the accompanying JSON; the script supports the floating-point-free JCS safe-integer subset used by this set and tests UTF-16 key ordering and duplicate-key rejection. It does not claim full JCS conformance or full profile conformance.

Run `python3 verify_v31_vectors.py` in the review directory adjacent to this directory to reproduce the verification; Python cryptography is required. `--generate` generates deterministic results using the same public seed. The accompanying JSON Schema defines four types of signature projection objects; it provides no proof of state-machine behavior, governance trust, or product interactions.

### B.1.1 intent

Canonical UTF-8 input:
```json
{"act":"propose","aimp":"1.0","audience":["domain:relay.example@1"],"body_hash":"79ab994c5290c663af2b065d6cffa078015f5d6819d7fd74e36a06630199daee","classification":"internal","exp":"2026-11-07T06:05:00Z","from":"human://relay.example/test","id":"msg_vector_01","key_id":"rfc8032-public-test-key","payload_hash":"d7450d895a2ed062e290d78a764e2d64874a80584813356589e8b17697f476f8","room_id":"room_vector_01","source_level":"principal","target_event":null,"task_ref":"task_vector_01","thread_id":"thr_vector_01","to":["agent://relay.example/test-bot"]}
```

- domain_hex: `41494d502f312f696e74656e7400`
- canonical_hex: `7b22616374223a2270726f706f7365222c2261696d70223a22312e30222c2261756469656e6365223a5b22646f6d61696e3a72656c61792e6578616d706c654031225d2c22626f64795f68617368223a2237396162393934633532393063363633616632623036356436636666613037383031356635643638313964376664373465333661303636333031393964616565222c22636c617373696669636174696f6e223a22696e7465726e616c222c22657870223a22323032362d31312d30375430363a30353a30305a222c2266726f6d223a2268756d616e3a2f2f72656c61792e6578616d706c652f74657374222c226964223a226d73675f766563746f725f3031222c226b65795f6964223a22726663383033322d7075626c69632d746573742d6b6579222c227061796c6f61645f68617368223a2264373435306438393561326564303632653239306437386137363465326436343837346138303538343831333335363538396538623137363937663437366638222c22726f6f6d5f6964223a22726f6f6d5f766563746f725f3031222c22736f757263655f6c6576656c223a227072696e636970616c222c227461726765745f6576656e74223a6e756c6c2c227461736b5f726566223a227461736b5f766563746f725f3031222c227468726561645f6964223a227468725f766563746f725f3031222c22746f223a5b226167656e743a2f2f72656c61792e6578616d706c652f746573742d626f74225d7d`
- Signature input SHA-256: `1cf0aed617f11438fc0fe34c93624e309e7bdf2c9ea2661ad40c9171b5dd4a35`
- Public key: `d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a`
- Ed25519 signature: `f4237fd503c1f070531e50e78b9feaa99bbbbf7a2f4beaee782233ef5a4efb62c29bb7218a2a6febfec254fc2ce219289e5bce86fe1a4b668cac82f7f86db30d`
- Expected: original bytes pass; replaced body, incorrect domain, or appended bytes fail.

### B.1.2 record

Canonical UTF-8 input:
```json
{"intent_hash":"1cf0aed617f11438fc0fe34c93624e309e7bdf2c9ea2661ad40c9171b5dd4a35","prev_hash":"0000000000000000000000000000000000000000000000000000000000000000","recorded_at":"2026-11-07T06:00:01Z","sender_sig":"f4237fd503c1f070531e50e78b9feaa99bbbbf7a2f4beaee782233ef5a4efb62c29bb7218a2a6febfec254fc2ce219289e5bce86fe1a4b668cac82f7f86db30d","seq":1,"term":1,"verdict":"sequenced"}
```

- domain_hex: `41494d502f312f7265636f726400`
- canonical_hex: `7b22696e74656e745f68617368223a2231636630616564363137663131343338666330666533346339333632346533303965376264663263396561323636316164343063393137316235646434613335222c22707265765f68617368223a2230303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030222c227265636f726465645f6174223a22323032362d31312d30375430363a30303a30315a222c2273656e6465725f736967223a226634323337666435303363316630373035333165353065373862396665616139396262626266376132663462656165653738323233336566356134656662363263323962623732313861326136666562666563323534666332636532313932383965356263653836666531613462363638636163383266376638366462333064222c22736571223a312c227465726d223a312c2276657264696374223a2273657175656e636564227d`
- Signature input SHA-256: `423e80084ea300e6514e057a80dbd9ccfd2fa553276ff36057dd107997220173`
- Public key: `d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a`
- Ed25519 signature: `aa1351ec50720142e7b43c6e95f1dbe6e7d3fd4daf107b04c7af8a06f36c852ae79d3337c99f4792d11ccb1c3c3adab5919b4f4541d36de14ca4af973e2a2c0d`
- Expected: original bytes pass; replaced body, incorrect domain, or appended bytes fail.

### B.1.3 system

Canonical UTF-8 input:
```json
{"act":"sys.timeout","id":"sys_vector_01","key_id":"rfc8032-public-test-key","payload":{"kind":"sys.timeout@1","must_understand":true,"reason":"proposal_expired"},"source_level":"peer","target_event":{"hash":"1cf0aed617f11438fc0fe34c93624e309e7bdf2c9ea2661ad40c9171b5dd4a35","id":"msg_vector_01"},"task_ref":"task_vector_01","thread_id":"thr_vector_01"}
```

- domain_hex: `41494d502f312f73797374656d00`
- canonical_hex: `7b22616374223a227379732e74696d656f7574222c226964223a227379735f766563746f725f3031222c226b65795f6964223a22726663383033322d7075626c69632d746573742d6b6579222c227061796c6f6164223a7b226b696e64223a227379732e74696d656f75744031222c226d7573745f756e6465727374616e64223a747275652c22726561736f6e223a2270726f706f73616c5f65787069726564227d2c22736f757263655f6c6576656c223a2270656572222c227461726765745f6576656e74223a7b2268617368223a2231636630616564363137663131343338666330666533346339333632346533303965376264663263396561323636316164343063393137316235646434613335222c226964223a226d73675f766563746f725f3031227d2c227461736b5f726566223a227461736b5f766563746f725f3031222c227468726561645f6964223a227468725f766563746f725f3031227d`
- Signature input SHA-256: `7b256cba093c78bf3cd5419c9b8a36edc2cc07368c262df69beb988828a90d07`
- Public key: `d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a`
- Ed25519 signature: `774edd4f07c778b35f0d11b80836104bc088c57806550007689e3654b35141617d3af0d6710c63ab4a46b67b0d6ed577e20e90ff88ecd617f673128fa80bf20e`
- Expected: original bytes pass; replaced body, incorrect domain, or appended bytes fail.

### B.1.4 approval

Canonical UTF-8 input:
```json
{"action_type":"send","amount":"none","artifacts":[],"constraints":{"redirects":false},"irreversibility":"costly-reversible","payload":{"content":"测试正文","subject":"草稿"},"schema_version":"action.send@1","target":["human://relay.example/receiver"],"task_ref":"task_vector_01"}
```

- domain_hex: `41494d502f312f617070726f76616c00`
- canonical_hex: `7b22616374696f6e5f74797065223a2273656e64222c22616d6f756e74223a226e6f6e65222c22617274696661637473223a5b5d2c22636f6e73747261696e7473223a7b22726564697265637473223a66616c73657d2c2269727265766572736962696c697479223a22636f73746c792d72657665727369626c65222c227061796c6f6164223a7b22636f6e74656e74223a22e6b58be8af95e6ada3e69687222c227375626a656374223a22e88d89e7a8bf227d2c22736368656d615f76657273696f6e223a22616374696f6e2e73656e644031222c22746172676574223a5b2268756d616e3a2f2f72656c61792e6578616d706c652f7265636569766572225d2c227461736b5f726566223a227461736b5f766563746f725f3031227d`
- Signature input SHA-256: `3891bb049f9683225da8531472d080560d53504f2cb786ba227680c13c271be8`
- Public key: `d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a`
- Ed25519 signature: `f53b49dbfbf599a453c12402ce8b9995887d5a67e351d7b56343385e3d129138e829f62172ac0290115eefa15e2681f21f2b07db0a86e929a07aad7dcc481803`
- Expected: original bytes pass; replaced body, incorrect domain, or appended bytes fail.

## Appendix C. 〔Profile: Governance〕Reference Reputation Criteria

The following are reference criteria. Domain policy sets and publishes parameters within the specified ranges; implementations claiming the Governance profile MUST provide a risk model demonstrating that, under the selected parameters, the expected net gain from malicious default in the deposit-backed segment is non-positive.

- **Per-transaction weight**: w = settlement amount × independence coefficient. The independence coefficient is 1 when the counterparty and the entity have no common owner and no bidirectional settlement cycle has existed between them within the past 90 days; where an affiliation exists, it decreases with the strength of the affiliation, down to 0.1; self-loop transactions have a coefficient of 0.
- **Credit limit**: The cap on total outstanding in-flight exposure = min(deposit balance × k1, cumulative historical genuine settlement amount × k2) + guarantee limit + entry allowance B; reference ranges are k1 ∈ [0.5, 2] and k2 ∈ [0.1, 0.5]. A separate per-transaction cap MAY be set, but does not replace the aggregate constraint (§10.9).
- **Entry channel**: New entities receive a small entry allowance B (set by domain policy), or obtain a guarantor's endorsement, with the principal explicitly opting for a small trial order.
- **Subjective track**: Data may be included only after adjudication through the dispute procedure; this profile defines the dispute stake amount, the enforcing party, and deduction rules. Penalties for false accusations MUST be capped and limited to cases with explicit machine-decidable predicates (§10.5).
- **Insurance**: One form of the backstop declaration in §5.4; this profile defines the specific requirements.
- Other details of score aggregation are left to implementation within the domain, but inputs may come only from escrow settlement records and dual-track statistics; self-reported data MUST NOT be introduced.

## Appendix D. v3.1 Revisions and Evidence Boundaries

v3.1 retains the effective enhancements from v2→v3 and incorporates revisions based on v3 review decisions D01–D39 and final confirmation, without overwriting earlier drafts. Supporting files for independent reviews, cross-examination, voting rounds, and signatures are located in `AIMP协议设计规范v3-评审-20261107/`. The three parties accepted the revision resolutions; this document and its supporting procedures are implemented by the facilitator and are not represented as having been signed word for word by all three parties or as constituting complete product certification.

| Resolution | Specification Location |
|---|---|
| D01–D03 | §8.2 per-event registration, task.amend, delegate/lineage/parent-child budgets, separate lease events, initial-work/rework eligibility |
| D04–D07 | §10.1/10.2 state classification and independent discharge of side-effect obligations; effect inclusion in the chain; fixed binding of each thread to a single authority; complete prefix for takeover |
| D08–D09 | §7.4/7.5 and Appendix B actual signature projections, domain separation, prerequisite idempotency, non-finality of pending |
| D10–D13 | §13.5 separate control log for activation; §10.7 separate authorization for actual escrow placement; §14.1 root-token subset; role/stop provenance |
| D14–D18 | Mandatory escalation evidence, caveats do not expand obligations, acceptance timeouts/rework objections, atomic validation of cumulative ancestor totals and principal exposure |
| D19–D24 | Separation of economic reputation and the objective track; separation of submission and execution times; attribution evidence; revocation deferral does not extend leases; retention-period/rotation model |
| D25–D30 | Probe availability boundaries; pilots retain safety components and start according to capabilities; two succession drills; terminology/none/approval queuing |
| D31–D36 | A2A stage idempotency; audience identifies the exact consumer; unfamiliar principals and the aggregate cap; cross-domain failures; counting actual human operations; trust-root acceptance prerequisites |
| D37–D39 | Permissions/message binding in the initial clarify phase; atomic effectiveness of ownership transfers and finalization of the old anchor; retention of inputs/artifacts themselves |

Public Presence still uses three buckets; activation exemptions MUST be governed by a policy signed in advance, and failure to make a selection MUST NOT be treated as consent; relocate is not implemented, and an Owner transfer MUST NOT unilaterally alter existing responsibilities. The four categories of real Ed25519 vectors validate signature bytes; complete state, security, and product behavior still require validation through scenario implementations. Document approval or model consensus MUST NOT substitute for implementation testing.


**Open questions requiring pilot validation**: the values of K and `T_order` for ordering liveness; the suitability of default lease durations; the sampling rate for standing-authorization audits; Governance profile parameter ranges; whether ingress bridges on specific platforms (Feishu, Yunzhijia) can satisfy the bridge authentication contract.
