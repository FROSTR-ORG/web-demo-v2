# Runtime Deviations from Paper Design

This file enumerates intentional deviations from `igloo-paper` design caused by protocol
or architectural constraints. Each entry cites the Paper source, the web-demo-v2 implementation,
and the validation assertion IDs that cover it.

## Deviations

### ECDH round-trip — responder side does not emit `CompletedOperation::Ecdh`

- **Paper / task source**: `fix-m1-ecdh-roundtrip-spec-real-dispatch` feature description
  (`features.json`) — "runtimeCompletions on page A contains an entry with type='ecdh' and the
  captured request_id; page B also observes an Ecdh completion correlated by the same request_id".
- **web-demo-v2 implementation**: `src/e2e/multi-device/ecdh-roundtrip.spec.ts`.
- **Protocol constraint**: Per `bifrost-rs/crates/bifrost-signer/src/lib.rs`,
  `CompletedOperation::Ecdh { request_id, shared_secret }` is only pushed by the **initiator**
  of an ECDH session (`initiate_ecdh` / its response-finalisation branch). The **responder**
  processes the `EcdhRequest`, creates its partial ECDH package via `ecdh_create_from_share`,
  and sends an `EcdhResponse` envelope back to the initiator — it does NOT itself finalize
  (`ecdh_finalize` only runs on the initiator once it has enough responses), does NOT cache
  the derived secret, and does NOT push an `Ecdh` completion. The protocol is intentionally
  asymmetric: only the initiator derives the shared secret on-chain.
- **What the spec asserts instead**: the initiator (page A) receives `CompletedOperation::Ecdh`
  with the captured `request_id` and a valid 32-byte `shared_secret_hex32`. The responder
  (page B) is validated by observing its `lifecycleEvents` drain at least one
  `InboundAccepted`-kind runtime event and its `runtimeStatus.peers[A].last_seen` advancing —
  both indirect proofs that B accepted and processed the inbound ECDH request. B never holds
  an `Ecdh` entry keyed by the request_id because the bifrost protocol does not produce one.
- **Assertion IDs covered**: VAL-OPS-009 (ECDH happy path surfaces a completion on the
  initiator). The task description's phrase "both pages" is reconciled here against the
  protocol — the responder's participation is an input to, not an output of,
  `CompletedOperation::Ecdh`.

### `nonce_pool_size` / `nonce_pool_threshold` surfaced via JS shim (VAL-OPS-024)

- **Paper / task source**: `fix-m1-ops-test-observability-hooks` feature description
  (`features.json`) — "nonce_pool_size and nonce_pool_threshold surfaced on
  runtime_status snapshots (or via window.__debug.noncePoolSnapshot if the WASM
  bridge cannot expose them directly — in which case document the shim in
  docs/runtime-deviations-from-paper.md with a VAL-OPS-024 reference)".
- **web-demo-v2 implementation**:
  `src/app/AppStateProvider.tsx` (`window.__debug.noncePoolSnapshot` getter
  installed by the dev-only test-observability effect).
- **Protocol / data constraint**: Neither
  `bifrost-rs/crates/bifrost-bridge-wasm/src/lib.rs::RuntimeStatusSummary`
  nor the `RuntimeReadiness` struct expose a dedicated `nonce_pool_size`
  or `nonce_pool_threshold` field — nonce accounting is per-peer inside
  `RuntimeSnapshotExport.state.nonce_pool.peers[*]`
  (`incoming_available` / `outgoing_available`). bifrost-rs is read-only
  reference material for this mission and must not be modified to add a
  runtime-status aggregate.
- **What the app exposes instead**: a dev-only getter at
  `window.__debug.noncePoolSnapshot` returns
  `{ nonce_pool_size, nonce_pool_threshold }` where:
    - `nonce_pool_size = sum(snapshot.state.nonce_pool.peers[*].outgoing_available)`
      — the total remaining outgoing-nonce budget across peers, a proxy
      for whether new signs can be dispatched.
    - `nonce_pool_threshold = snapshot.status.known_peers` — a conservative
      refill threshold pegged to one nonce per peer (the minimum needed
      for a threshold-1 round). The value is guaranteed numeric even if
      the WASM bridge has not produced a snapshot yet (falls back to
      `null` for the whole getter when no runtime is attached).
    - When `__iglooTestSimulateNonceDepletion({nonce_pool_size, nonce_pool_threshold})`
      is active, the getter returns the overridden numeric pair so
      validators can drive the "Syncing nonces" overlay to a known state.
  The shim is stripped from production (`import.meta.env.DEV` gated
  installer effect; `rg -i '__debug\.noncePoolSnapshot' dist/` → 0 matches).
