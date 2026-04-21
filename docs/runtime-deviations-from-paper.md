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
  `code` → `Code`; `message` → `Error`). When `failed_peer` is present it adds a `Failed
  peer: <shortHex>` row. When `failed_peer` is absent the row is omitted entirely — the
  UI does NOT synthesize "no peers responded", "0/N", or any other fabricated denominator.
  The Retry button still dispatches `handleRuntimeCommand({ type: "sign", message_hex_32 })`
  with the same message that produced the failure (via `signDispatchLog[request_id]`), and
  Dismiss still closes without dispatch. If the bifrost bridge later grows a real
  peers-responded field, the optional schema extension point is `OperationFailure` in
  `src/lib/bifrost/types.ts` and the rendering site in `buildFailureSummary` in the modal.
- **Assertion IDs covered**: VAL-OPS-006 (SigningFailedModal populated from real failure
  payload, not Paper placeholders). The "peer-response ratio" clause in that assertion is
  reconciled here against the runtime contract: a ratio would have to be fabricated to
  appear, so the modal shows only fields the runtime actually emits.
