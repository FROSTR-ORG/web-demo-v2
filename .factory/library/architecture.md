# Architecture — Web Demo V2 Runtime

High-level system picture for the web-demo-v2 FROST threshold-signing app. Workers should read this before making architectural decisions.

## System Overview

web-demo-v2 is a Vite + React SPA that wraps the `bifrost-bridge-wasm` signer runtime, talks to Nostr relays via real WebSocket NIP-01 frames, and mirrors the `igloo-paper` design reference for UX.

Three pillars:

- **Outside-runtime flows** (welcome, unlock, import, create, onboard-requester, rotate-keyset, replace-share, recover) — already complete before this mission.
- **Runtime lifecycle** (init/restore/tick/snapshot/wipe, runtime_status polling, relay pump) — already complete.
- **Inside-runtime behavior** (dashboard operations, policies, event log, settings persistence, backups, source onboarding) — THIS MISSION fills the remainder.

## Layered Structure

```
UI (React screens + components)
  ↕
AppStateProvider (canonical App state, derived + sourced from runtime)
  ↕
RuntimeClient (typed wrapper around WasmBridgeRuntime)
  ↕
bifrost-bridge-wasm  (vendored at src/vendor/bifrost-bridge-wasm)
  ↕                  ↕
RuntimeRelayPump    WASM module runs FROST protocol, state machine, codecs
  ↕
BrowserRelayClient (NIP-01 WebSockets to public relays)
  ↕
wss://relay.primal.net / relay.damus.io / nos.lol
```

### Key files (source of truth)

- `src/app/AppStateProvider.tsx` — canonical app state, profile CRUD, runtime bootstrap, relay pump control
- `src/app/AppStateContext.tsx` — React context + `useAppState()` hook
- `src/app/MockAppStateProvider.tsx` — demo-only provider, mirrors API shape for gallery scenarios
- `src/app/appStateBridge.ts` — one-shot sessionStorage handoff between demo and real providers (MUST NOT serialize secrets)
- `src/app/profileRuntime.ts` — WASM bootstrap helpers (createRuntimeFromProfilePayload, etc.)
- `src/app/runtimeExports.ts` — `exportRuntimePackagesFromSnapshot` (real bfprofile/bfshare string production)
- `src/lib/bifrost/runtimeClient.ts` — typed WasmBridgeRuntime wrapper (init/restore/tick/handleCommand/drain*/snapshot/wipeState/setPolicyOverride/clearPolicyOverrides/readConfig/updateConfig)
- `src/lib/bifrost/packageService.ts` — package codec helpers (encode/decode bfshare/bfonboard/bfprofile, profile backup event builders)
- `src/lib/bifrost/types.ts` — shared types for runtime read models
- `src/lib/relay/browserRelayClient.ts` — NIP-01 WebSocket client
- `src/lib/relay/runtimeRelayPump.ts` — pumps outbound→relay / inbound→runtime on each tick
- `src/lib/wasm/loadBridge.ts` — vite-aware WASM module loader
- `src/screens/DashboardScreen/` — Dashboard, organized into `index`, `states/`, `panels/`, `modals/`, `sidebar/`, `mocks.ts`, `types.ts`
- `src/demo/` — deterministic gallery scenarios at `/demo/:scenarioId`
- `src/e2e/` — Playwright tests

## Data Flow: Operations (sign/ECDH/ping/onboard)

1. UI invokes `appState.handleRuntimeCommand({type, ...})` (or a wrapper action).
2. AppStateProvider forwards to `RuntimeClient.handleCommand()` → WASM `handle_command()`.
3. Next `tick()` (driven every 2500 ms by refreshRuntime interval) drains commands; WASM generates outbound envelope + updates `pending_operations`.
4. RuntimeRelayPump reads `drainOutboundEvents` and publishes to relays.
5. Relays forward to peer devices → those devices' WASM `handle_inbound_event()` → response envelope.
6. Peer responses arrive back via WebSocket → `handleInboundEvent()` on local runtime.
7. Next tick: `drainCompletions()` yields success entries; `drainFailures()` yields failures; `drainRuntimeEvents()` yields lifecycle edges (status_changed, policy_updated, etc.).
8. AppStateProvider exposes completions/failures/events via React state → UI updates (EventLogPanel, SigningFailedModal, PendingApprovalsPanel).

No Promise-based correlation — callers correlate by `request_id` in `pending_operations` → completions/failures.

## Data Flow: Policies