- **Assertion IDs covered**: VAL-OPS-024 — the `Syncing nonces` /
  `Trigger Sync` overlay surfaces during refill. The overlay itself is
  driven by `isNoncePoolDepleted(status)`, which inspects
  `readiness.degraded_reasons` for a `/nonce/i` signal; the shim
  `window.__iglooTestSimulateNonceDepletion()` pushes that signal into a
  dev-only augmentation layer in the provider so the overlay renders
  end-to-end without requiring a real depleted pool.

### SigningFailedModal — no `peers_responded` / `round_id` peer-response ratio

- **Paper / task source**: `igloo-paper/screens/dashboard/.../SigningFailedModal` renders a
  three-field summary of the form `Round: r-0x<8> · Peers responded: <k>/<n> · Error: <text>`.
  The `<k>/<n>` peer-response ratio is a design-level affordance implying the signing round
  knows how many peers were expected vs. responded in time.
- **web-demo-v2 implementation**:
  `src/screens/DashboardScreen/modals/SigningFailedModal.tsx`
  (feature `fix-m1-signing-failed-modal-real-peer-response`).
- **Protocol / data constraint**: The bifrost WASM bridge failure payload (see
  `bifrost-rs/crates/bifrost-bridge-wasm/src/lib.rs` `OperationFailureJson`) exposes
  exactly five fields per failure — `request_id`, `op_type`, `code`
  (`timeout | invalid_locked_peer_response | peer_rejected`), `message`, and
  `failed_peer: Option<String>`. There is no `round_id`, no `peers_responded` count, and
  no `expected_peers` denominator emitted by the runtime. `bifrost-rs` is read-only
  reference material for this mission and must not be modified to add one.
- **What the app renders instead**: the modal shows `Round`, `Code`, and `Error` sourced
  verbatim from the real `OperationFailure` payload (`request_id` → `Round: r-<8>`;
  `code` → `Code`; `message` → `Error`). It ALSO renders a labelled `Peer responses`
  row on every failure shape — `Peer responses: <N> of <M>` when the runtime emits a
  `peers_responded` / `total_peers` pair on the enriched failure record, else the
  neutral fallback `Peer responses: not reported by runtime`. Under no circumstances
  is a hard-coded ratio (`1/2`, `0/N`, etc.) fabricated. When `failed_peer` is present
  it adds a `Failed peer: <shortHex>` row. The Retry button dispatches
  `handleRuntimeCommand({ type: "sign", message_hex_32 })` with the same message that
  produced the failure — resolved from the enriched
  `runtimeFailures[i].message_hex_32` attached at drain-time via the AppState's
  `pendingDispatchIndex`, falling back to `signDispatchLog[request_id]` only when the
  enrichment path did not capture a correlation (see feature
  `fix-m1-signing-failed-modal-peer-response-and-retry-correlation`). Dismiss still
  closes without dispatch. If the bifrost bridge later begins emitting a real
  peers-responded pair, the optional schema extension lives at
  `EnrichedOperationFailure` in `src/app/AppStateTypes.ts`; the rendering site in
  `buildFailureSummary` already consumes those fields.
- **Assertion IDs covered**: VAL-OPS-006 (SigningFailedModal populated from real failure
  payload with an always-labelled Peer responses line, not Paper placeholders); VAL-OPS-007
  (Retry correlates via enriched `message_hex_32` from `pendingDispatchIndex`).

### PolicyPromptModal — scoped (kind / domain) CTA variants not exposed (VAL-APPROVALS-013)

- **Paper / task source**: `igloo-paper/screens/dashboard/.../PolicyPromptModal` renders six
  decision CTAs when a peer denial surfaces: `Deny`, `Allow once`, `Always allow`, plus the
  scoped variants `Always for kind:<N>`, `Always deny for kind:<N>`, and
  `Always deny for <domain>`. The scoped buttons imply the signer can persist a policy
  override keyed on `(peer, event_kind)` or `(peer, domain)` granularity.
- **web-demo-v2 implementation**:
  `src/screens/DashboardScreen/modals/PolicyPromptModal.tsx` (feature
  `m2-reactive-policy-prompt-modal`).
- **Protocol / data constraint**: Per
  `bifrost-rs/crates/bifrost-bridge-wasm/src/lib.rs` (`RuntimeClient::setPolicyOverride`)
  and the underlying signer policy in `bifrost-rs/crates/bifrost-signer/src/policy.rs`, the
  exposed override surface accepts **only** peer-level granularity — a `(peer_pubkey, allow|deny)`
  tuple. There is no kind-scoped or domain-scoped override shape plumbed to the WASM bridge
  or to the signer policy struct. `bifrost-rs` is read-only reference material for this
  mission and must not be modified to add one.
