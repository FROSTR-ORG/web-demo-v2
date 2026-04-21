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