- Default policy in bifrost is `allow` for every verb (ping/onboard/sign/ecdh) on both `request` and `respond` directions. Match this.
- UI sets overrides via `RuntimeClient.setPolicyOverride({peer, direction, method, value})`. `value ∈ {unset, allow, deny}`.
- WASM exposes `runtime_status.peer_permission_states[*].effective_policy` — the merged view (local AND-combined with peer's remote-reported respond policy).
- UI reads effective_policy for badges and lists; UI writes manual_override for changes.

## Data Flow: Approval Prompts (reactive denial)

bifrost auto-approves/denies based on policy synchronously. There is NO protocol-level "pending request hold" API. For denial round-trips, the contract-critical observable is requester-side failure (`OperationFailure` / peer-error) rather than a guaranteed local denial event on the denying device.

1. Peer B sends sign request to A.
2. A's runtime checks `respond.sign` for B. If Deny: runtime rejects the request and B surfaces a policy/denied failure.
3. If the runtime emits a `peer_denied` runtime event (`drain_runtime_events()`), AppState can queue it for `PolicyPromptModal`; this event is not assumed for VAL-POLICIES-010 timing assertions.
4. Modal (when present) shows peer identity, verb, and decoded context.
5. User clicks "Allow once": `setPolicyOverride(peer, respond, verb, allow)` — temporary allow; user hint asks requester to retry.
6. User clicks "Always allow": same but override persists via stored profile.
7. User clicks "Deny": modal dismisses (request already denied).

This deviates from Paper's upfront-blocking-prompt design — documented in `docs/runtime-deviations-from-paper.md`.

## Persistence

- **IndexedDB** (via `idb-keyval`): stores `StoredProfile` records = summary + encrypted `bfprofile` package string. Also stores `manual_peer_policy_overrides` in payload. Read by AppStateProvider on mount.
- **sessionStorage**: one-shot bridge snapshot (demo → real handoff) with ALL setup sessions null.
- **In-memory only**: raw share secrets, decoded payloads, recovered nsec, setup-session passwords.

## Security Invariants

- Never write secrets to sessionStorage, localStorage, or IndexedDB (except inside an encrypted bfprofile string).
- NIP-19 encoding, secp256k1 validation, FROST key material — WASM only, never browser JS.
- Router state may carry safe retry context (package text, profile ids). NEVER passwords, decoded payloads, share secrets, nsec.
- Setup session state cleared on cancel/finish/lock/clearCredentials/invalid-direct-navigation.
- `clearCredentials()` MUST call `runtime.wipe_state()` before dropping the runtime ref.
- Console, Nostr event content, DOM, and snapshot output must not leak secrets (validated by explicit assertions).

## Dashboard State Derivation

`src/screens/DashboardScreen/dashboardState.ts` computes the high-level state:

- `signerPaused` → `stopped`
- any relay `connecting` → `connecting`
- all relays `offline` → `relays-offline`
- any relay online but `!hasCompletedPeerRefresh` → `connecting`
- `pendingRuntimeWorkIsBlocked` (readiness mismatch) → `signing-blocked`
- else → `running`

Demo scenarios override via `demoUi.dashboard?.state`.

## Paper Parity

Every screen must match `igloo-paper` (sibling repo) — same copy, colors, typography, layout. Deviations only where protocol constrains us (reactive denial surface, specific UI labels). Each deviation documented in `docs/runtime-deviations-from-paper.md`.

Design system primitives (shared): `.settings-section`, `.settings-card`, `.settings-btn-blue`, `.settings-btn-red`, `.event-log-list`, `.policies-peer-row`, `.policies-rule-row`, etc. Colors in `src/styles/global.css` follow Paper tokens (`--color-success`, `--color-warn`, `--color-error`, verb-specific tones for SIGN/ECDH/PING/ONBOARD badges).

## Testing Surfaces

- **Unit** (vitest): pure functions, hooks, state reducers
- **Component** (vitest + Testing Library): panels, modals, screens in isolation
- **Demo gallery e2e** (Playwright at `src/e2e/demo-gallery.spec.ts`): visits `/demo/:scenarioId` and checks Paper parity + no console errors
- **Multi-device e2e** (new in this mission): two Playwright pages sharing a spawned local `bifrost-devtools relay`, each seeded with a different share of the same keyset (pattern copied from frostr-infra `chrome-pwa-pairing.spec.ts`)
- **Manual validation** (agent-browser): 1–3 concurrent sessions, public relays, orchestrated scenarios

## Runtime `pending_operations` Context Shapes (observed)

`runtime_status.pending_operations[*]` carries operation-specific `context` payloads. The real runtime shape for SIGN is **nested** under a session object, not flat at the context root. Workers reading previews or classifying pending operations MUST handle the nested shape; legacy flat shapes may exist in tests but are not what bifrost-rs emits.

Observed shapes (capture with `__debug.runtimeStatus()` or bifrost-devtools):

- **SIGN**: `context = { session: { message_hex_32: "<64-hex>", ... } }` (nested under `session` / `SignSession`). Preview helpers must read `context?.session?.message_hex_32 ?? context?.SignSession?.message_hex_32 ?? context?.message_hex_32` (last branch is a defensive legacy fallback).
- **ECDH**: `context = { peer_pubkey: "<hex>", ... }` — flat.
- **PING / REFRESH_ALL**: `context` may be empty `{}` or carry `initiated_by: 'self' | 'peer'`.

When the bifrost-rs payload shape is unclear, capture evidence via `__debug.runtimeStatus()` rather than guessing. Vitest coverage for any pending-operation rendering MUST include at least one case using the real nested shape — synthetic flat payloads do not prove the code works against the real runtime.