- **What the app renders instead**: four peer-level decision buttons —
  `Allow once`, `Always allow`, `Deny`, `Always deny`. "Allow once" is tracked
  client-side in a session-scoped `sessionAllowOnceRef` set and automatically rolled back
  to the signer via `setPolicyOverride(peer, "deny")` on `lockProfile()` (VAL-APPROVALS-009),
  while `Always allow` / `Always deny` persist through the runtime's peer-level override.
  The scoped CTAs are deliberately NOT rendered: exposing them would silently route through
  the same peer-level write, violating the user's assumption that clicking
  `Always deny for kind:1` only denies kind:1. The `DENIED_VARIANTS` comment block inside
  the modal source links back to this entry.
- **Allow-once rollback target is `"deny"`, not `"unset"` (VAL-APPROVALS-009)**: the
  `lockProfile()` rollback loop in `src/app/AppStateProvider.tsx` writes
  `setPolicyOverride({ ..., value: "deny" })` for every tracked allow-once entry — NOT
  `value: "unset"`. The reason is that
  `bifrost_core::types::MethodPolicy::default()`
  (see `bifrost-rs/crates/bifrost-core/src/types.rs`, `impl Default for MethodPolicy`) is
  permissive: every method (`echo`, `ping`, `onboard`, `sign`, `ecdh`) defaults to `true`.
  The signer's `apply_override_value(default, Unset)` in
  `bifrost-rs/crates/bifrost-signer/src/lib.rs` collapses `Unset` back to that permissive
  default, so an `"unset"` rollback would silently auto-allow the next peer request on
  unlock — (a) defeating the user's intent in locking the profile, and (b) preventing
  the fresh `peer_denied` event that VAL-APPROVALS-009 requires after `lock + unlock +
  re-emit`. Rolling back to an explicit `"deny"` matches the pre-Allow-once state (the
  signer had denied the request before the user clicked Allow once) and guarantees the
  re-emitted request produces a fresh `peer_denied` event. Covered by
  `src/app/__tests__/allowOnceRollback.test.tsx`.
- **Assertion IDs covered**: VAL-APPROVALS-013 (peer-level override granularity documented);
  the four peer-level CTAs still satisfy VAL-APPROVALS-010 / VAL-APPROVALS-011 /
  VAL-APPROVALS-016 / VAL-APPROVALS-017 since they map 1:1 to the `{allow-once,
  allow-always, deny, deny-always}` union in `PolicyPromptDecision`.

### PolicyPromptModal — `peer_denied` enqueued from synthetic RuntimeEvent payload (VAL-APPROVALS-007)

- **Paper / task source**: `igloo-paper` treats `peer_denied` as a first-class runtime event
  that the UI observes on `lifecycleEvents`. The Paper contract implies the bifrost bridge
  emits `RuntimeEvent { kind: "peer_denied", payload: {...} }` whenever the signer's policy
  layer denies an inbound request.
- **web-demo-v2 implementation**:
  `src/screens/DashboardScreen/index.tsx` (lifecycleEvents observer that filters
  `kind === "peer_denied"` and routes the payload through `enqueuePeerDenial`) and
  `src/app/AppStateProvider.tsx` (FIFO queue + BroadcastChannel multi-tab sync).
- **Protocol / data constraint**: Per
  `bifrost-rs/crates/bifrost-signer/src/lib.rs` (lines ~1618, 1655, 1720, 1791 at time of
  writing), the `peer_denied` denial code is emitted ONLY as a `BridgePayload::Error` envelope
  back to the denying peer — it is not surfaced as a `RuntimeEvent` kind on the WASM bridge's
  public event stream. The event shape consumed by the UI is therefore synthetic: it is
  currently produced by the `runtimeSimulator` and by future wire-ups that translate a
  `BridgePayload::Error { code: "peer_denied", .. }` observation into a
  `RuntimeEvent { kind: "peer_denied", payload: { id, peer_pubkey, verb, denied_at, ... } }`.
  `bifrost-rs` is read-only reference material for this mission and must not be modified.
- **What the app assumes**: the `PeerDeniedEvent` schema defined in
  `src/app/AppStateTypes.ts` (`id`, `peer_pubkey`, `verb`, `denied_at`, optional
  `peer_label` / `ttl_ms` / `ttl_source` / `event_kind` / `content` / `domain` / `relay` /
  `target_pubkey`). The dashboard's lifecycleEvents observer discards entries without the
  three required fields — no synthetic fallback is constructed when the payload is
  incomplete. Each `id` is consumed exactly once per tab via
  `consumedPeerDenialIdsRef`, and cross-tab dedupe rides the
  `BroadcastChannel("igloo-policy-denials")` channel (VAL-APPROVALS-024).
- **Assertion IDs covered**: VAL-APPROVALS-007 (modal opens reactively when a `peer_denied`
  event is enqueued); VAL-APPROVALS-018 (FIFO ordering); VAL-APPROVALS-024 (multi-tab
  resolution sync). If bifrost-rs later begins emitting `peer_denied` as a first-class
  `RuntimeEvent`, the observer continues to match its `kind` string without code change.

### PolicyPromptModal — client-side TTL fallback when event omits `ttl_ms` (VAL-APPROVALS-014)

- **Paper / task source**: `igloo-paper` renders an "Expires in Ns" countdown tied to the
  runtime-provided TTL of the denied request. The Paper source implies the bifrost runtime
  always supplies a numeric `ttl_ms` on the denial event.
- **web-demo-v2 implementation**:
  `src/screens/DashboardScreen/modals/PolicyPromptModal.tsx` (CLIENT_TTL_MS = 60_000; the
  modal exposes `data-ttl-source="event|session"` on the backdrop for validators).
- **Protocol / data constraint**: Since `peer_denied` is not yet emitted as a canonical
  `RuntimeEvent` by the WASM bridge (see the previous deviation entry), there is no
  guarantee that future synthetic producers will populate `ttl_ms`. The modal therefore
  honours `event.ttl_ms` when present and falls back to a client-side 60-second timer
  otherwise. Either way, the TTL expiry dispatches a policy-neutral `onDismiss()` — no
  `setPolicyOverride` call is made on timeout (VAL-APPROVALS-020).
- **Assertion IDs covered**: VAL-APPROVALS-014 (countdown accuracy within ±200ms/s) and
  VAL-APPROVALS-020 (TTL expiry is policy-neutral).

### PolicyPromptModal — full decision payload on cross-tab `BroadcastChannel` (VAL-APPROVALS-024)

- **Paper / task source**: `igloo-paper` does not spec cross-tab behaviour; the Paper flow
  assumes a single signer UI. VAL-APPROVALS-024 in the validation contract extends the
  signer UX to converge cross-tab so that a decision actioned in tab A applies in tab B
  without re-prompting the user.
- **web-demo-v2 implementation**:
  `src/app/AppStateProvider.tsx` (`resolvePeerDenial` posts, BroadcastChannel install effect
  receives). The sender emits
  `{ type: "decision", promptId, peerPubkey, decision: "allow-once"|"allow-always"|"deny"|"deny-always", scope: { verb } }`
  on `BroadcastChannel("igloo-policy-denials")`. Sibling receivers drop the mirrored queued
  entry by `promptId` AND apply the same `setPolicyOverride({ peer, direction: "respond",
  method: verb, value })` against their own live runtime so the Peer Policies / peer
  override state converges. Receivers MUST NOT re-broadcast (no echo loop).
- **Protocol / data constraint**: Prior to this deviation, the channel only carried a
  dismissal hint (`{ type: "policy-resolved", id }`), which closed the mirror modal but did
  not propagate the user's decision into the sibling tab's runtime state. The bifrost
  runtime does not persist peer overrides across tabs automatically because each tab owns
  its own WASM runtime instance. Cross-tab sync is therefore a UI-layer concern.
- **Backward compatibility**: Receivers remain tolerant of the legacy
  `{ type: "policy-resolved", id }` shape so a mid-upgrade sibling tab that has not
  updated to the new sender still causes this tab's mirror queue to dismiss (runtime state
  diverges in that case — this is the pre-mission baseline).
- **Assertion IDs covered**: VAL-APPROVALS-024 (cross-tab decision propagation — both
  modal dismissal and runtime peer-override convergence).

### PolicyPromptModal — no proactive open paths in production (VAL-APPROVALS-018)

- **Paper / task source**: `igloo-paper` demo scenarios drive the
  `Signer Policy` modal from explicit affordances — an **Open** button on each
  Pending Approvals row, a **Review Approvals** button on the Signing-Blocked
  hero card, and a **Modals → Policy Prompt** button on the MockStateToggle
  dev bar. The Paper surface is a scenario demo; there is no concept of a
  runtime-reactive vs. dev-demo open path in the design reference.
- **web-demo-v2 implementation**:
  `src/screens/DashboardScreen/index.tsx` — the three historical proactive
  open paths (`setActiveModal("policy-prompt")`) are wrapped behind
  `import.meta.env.DEV` ternaries so `vite build` dead-code-eliminates the
  call sites from the production bundle:
    - `RunningState.onOpenPolicyPrompt` (the PendingApprovalsPanel Open
      button wiring) — prop is passed through only when `import.meta.env.DEV`,
      else `undefined` (which hides the Open button at the panel level).
    - `SigningBlockedState.onReviewApprovals` (the Review Approvals button
      in the Signing-Blocked hero) — prop is `undefined` outside DEV so
      the button is inert in production.
    - `MockStateToggle` (the demo-only modal trigger bar) — the entire
      component is now gated on `import.meta.env.DEV && showMockControls`
      so every `onOpenModal("policy-prompt")` + `onOpenModal("signing-failed")`
      button is tree-shaken out of production.
- **Protocol / runtime constraint**: VAL-APPROVALS-018 requires
  `PolicyPromptModal` mount in response to **peer_denied** RuntimeEvents
  ONLY — never from a pending_operations mutation, focus/lock/unlock
  signal, or any other trigger. The Paper-equivalent proactive open
  paths are preserved for the demo gallery and vitest component tests
  (both of which run with `import.meta.env.DEV === true`) while the
  production runtime build (`npm run build` → `dist/`) has zero
  `setActiveModal("policy-prompt")` call sites.
- **Verification**: `rg -o '[a-zA-Z_$][a-zA-Z0-9_$]*\("policy-prompt"\)'
  dist/assets/*.js` returns zero matches after `npm run build` (the
  remaining `"policy-prompt"` tokens in the minified bundle are (a) the
  React-key template prefix inside `PolicyPromptModal.tsx` — e.g.
  `policy-prompt-title-${event.id}`, (b) the reactive-path
  `activeModal !== "policy-prompt"` guard inside the `paperPromptEvent`
  useMemo, which is a read-only comparison not an open call, and
  (c) demo fixture data in `src/demo/scenarios.ts`).
  Unit coverage for the reactive-only contract lives at
  `src/screens/__tests__/DashboardPolicyPromptReactive.test.tsx`
  (three tests: pending op doesn't open, focus/lock/unlock doesn't open,
  peer_denied DOES open via enqueuePeerDenial).
- **Assertion IDs covered**: VAL-APPROVALS-018 (no proactive/upfront
  prompt); reinforces VAL-APPROVALS-007 (peer_denied → reactive modal
  via enqueuePeerDenial pipeline as the ONLY runtime open path).

### Default Policy dropdown writes to `respond.*`, not `request.*` (VAL-POLICIES-011/012/013)

- **Paper / task source**: The `m3-default-policy-dropdown` feature description specifies the
  three Default Policy options (`Ask every time`, `Allow known peers`, `Deny by default`) as
  the global fallback for peers without manual overrides. Early drafts of the validation
  contract (VAL-POLICIES-011/012/013) framed the effect on `effective_policy.request.*`,
  which does not match the direction the dropdown actually governs.
- **web-demo-v2 implementation**:
  `src/screens/DashboardScreen/panels/PoliciesState.tsx` (default-policy dropdown),
  routing through `setPolicyOverride({ direction: "respond", ... })` for the per-peer
  writes that the three options imply.
- **Protocol / data constraint**: Per
  `bifrost-rs/crates/bifrost-core/src/types.rs` (`PeerPolicy`, lines ~304–307) and the
  signer's effective-policy computation in
  `bifrost-rs/crates/bifrost-signer/src/lib.rs` (`effective_policy_for_peer`, line ~743,
  and the `effective_policy: PeerPolicy` field on `PeerPermissionState` at line ~324),
  the policy model has two orthogonal directions per peer:
    - **`request.*`** — *outbound-intent*: whether THIS device (A) is willing to DRIVE a
      given method TOWARD the peer (A initiates a `sign` / `ecdh` / `ping` / `onboard`
      dispatch at the peer). Controlled by the dispatch-side gating in `sign_peers_online`
      / `ecdh_peers_online` / the `request.ping` / `request.onboard` checks in the signer
      (lines ~858, 863, 1268, 1309, 1500, 1508, 1542) — none of which are wired to the
      Default Policy UI.
    - **`respond.*`** — *inbound-response-permission*: whether THIS device (A) is willing
      to ACCEPT and service an inbound request FROM the peer (does A sign / echo / ping /
      onboard when the peer asks). This is exactly what the Default Policy dropdown
      controls: A's willingness to respond to others.
- **What the app actually does**: all three default options write to `respond.*` for
  override-free peers:
    - `Ask every time` → `effective_policy.respond.* = unset/prompt` (chips muted; a
      `peer_denied`-style prompt is expected when a peer drives a request).
    - `Allow known peers` → `effective_policy.respond.{sign,ecdh,ping,onboard} = allow`
      for known roster peers (chips saturated).
    - `Deny by default` → `effective_policy.respond.* = deny` for every override-free
      peer (chips muted).
  The `request.*` side is NOT controlled by the Default Policy UI and is typically left
  at its permissive default (`MethodPolicy::default()` → all methods `true` per
  `bifrost-rs/crates/bifrost-core/src/types.rs` lines ~382–394). Outbound gating on the
  `request.*` side is surfaced elsewhere (peer-level overrides / Signer Policies rule
  rows in `PoliciesState`) and is not the Default Policy dropdown's concern.
- **Assertion IDs covered**: VAL-POLICIES-011 (Deny by default → `respond.* = deny` for
  override-free peers), VAL-POLICIES-012 (Allow known peers →
  `respond.{sign,ecdh,ping,onboard} = allow` for known roster peers), VAL-POLICIES-013
  (Ask every time → `respond.*` at unset/prompt). The assertions were corrected from the
  earlier `request.*` framing; stable IDs unchanged.

### VAL-POLICIES-010 — `peer_denied` RuntimeEvent on A is unobservable (protocol reality)

- **Paper / task source**: The original VAL-POLICIES-010 assertion in
  `.factory/missions/b48100dd-0e6c-4a7c-90a3-f12e61d1c3c4/validation-contract.md`
  required that when peer A's `respond.sign=deny` override rejects an
  inbound sign from peer B, A's runtime emits exactly one
  `peer_denied` RuntimeEvent with `peer_pubkey === B.pubkey` and
  `verb === "sign"`, observable via A's event log.
- **web-demo-v2 implementation**: `src/e2e/multi-device/policy-denial-roundtrip.spec.ts`
  (feature `m3-policy-denial-and-persistence`). The scaffold documents
  the upstream blocker inline and asserts only the B-side
  OperationFailure surface plus A-side indirect checks (no Sign
  completion, effective_policy snapshot confirms the override is
  live).
- **Protocol / data constraint**: The upstream bifrost-rs signer does
  NOT emit a local `peer_denied` RuntimeEvent when its policy layer
  rejects an inbound request. Per
  `bifrost-rs/crates/bifrost-signer/src/lib.rs` `reject_request`
  (line ~2233) the rejection path builds a `BridgeEnvelope` whose
  payload is a NIP-44–encrypted `BridgePayload::Error(PeerErrorWire {
  code: "peer_denied", message })` addressed to the requesting peer
  only — it is not surfaced on the local bridge's event stream.
  Confirming the asymmetry, `bifrost-bridge-wasm/src/lib.rs`
  enumerates `RuntimeEventKind` as
  `{ Initialized, StatusChanged, CommandQueued, InboundAccepted,
  ConfigUpdated, PolicyUpdated, StateWiped }` — there is no
  `PeerDenied` variant (the task description references
  `crates/bifrost-core/src/runtime_status.rs` by name; the actual
  definition lives in the WASM bridge crate, but either way no
  `PeerDenied` variant exists). The `PeerDeniedEvent` jsdoc in
  `src/app/AppStateTypes.ts` already acknowledges this:
  "the upstream bifrost-rs runtime does not currently surface denial
  notifications as `RuntimeEvent`s … a future `drain_runtime_events`
  `peer_denied` kind in production". `bifrost-rs` is read-only
  reference material for this mission.
- **Narrowing**: the assertion was narrowed to the B-side
  OperationFailure observability; the A-side `peer_denied` event
  requirement was removed pending an upstream bifrost-rs change to
  emit `RuntimeEventKind::PeerDenied` from `reject_request`. The
  stable ID `VAL-POLICIES-010` is preserved. The revised behavior
  requires that (a) B receives an `OperationFailure` whose reason
  matches `/denied|policy/i` within 15 s, (b) A's
  `pending_operations.length` is unchanged, and (c) no
  `sign_completed` event fires on either side.
- **Assertion IDs covered**: VAL-POLICIES-010 (B-side OperationFailure
  observable; A-side `peer_denied` RuntimeEvent removed from the
  assertion until upstream exposes it).

### Settings confirm-unsaved-changes dialog on navigate-away (VAL-SETTINGS-029)

- **Paper / task source**: `igloo-paper/screens/dashboard/3-settings-lock-profile`
  depicts the Settings sidebar with inline Profile Name edit and
  Change Password flows but does not spec behavior when the user
  attempts to close the sidebar (X / scrim / Lock / Clear
  Credentials) mid-edit. VAL-SETTINGS-029 extends the UX to forbid
  silent loss of typed input.
- **web-demo-v2 implementation**:
  `src/screens/DashboardScreen/sidebar/SettingsSidebar.tsx`
  (`guardNav()` + `pendingNavAction` state + modal rendered with
  reused `.clear-creds-*` markup).
- **Chosen option**: option (a) "confirm dialog on navigate-away".
  The assertion permits either (a) or (b) "auto-save on
  navigate-away"; we chose the confirm dialog because:
    - The Profile Name mutator performs an expensive encrypted
      profile re-write (IndexedDB round-trip + AES re-encrypt) that
      would otherwise silently run on every unfocus, multiplying
      storage writes for no user benefit.
    - The Change Password flow requires three validated inputs
      (current, new, confirm); auto-saving a partial form is
      impossible because the current-password round-trip cannot
      succeed without the user's full input. A confirm dialog is
      the only correct option for that flow, so aligning Profile
      Name with the same gesture keeps the mental model uniform.
    - The dialog is a pure UI concern — it adds zero new runtime
      side effects and no new persistence path.
- **Scope of the guard**: the gate triggers on the three
  navigate-away affordances inside the sidebar — the X button, the
  scrim click, the Lock Profile CTA, and the Clear Credentials
  CTA. Route-level navigation (e.g. Replace Share button, hard
  reload, back button) is intentionally out of scope because those
  actions close the sidebar through the parent
  `DashboardScreen` — which in turn calls our `onClose()` — so the
  guard fires via the parent-provided close path. Hard reload /
  tab close are handled by the existing
  `beforeunload` handler (VAL-OPS-028) and will drop any draft
  state alongside the runtime, consistent with "revert to
  persisted state on return" for those cases.
- **Dirty-state detection**: a draft is considered dirty when (a)
  the Profile Name editor is open AND the trimmed draft differs
  from the persisted name, OR (b) the Change Password form is
  open AND any of the three password inputs has non-empty
  content. Relay add/edit/remove rows are NOT tracked because the
  relay mutator persists immediately on each Save/Remove click —
  there is no window where the row holds unsaved state after the
  async mutator resolves.
- **Assertion IDs covered**: VAL-SETTINGS-029 (navigate-away
  triggers confirm dialog or auto-save; silent loss forbidden).

### Lock Profile closes relay sockets with code 1000 "lock-profile" (VAL-SETTINGS-021)

- **Paper / task source**: VAL-SETTINGS-021 requires Lock → all
  WS connections close cleanly; Paper does not prescribe a close
  code.
- **web-demo-v2 implementation**:
  `src/app/AppStateProvider.tsx::lockProfile` invokes
  `relayPumpRef.current?.closeCleanly(1000, "lock-profile")`
  before `stopRelayPump()`, mirroring the VAL-OPS-028 `beforeunload`
  path but with a distinct 1000/1001 split so validators inspecting
  `lastCloseCode` can distinguish a Lock (1000) from a tab unload
  (1001).
- **Why 1000**: RFC 6455 treats 1000 as the "normal closure"
  close code, which matches the semantics of a user-initiated
  Lock — the session is intentionally ending, not being torn
  down due to a transport failure. The surviving peers should
  treat this the same as any other graceful disconnect and must
  not attempt immediate reconnect.
- **Polling gate**: the runtime-status refresh interval installed
  by the provider (`setInterval(refreshRuntime, 2500)`) remains
  scheduled after Lock, but `refreshRuntime` short-circuits via
  `runtimeRef.current === null` (set synchronously by
  `lockProfile`) so no further `runtime.runtimeStatus()` call
  reaches the WASM bridge and no new WS traffic is emitted. The
  next user action (Unlock, Clear Credentials, page close) either
  re-arms the pump with a fresh runtime or tears the interval
  down via the effect cleanup.
- **Assertion IDs covered**: VAL-SETTINGS-021 (Lock → clean WS
  close + no further polling).

### Runtime-mode Relay Health panel on the Running Dashboard (VAL-SETTINGS-010..014)

- **Paper / task source**: `igloo-paper/screens/dashboard/1-signer-dashboard`
  renders a simple "Connected to wss://…, wss://…" kicker under the
  Signer Running hero. The Relay Health table (Relay · Status · Latency
  · Events · Last Seen) appears only on the
  `2b-all-relays-offline` artboard.
- **web-demo-v2 implementation**:
  `src/screens/DashboardScreen/panels/RelayHealthPanel.tsx` rendered by
  `states/RunningState.tsx` whenever `paperPanels=false` (runtime mode)
  and at least one runtime relay is configured.
- **Deviation**: the Running Dashboard now carries a per-relay
  telemetry table with live Latency (ms), Events counter, and
  relative Last-Seen copy. Paper's Running artboard does not display
  this table; we surface it to make the m5 `BrowserRelayClient`
  telemetry observable end-to-end (VAL-SETTINGS-010 numeric latency
  within 10 s of connect, VAL-SETTINGS-011 EVENT-counter increments,
  VAL-SETTINGS-012 relative Last Seen, VAL-SETTINGS-013 amber Slow
  status above `SLOW_RELAY_THRESHOLD_MS` for 2 consecutive samples,
  VAL-SETTINGS-014 real Last-Seen on Offline). Without this surface
  the assertions would not be observable until every relay dropped —
  which is the exact opposite of what they exercise.
- **Demo parity**: paper-mode scenarios (`/demo/*` and any
  fixture-driven Playwright path) render with `paperPanels=true`, which
  short-circuits the new panel so pixel-parity regressions are
  avoided. The `DashboardRuntimeStatesFidelity` + `demo-gallery.spec`
  baselines continue to pass.
- **Documented constant**:
  `src/lib/relay/relayTelemetry.ts` exports
  `SLOW_RELAY_THRESHOLD_MS = 300` with JSDoc explaining the 2-sample
  hysteresis for VAL-SETTINGS-013.
- **Assertion IDs covered**: VAL-SETTINGS-010, VAL-SETTINGS-011,
  VAL-SETTINGS-012, VAL-SETTINGS-013, VAL-SETTINGS-014.
### Camera QR scanning — Playwright mobile project behaviour (VAL-BACKUP-019)

- **Paper / task source**: `m6-camera-qr-scan` feature description — "Mobile
  Playwright project behavior documented". VAL-BACKUP-019 requires Scan QR to
  be visible under the mobile viewport and either operate or surface a clear
  unavailable message; silent failure is unacceptable.
- **web-demo-v2 implementation**:
  `src/components/QrScanner.tsx` (shared scanner modal), used from
  `src/screens/OnboardScreens.tsx`,
  `src/screens/ReplaceShareScreens.tsx`, and
  `src/screens/ImportScreens.tsx`. Playwright mobile viewport is defined in
  `playwright.config.ts` (`mobile` project, Pixel 5 device, 390×844).
- **Behaviour under the `mobile` project**: the Scan QR button is rendered
  in the same DOM location as on desktop on every one of the three
  surfaces (Onboard, Replace Share, Import → Load Backup). Tapping it opens
  the `<div role="dialog" aria-label="QR Scanner">` modal just like on
  desktop. The scanner then requests
  `getUserMedia({ video: { facingMode: "environment" } })`; Playwright's
  default launch options do NOT permission-grant `camera` on the `mobile`
  project, so the promise rejects with `NotAllowedError`. The component
  catches this and renders the explicit fallback copy
  **"Camera access was denied or the camera is unavailable."** along with a
  Close action button — the user-facing surface VAL-BACKUP-019 requires. The
  underlying textarea stays interactive so a pasted package is still the
  working path under `mobile`. The MediaStreamTracks are never live under
  `mobile`, so there is nothing to leak on close (VAL-BACKUP-027 trivially
  holds).
- **How to exercise a live capture under `mobile` locally**: grant the
  camera permission explicitly via the BrowserContext
  (`context.grantPermissions(['camera'], {origin: 'http://127.0.0.1:5173'})`)
  and point the browser at a fake MJPEG device
  (`--use-fake-device-for-media-stream --use-file-for-fake-video-capture=...`).
  The scanner then behaves identically to the desktop path: jsQR decodes
  frames, a valid `bfonboard1…` / `bfprofile1…` / `bfshare1…` payload closes
  the scanner and populates the target textarea, non-matching payloads
  surface the inline "Not a valid bfonboard/bfprofile/bfshare package"
  error (VAL-BACKUP-018) while the stream continues. Permission revocation
  mid-scan (simulated via `page.context().clearPermissions()` followed by
  `MediaStreamTrack.stop()` injection) fires `track.onended`, the scanner
  surfaces **"Camera access was lost…"** (VAL-BACKUP-026) and stops every
  track (`readyState === 'ended'`).
- **Assertion IDs covered**: VAL-BACKUP-014, VAL-BACKUP-015,
  VAL-BACKUP-016 (Scan QR buttons on Replace Share / Onboard / Import),
  VAL-BACKUP-017 (camera-denied fallback), VAL-BACKUP-018 (invalid-content
  inline error), VAL-BACKUP-019 (mobile viewport behaviour documented),
  VAL-BACKUP-026 (permission revoked mid-scan), VAL-BACKUP-027 (scanner
  release all tracks on X, backdrop click, and unmount).
